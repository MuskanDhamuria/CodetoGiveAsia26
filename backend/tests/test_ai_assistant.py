"""Tests for the AI assistant chat endpoint (TICKET-1).

Never calls the real OpenRouter API — `httpx.MockTransport` fakes its
streaming chat-completions response so these run offline and don't need
`OPENROUTER_API_KEY` set to a real key.
"""

import asyncio
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from backend.api.routes import ai_assistant
from backend.database import connect, initialize_database
from backend.main import create_app


def sse_page(chunks: list[dict]) -> str:
    body = "".join(f"data: {json.dumps(chunk)}\n\n" for chunk in chunks)
    return body + "data: [DONE]\n\n"


def mock_transport(pages: list[str]) -> httpx.MockTransport:
    state = {"call": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        page = pages[min(state["call"], len(pages) - 1)]
        state["call"] += 1
        return httpx.Response(200, content=page.encode())

    return httpx.MockTransport(handler)


def collect(async_iterable) -> list[str]:
    async def _run() -> list[str]:
        return [item async for item in async_iterable]

    return asyncio.run(_run())


def parse_sse(events: list[str]) -> list[tuple[str, dict]]:
    parsed = []
    for raw in events:
        lines = raw.strip("\n").split("\n")
        event = lines[0].removeprefix("event: ")
        data = json.loads(lines[1].removeprefix("data: "))
        parsed.append((event, data))
    return parsed


class RunChatTurnTest(unittest.TestCase):
    """Exercises the streaming/tool-dispatch logic directly, without FastAPI."""

    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        database_path = Path(self.temporary_directory.name) / "test.sqlite3"
        initialize_database(database_path)
        self.db = connect(database_path)

    def tearDown(self) -> None:
        self.db.close()
        self.temporary_directory.cleanup()

    def test_streams_plain_text_when_no_tool_call_is_made(self) -> None:
        page = sse_page(
            [
                {"choices": [{"delta": {"content": "Hello"}, "finish_reason": None}]},
                {"choices": [{"delta": {"content": " there"}, "finish_reason": None}]},
                {"choices": [{"delta": {}, "finish_reason": "stop"}]},
            ]
        )

        async def run():
            async with httpx.AsyncClient(transport=mock_transport([page])) as client:
                return await self._collect(client)

        events = parse_sse(asyncio.run(run()))
        tokens = [data["delta"] for event, data in events if event == "token"]
        self.assertEqual(tokens, ["Hello", " there"])
        self.assertEqual(events[-1][0], "done")

    def test_dispatches_a_tool_call_and_streams_the_follow_up_reply(self) -> None:
        first_page = sse_page(
            [
                {
                    "choices": [
                        {
                            "delta": {
                                "tool_calls": [
                                    {
                                        "index": 0,
                                        "id": "call_1",
                                        "type": "function",
                                        "function": {
                                            "name": "create_event_draft",
                                            "arguments": "",
                                        },
                                    }
                                ]
                            },
                            "finish_reason": None,
                        }
                    ]
                },
                {
                    "choices": [
                        {
                            "delta": {
                                "tool_calls": [
                                    {
                                        "index": 0,
                                        "function": {
                                            "arguments": json.dumps(
                                                {
                                                    "event_template_id": None,
                                                    "name": "Test",
                                                    "venue": "Hub",
                                                    "event_date": "2099-01-01",
                                                }
                                            )
                                        },
                                    }
                                ]
                            },
                            "finish_reason": None,
                        }
                    ]
                },
                {"choices": [{"delta": {}, "finish_reason": "tool_calls"}]},
            ]
        )
        second_page = sse_page(
            [
                {"choices": [{"delta": {"content": "Draft ready."}, "finish_reason": None}]},
                {"choices": [{"delta": {}, "finish_reason": "stop"}]},
            ]
        )

        async def run():
            async with httpx.AsyncClient(
                transport=mock_transport([first_page, second_page])
            ) as client:
                return await self._collect(client)

        events = parse_sse(asyncio.run(run()))
        kinds = [event for event, _ in events]
        self.assertIn("tool_call", kinds)
        self.assertIn("tool_result", kinds)
        self.assertEqual(kinds[-1], "done")

        tool_call_event = next(data for event, data in events if event == "tool_call")
        self.assertEqual(tool_call_event["tool"], "create_event_draft")
        self.assertEqual(tool_call_event["arguments"]["name"], "Test")

        tool_result_event = next(data for event, data in events if event == "tool_result")
        self.assertTrue(tool_result_event["result"]["success"])
        self.assertEqual(tool_result_event["result"]["result"]["status"], "draft")

        # create_event_draft must never write to the database.
        total = self.db.execute("SELECT COUNT(*) FROM events").fetchone()[0]
        self.assertEqual(total, 0)

        final_tokens = [data["delta"] for event, data in events if event == "token"]
        self.assertEqual(final_tokens, ["Draft ready."])

    def test_a_destructive_tool_call_the_model_should_never_make_is_still_rejected(
        self,
    ) -> None:
        # Defense in depth: even if a future/misbehaving model asked for a
        # tool outside the constrained set (e.g. a hypothetical delete),
        # dispatch_tool_call must reject it by name rather than execute it.
        page = sse_page(
            [
                {
                    "choices": [
                        {
                            "delta": {
                                "tool_calls": [
                                    {
                                        "index": 0,
                                        "id": "call_1",
                                        "type": "function",
                                        "function": {
                                            "name": "delete_event",
                                            "arguments": '{"event_id": 1}',
                                        },
                                    }
                                ]
                            },
                            "finish_reason": None,
                        }
                    ]
                },
                {"choices": [{"delta": {}, "finish_reason": "tool_calls"}]},
            ]
        )
        second_page = sse_page(
            [{"choices": [{"delta": {}, "finish_reason": "stop"}]}]
        )

        async def run():
            async with httpx.AsyncClient(transport=mock_transport([page, second_page])) as client:
                return await self._collect(client)

        events = parse_sse(asyncio.run(run()))
        tool_result_event = next(data for event, data in events if event == "tool_result")
        self.assertFalse(tool_result_event["result"]["success"])
        self.assertIn("Unknown tool", tool_result_event["result"]["reason"])

    async def _collect(self, client: httpx.AsyncClient) -> list[str]:
        return [
            item
            async for item in ai_assistant.run_chat_turn(
                client, self.db, "fake-key", "fake-model", [{"role": "user", "content": "hi"}]
            )
        ]


class ChatEndpointTest(unittest.TestCase):
    """Exercises the actual HTTP route, including config/validation errors."""

    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        database_path = Path(self.temporary_directory.name) / "test.sqlite3"
        self.client_context = None
        self._app = create_app(database_path)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_missing_api_key_returns_a_server_error(self) -> None:
        from fastapi.testclient import TestClient

        env = dict(os.environ)
        env.pop("OPENROUTER_API_KEY", None)
        with patch.dict(os.environ, env, clear=True):
            with TestClient(self._app) as client:
                response = client.post(
                    "/api/v1/ai/chat", json={"messages": [{"role": "user", "content": "hi"}]}
                )
        self.assertEqual(response.status_code, 500)

    def test_empty_message_list_is_rejected_before_calling_openrouter(self) -> None:
        from fastapi.testclient import TestClient

        with patch.dict(os.environ, {"OPENROUTER_API_KEY": "fake"}):
            with TestClient(self._app) as client:
                response = client.post("/api/v1/ai/chat", json={"messages": []})
        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()
