"""AI assistant chat endpoint — OpenRouter integration and streaming (TICKET-1).

Holds the OpenRouter API key server-side only; the frontend only ever talks
to this endpoint, never to OpenRouter or the tool layer directly. This
module does not contain any event/business logic itself — when the model
emits a tool call, it dispatches to `backend.ai_tools.dispatch_tool_call`
(TICKET-2/3) and nothing else.
"""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from backend.ai_tools import TOOL_SPECS, dispatch_tool_call
from backend.api.routes._common import Connection
from backend.schema.ai_assistant import ChatRequest, ToolInvocationRequest

router = APIRouter(prefix="/ai", tags=["ai-assistant"])

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "anthropic/claude-3.5-sonnet"

SYSTEM_PROMPT = (
    "You are Passion AI, an assistant embedded in the Passion to Serve "
    "organizer dashboard. Help organizers manage events using only the "
    "tools you have been given — never fabricate data, never call a tool "
    "that doesn't exist, and never call publish_event without first "
    "showing the organizer a draft from create_event_draft and getting "
    "their confirmation. If required information is missing, ask a "
    "clarifying question instead of guessing. Keep responses concise. "
    "event_template_id is optional on create_event_draft/publish_event: "
    "if the organizer names a template, call list_event_templates first "
    "and match it by name to get the id — never ask the organizer for a "
    "raw numeric template id. If no template is named or none matches, "
    "proceed with event_template_id set to null; that is valid input, not "
    "missing information, so don't block on it. "
    "When an organizer asks who should fill a volunteer role (e.g. 'who "
    "should do first-aid for Saturday's cleanup'), call list_event_roles "
    "and list_event_signups (filtered to pending requests) for that event, "
    "plus list_volunteers to check skills, then recommend a candidate "
    "based on skill overlap and signup history — state your reasoning, "
    "don't just name someone. Only call approve_event_signup after the "
    "organizer explicitly confirms that specific recommendation; never "
    "approve a signup on your own initiative. "
    "When an organizer asks a question that spans every event rather than "
    "naming one — e.g. 'which volunteers haven't been approved?' or 'list "
    "upcoming tasks' — use the cross-event tool instead of asking for an "
    "event first: list_pending_signups for signup/approval questions, "
    "list_upcoming_deadlines for task questions. Present the aggregated "
    "results (grouped by event is fine), then ask the organizer whether "
    "they'd like to narrow down to a specific event — that's needed "
    "before you can take any follow-up action like approving a signup or "
    "reassigning a task, since those tools require a single event_id. "
    "send_announcement, send_shift_reminder, and generate_event_certificates "
    "message real people on WhatsApp and cannot be undone. Always call the "
    "matching preview tool first (preview_announcement, "
    "preview_shift_reminder, preview_certificate_generation), show the "
    "organizer the exact draft and recipient count, and only call the send/"
    "generate tool after they explicitly confirm — never send on your own "
    "initiative."
)


def openrouter_api_key() -> str:
    """Read the OpenRouter key the same way other config is read (env var)."""

    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise HTTPException(500, "OPENROUTER_API_KEY is not configured")
    return api_key


def openrouter_model() -> str:
    return os.environ.get("OPENROUTER_MODEL", DEFAULT_MODEL)


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


async def _stream_openrouter_completion(
    client: httpx.AsyncClient, api_key: str, model: str, messages: list[dict]
) -> AsyncIterator[dict]:
    """Yield decoded JSON chunks from an OpenRouter streaming completion."""

    async with client.stream(
        "POST",
        OPENROUTER_URL,
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "model": model,
            "messages": messages,
            "tools": TOOL_SPECS,
            "stream": True,
        },
        timeout=60,
    ) as response:
        response.raise_for_status()
        async for line in response.aiter_lines():
            if not line.startswith("data: "):
                continue
            raw = line[len("data: ") :].strip()
            if raw == "[DONE]":
                return
            yield json.loads(raw)


def _accumulate_tool_calls(existing: list[dict], delta_calls: list[dict]) -> None:
    """Merge one streamed tool_calls delta into the running list, in place.

    OpenRouter (like OpenAI) streams a tool call's name/arguments as many
    small text fragments across chunks, indexed by position, rather than
    sending each call whole — this rebuilds the whole calls from those
    fragments.
    """

    for delta in delta_calls:
        index = delta.get("index", 0)
        while len(existing) <= index:
            existing.append(
                {"id": "", "type": "function", "function": {"name": "", "arguments": ""}}
            )
        call = existing[index]
        if delta.get("id"):
            call["id"] = delta["id"]
        function_delta = delta.get("function") or {}
        if function_delta.get("name"):
            call["function"]["name"] += function_delta["name"]
        if function_delta.get("arguments"):
            call["function"]["arguments"] += function_delta["arguments"]


async def run_chat_turn(
    client: httpx.AsyncClient,
    db,
    api_key: str,
    model: str,
    conversation: list[dict],
) -> AsyncIterator[str]:
    """Drive one user turn: stream assistant text, dispatch any tool calls.

    Only one round of tool-calling is executed per turn (call the tools the
    model asked for, feed the results back, stream the follow-up reply) —
    not an open-ended agent loop. That matches TICKET-2's draft-then-approve
    flow: `publish_event` only fires on an explicit later user turn once the
    organizer approves what `create_event_draft` returned here.
    """

    messages = [{"role": "system", "content": SYSTEM_PROMPT}, *conversation]

    tool_calls: list[dict] = []
    content_so_far = ""
    finish_reason: str | None = None

    async for chunk in _stream_openrouter_completion(client, api_key, model, messages):
        choice = (chunk.get("choices") or [{}])[0]
        delta = choice.get("delta") or {}
        if delta.get("content"):
            content_so_far += delta["content"]
            yield _sse("token", {"delta": delta["content"]})
        if delta.get("tool_calls"):
            _accumulate_tool_calls(tool_calls, delta["tool_calls"])
        if choice.get("finish_reason"):
            finish_reason = choice["finish_reason"]

    if finish_reason != "tool_calls" or not tool_calls:
        yield _sse("done", {})
        return

    assistant_message = {
        "role": "assistant",
        "content": content_so_far or None,
        "tool_calls": tool_calls,
    }
    follow_up_messages = [*messages, assistant_message]

    for call in tool_calls:
        name = call["function"]["name"]
        try:
            arguments = json.loads(call["function"]["arguments"] or "{}")
        except json.JSONDecodeError:
            arguments = {}
        yield _sse("tool_call", {"tool": name, "arguments": arguments})
        result = dispatch_tool_call(db, name, arguments)
        yield _sse("tool_result", {"tool": name, "result": result})
        follow_up_messages.append(
            {
                "role": "tool",
                "tool_call_id": call["id"],
                "content": json.dumps(result),
            }
        )

    async for chunk in _stream_openrouter_completion(
        client, api_key, model, follow_up_messages
    ):
        choice = (chunk.get("choices") or [{}])[0]
        delta = choice.get("delta") or {}
        if delta.get("content"):
            yield _sse("token", {"delta": delta["content"]})

    yield _sse("done", {})


@router.post("/tools/{tool_name}")
def invoke_tool(tool_name: str, payload: ToolInvocationRequest, db: Connection) -> dict[str, Any]:
    """Directly dispatch one named tool call, bypassing the LLM (TICKET-6).

    Lets the frontend execute `publish_event` itself once the organizer
    explicitly confirms a `create_event_draft` preview, instead of routing
    the confirmation back through another chat turn. Goes through the same
    `dispatch_tool_call` schema/business/permission pipeline every LLM-issued
    tool call does — nothing about validation is skipped just because a
    human triggered it directly.
    """

    return dispatch_tool_call(db, tool_name, payload.arguments)


@router.post("/chat")
async def chat(payload: ChatRequest, db: Connection) -> StreamingResponse:
    api_key = openrouter_api_key()
    model = openrouter_model()
    conversation = [message.model_dump() for message in payload.messages]

    async def event_stream() -> AsyncIterator[str]:
        try:
            async with httpx.AsyncClient() as client:
                async for event in run_chat_turn(client, db, api_key, model, conversation):
                    yield event
        except httpx.HTTPError as error:
            yield _sse("error", {"reason": f"OpenRouter request failed: {error}"})

    return StreamingResponse(event_stream(), media_type="text/event-stream")
