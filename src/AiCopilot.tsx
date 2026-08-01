import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Page } from "./App";
import { streamChat, type ChatMessage, type ToolResult } from "./ai-api";

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
};

export default function AiCopilot({ activePage }: { activePage: Page }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [conversation, setConversation] = useState<ChatMessage[]>([]);
  const [toolActivity, setToolActivity] = useState<ToolActivity[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  const chatRef = useRef<HTMLDivElement>(null);

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

  async function sendMessage() {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    const userMessage: ChatMessage = { role: "user", content: trimmed };
    const historyForApi = [...conversation, userMessage];

    setConversation([...historyForApi, { role: "assistant", content: "" }]);
    setInput("");
    setToolActivity([]);
    setErrorMessage(null);
    setIsStreaming(true);

    try {
      for await (const event of streamChat(historyForApi)) {
        if (event.type === "token") {
          setConversation((previous) => {
            const next = [...previous];
            const last = next[next.length - 1];
            next[next.length - 1] = { ...last, content: last.content + event.delta };
            return next;
          });
        } else if (event.type === "tool_call") {
          setToolActivity((previous) => [...previous, { tool: event.tool, status: "running" }]);
        } else if (event.type === "tool_result") {
          setToolActivity((previous) =>
            previous.map((activity) =>
              activity.tool === event.tool && activity.status === "running"
                ? { ...activity, status: "done", result: event.result }
                : activity,
            ),
          );
        } else if (event.type === "error") {
          setErrorMessage(event.reason);
        }
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setIsStreaming(false);
    }
  }

  const lastMessage = conversation[conversation.length - 1];
  const isWaitingForFirstToken =
    isStreaming && lastMessage?.role === "assistant" && lastMessage.content === "";

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
          <button ref={closeButtonRef} type="button" onClick={close} aria-label="Close AI Copilot">
            Close
          </button>
        </header>

        <div className="copilot-chat" aria-live="polite" ref={chatRef}>
          {conversation.length === 0 && !isStreaming && (
            <div className="copilot-message copilot-message-assistant">
              <p>Ask me to help manage an event — I'll show you a draft before creating anything.</p>
            </div>
          )}

          {conversation.map((message, index) =>
            message.content ? (
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

          {toolActivity.map((activity, index) => (
            <div key={`tool-${index}`} className="copilot-message copilot-message-tool">
              <p>
                {activity.status === "running"
                  ? `Running ${activity.tool}…`
                  : activity.result?.success
                    ? `${activity.tool} succeeded.`
                    : `${activity.tool} failed: ${activity.result?.reason}`}
              </p>
            </div>
          ))}

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
