import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Page } from "./App";
import { invokeTool, streamChat, type ChatMessage, type ToolResult } from "./ai-api";

const pageContext: Record<Page, string> = {
  home: "Landing",
  dashboard: "Dashboard",
  events: "Events",
  volunteers: "Volunteers",
  ai: "AI Copilot",
};

type ToolActivity = {
  tool: string;
  status: "running" | "done";
  result?: ToolResult;
  // "chat": the model called this during a streamed turn, which may also
  // produce its own trailing narration — success can defer to that text.
  // "direct": triggered by a human action outside any chat turn (e.g.
  // confirmDraft's publish_event via invokeTool) — there's no other
  // narration to defer to, so its outcome must always be shown.
  origin: "chat" | "direct";
};

// Mirrors backend/schema/event_templates.py's TemplateOut (subset).
type EventTemplateSummary = {
  id: number;
  name: string;
  description: string;
};

// TICKET-34: starter prompts shown on an empty conversation, so a
// first-time organizer sees the range of things the panel can do instead
// of a blank composer. Kept to read/list-style requests — clicking one
// still goes through the model and the normal tool-call/draft-confirm
// gates, but a first click can't itself fire something destructive.
const RECOMMENDED_ACTIONS = [
  "Create an event for me using one of my templates",
  "List upcoming tasks across all events",
  "List my upcoming events",
  "Which volunteer signups need approval?",
];

// TICKET-35: tools that actually write to the database — a successful
// result from one of these means whatever admin page is open behind the
// panel now has stale data. Read/list/preview tools (including
// create_event_draft, which never writes) are deliberately excluded.
// Mirrors the "mutating" set TICKET-29 identifies for its own purposes.
const MUTATING_TOOLS = new Set([
  "publish_event",
  "update_event",
  "cancel_event",
  "assign_event_task",
  "update_task_status",
  "approve_event_signup",
]);

// Mirrors backend/schema/events.py's EventCreate — the shape
// create_event_draft returns and publish_event accepts unchanged.
type EventDraftFields = {
  event_template_id: number | null;
  name: string;
  venue: string;
  event_date: string;
  description: string | null;
  start_time: string | null;
  end_time: string | null;
  beneficiary_id: number | null;
};

export default function AiCopilot({
  activePage,
  onDataChanged,
}: {
  activePage: Page;
  onDataChanged?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [conversation, setConversation] = useState<ChatMessage[]>([]);
  const [toolActivity, setToolActivity] = useState<ToolActivity[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [draftPreview, setDraftPreview] = useState<EventDraftFields | null>(null);
  const [isEditingDraft, setIsEditingDraft] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const fabRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const streamAbortRef = useRef<AbortController | null>(null);

  // The FAB and the close button aren't mounted at the same time (each only
  // renders for its own `open` state), so focus has to move after the swap
  // commits rather than inline in the click handler that toggles `open`.
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      closeButtonRef.current?.focus();
    } else if (wasOpenRef.current) {
      wasOpenRef.current = false;
      fabRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  useEffect(() => {
    const chat = chatRef.current;
    if (chat) chat.scrollTop = chat.scrollHeight;
  }, [conversation, toolActivity, errorMessage]);

  function close() {
    setOpen(false);
  }

  async function sendMessage(overrideText?: string) {
    const trimmed = (overrideText ?? input).trim();
    if (!trimmed || isStreaming) return;

    const userMessage: ChatMessage = { role: "user", content: trimmed };
    // A prior assistant turn can end with no real text — either genuinely
    // empty (it only made a tool call, like list_event_templates, and left
    // the follow-up commentary to the next turn) or whitespace-only
    // (observed live: a lone "\n\n"). The backend's ChatMessage.content
    // rejects both, so drop them before sending history, same as they're
    // already skipped when rendering the conversation below.
    const historyForApi = [
      ...conversation.filter((message) => message.content.trim()),
      userMessage,
    ];

    setConversation([...historyForApi, { role: "assistant", content: "" }]);
    setInput("");
    setToolActivity([]);
    setErrorMessage(null);
    setIsStreaming(true);

    const abortController = new AbortController();
    streamAbortRef.current = abortController;

    try {
      for await (const event of streamChat(historyForApi, abortController.signal)) {
        if (event.type === "token") {
          setConversation((previous) => {
            const next = [...previous];
            const last = next[next.length - 1];
            next[next.length - 1] = { ...last, content: last.content + event.delta };
            return next;
          });
        } else if (event.type === "tool_call") {
          setToolActivity((previous) => [
            ...previous,
            { tool: event.tool, status: "running", origin: "chat" },
          ]);
        } else if (event.type === "tool_result") {
          if (event.tool === "create_event_draft" && event.result.success) {
            // Render this as the suggestion-card below instead of a plain
            // "create_event_draft succeeded." status line.
            const payload = event.result.result as { event: EventDraftFields };
            setDraftPreview(payload.event);
            setIsEditingDraft(false);
            setToolActivity((previous) =>
              previous.filter(
                (activity) => !(activity.tool === event.tool && activity.status === "running"),
              ),
            );
          } else {
            setToolActivity((previous) =>
              previous.map((activity) =>
                activity.tool === event.tool && activity.status === "running"
                  ? { ...activity, status: "done", result: event.result }
                  : activity,
              ),
            );
            if (event.result.success && MUTATING_TOOLS.has(event.tool)) {
              onDataChanged?.();
            }
          }
        } else if (event.type === "error") {
          setErrorMessage(event.reason);
        }
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setErrorMessage(error instanceof Error ? error.message : "Something went wrong.");
      }
    } finally {
      setIsStreaming(false);
      streamAbortRef.current = null;
    }
  }

  function clearConversation() {
    streamAbortRef.current?.abort();
    setConversation([]);
    setToolActivity([]);
    setErrorMessage(null);
    setDraftPreview(null);
    setIsEditingDraft(false);
  }

  // TICKET-6: only fires on explicit organizer confirmation — calls
  // publish_event directly rather than routing the confirmation back
  // through another chat turn and hoping the model re-issues the call.
  async function confirmDraft() {
    if (!draftPreview || isPublishing) return;

    setIsPublishing(true);
    setToolActivity((previous) => [
      ...previous,
      { tool: "publish_event", status: "running", origin: "direct" },
    ]);

    let result: ToolResult;
    try {
      result = await invokeTool("publish_event", draftPreview);
    } catch (error) {
      result = {
        success: false,
        reason: error instanceof Error ? error.message : "Something went wrong.",
      };
    }

    setToolActivity((previous) => {
      const next = [...previous];
      const lastIndex = next.length - 1;
      next[lastIndex] = { ...next[lastIndex], status: "done", result };
      return next;
    });
    setIsPublishing(false);
    if (result.success) {
      setDraftPreview(null);
      setIsEditingDraft(false);
      onDataChanged?.();
    }
  }

  const lastMessage = conversation[conversation.length - 1];
  const isWaitingForFirstToken =
    isStreaming && lastMessage?.role === "assistant" && lastMessage.content === "";
  const modelRepliedWithText =
    lastMessage?.role === "assistant" && lastMessage.content.trim() !== "";

  return (
    <>
      {!open && (
        <button
          ref={fabRef}
          type="button"
          className="copilot-fab"
          aria-expanded={open}
          aria-controls="ai-copilot-panel"
          onClick={() => setOpen(true)}
        >
          <span>AI</span>
          Ask Passion AI
        </button>
      )}

      {open && <div className="copilot-backdrop" onClick={close} />}

      <aside
        id="ai-copilot-panel"
        role="dialog"
        aria-modal={open}
        aria-hidden={!open}
        aria-label="AI Copilot"
        className={`copilot-panel${open ? " open" : ""}`}
      >
        <header className="copilot-header">
          <div>
            <p>{pageContext[activePage]}</p>
            <h2>AI Copilot</h2>
          </div>
          <div className="copilot-header-actions">
            {conversation.length > 0 && (
              <button type="button" onClick={clearConversation}>
                Clear chat
              </button>
            )}
            <button ref={closeButtonRef} type="button" onClick={close} aria-label="Close AI Copilot">
              Close
            </button>
          </div>
        </header>

        <div className="copilot-chat" aria-live="polite" ref={chatRef}>
          {conversation.length === 0 && !isStreaming && (
            <div className="copilot-message copilot-message-assistant">
              <p>Ask me to help manage an event — I'll show you a draft before creating anything.</p>
              <div className="copilot-suggestions">
                {RECOMMENDED_ACTIONS.map((action) => (
                  <button
                    key={action}
                    type="button"
                    className="copilot-suggestion-chip"
                    onClick={() => sendMessage(action)}
                  >
                    {action}
                  </button>
                ))}
              </div>
            </div>
          )}

          {conversation.map((message, index) =>
            message.content.trim() ? (
              <div
                key={index}
                className={`copilot-message copilot-message-${message.role}`}
              >
                {message.role === "assistant" ? (
                  <ReactMarkdown>{message.content}</ReactMarkdown>
                ) : (
                  <p>{message.content}</p>
                )}
              </div>
            ) : null,
          )}

          {toolActivity.map((activity, index) => {
            if (activity.status === "running") {
              return (
                <div key={`tool-${index}`} className="copilot-message copilot-message-tool">
                  <p>Running {activity.tool}…</p>
                </div>
              );
            }

            // Don't decide what a "done" entry shows until the whole turn's
            // streaming is finished — deciding earlier (right when
            // tool_result arrives, before any trailing text has streamed
            // in) causes a flash: a fallback line/list appears, then
            // disappears once real text catches up a moment later.
            if (isStreaming) return null;

            if (!activity.result?.success) {
              // Failures always show, regardless of whether the model's own
              // text also mentions it — a silently swallowed failure is a
              // trust problem, not noise.
              return (
                <div key={`tool-${index}`} className="copilot-message copilot-message-tool">
                  <p>
                    {activity.tool} failed: {activity.result?.reason}
                  </p>
                </div>
              );
            }

            // Success: for a chat-turn tool call, only show something if the
            // model's own reply is empty — once it has real text, trust
            // that instead of duplicating the same information a second
            // time. A "direct" action (confirmDraft's publish_event) has no
            // other narration to defer to, so it always shows.
            if (activity.origin === "chat" && modelRepliedWithText) return null;

            if (activity.tool === "list_event_templates") {
              const items = (activity.result.result as { items: EventTemplateSummary[] }).items;
              return (
                <div key={`tool-${index}`} className="copilot-message copilot-message-tool">
                  <p>{items.length > 0 ? "Templates found:" : "No matching templates found."}</p>
                  {items.length > 0 && (
                    <ul>
                      {items.map((item) => (
                        <li key={item.id}>
                          <strong>{item.name}</strong>
                          {item.description ? ` — ${item.description}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            }

            return (
              <div key={`tool-${index}`} className="copilot-message copilot-message-tool">
                <p>{activity.tool} succeeded.</p>
              </div>
            );
          })}

          {draftPreview && (
            <article className="suggestion-card">
              <p className="suggestion-card-eyebrow">Draft event — review before creating</p>
              {isEditingDraft ? (
                <div className="suggestion-card-form">
                  <label>
                    Name
                    <input
                      value={draftPreview.name}
                      onChange={(event) =>
                        setDraftPreview({ ...draftPreview, name: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Venue
                    <input
                      value={draftPreview.venue}
                      onChange={(event) =>
                        setDraftPreview({ ...draftPreview, venue: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Date
                    <input
                      type="date"
                      value={draftPreview.event_date}
                      onChange={(event) =>
                        setDraftPreview({ ...draftPreview, event_date: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Description
                    <textarea
                      value={draftPreview.description ?? ""}
                      onChange={(event) =>
                        setDraftPreview({ ...draftPreview, description: event.target.value })
                      }
                    />
                  </label>
                </div>
              ) : (
                <>
                  <p>{draftPreview.name}</p>
                  <p>
                    {draftPreview.venue} · {draftPreview.event_date}
                  </p>
                  {draftPreview.description && <p>{draftPreview.description}</p>}
                </>
              )}
              <div className="suggestion-card-actions">
                <button
                  type="button"
                  className="suggestion-card-secondary"
                  onClick={() => setIsEditingDraft((previous) => !previous)}
                >
                  {isEditingDraft ? "Done editing" : "Edit"}
                </button>
                <button
                  type="button"
                  onClick={confirmDraft}
                  disabled={isEditingDraft || isPublishing}
                >
                  {isPublishing ? "Creating…" : "Create Event"}
                </button>
              </div>
            </article>
          )}

          {isWaitingForFirstToken && (
            <div className="copilot-message copilot-message-assistant">
              <p>Thinking…</p>
            </div>
          )}

          {errorMessage && (
            <div className="copilot-message copilot-message-error">
              <p>{errorMessage}</p>
            </div>
          )}
        </div>

        <form
          className="copilot-composer"
          onSubmit={(event) => {
            event.preventDefault();
            sendMessage();
          }}
        >
          <input
            aria-label="Message Passion AI"
            placeholder="Ask Passion AI…"
            value={input}
            disabled={isStreaming}
            onChange={(event) => setInput(event.target.value)}
          />
          <button type="submit" aria-label="Send message" disabled={isStreaming || !input.trim()}>
            ↑
          </button>
        </form>
      </aside>
    </>
  );
}
