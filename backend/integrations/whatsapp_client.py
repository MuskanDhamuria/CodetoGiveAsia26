"""Thin wrapper around the Meta WhatsApp Cloud API.

Configuration is read from environment variables so the same code path works
in development (with no credentials, falling back to a client that only logs)
and in production:

- ``WHATSAPP_TOKEN``: permanent or temporary Meta access token.
- ``WHATSAPP_PHONE_NUMBER_ID``: the sending number's Cloud API phone number ID.
- ``WHATSAPP_APP_SECRET``: app secret used to verify inbound webhook signatures.
- ``WHATSAPP_VERIFY_TOKEN``: shared secret used for the webhook verification
  handshake (``hub.verify_token``).
- ``WHATSAPP_API_VERSION``: Graph API version, defaults to ``v20.0``.

Every network call goes through :class:`WhatsAppClient.send_text`, which is
the single seam tests replace with a fake implementation.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

DEFAULT_API_VERSION = "v20.0"


class WhatsAppError(RuntimeError):
    """Raised when the Cloud API rejects a request."""


@dataclass
class SentMessage:
    to: str
    body: str
    wa_message_id: str | None = None


@dataclass
class WhatsAppClient:
    """Sends outbound WhatsApp messages via the Meta Graph API."""

    token: str
    phone_number_id: str
    api_version: str = DEFAULT_API_VERSION

    def send_text(self, to: str, body: str) -> SentMessage:
        try:
            import httpx
        except ImportError as error:  # pragma: no cover - dependency is required in prod
            logger.error("Cannot send WhatsApp message: httpx is not installed")
            raise WhatsAppError(
                "httpx is required to send WhatsApp messages; install backend/requirements.txt"
            ) from error

        url = f"https://graph.facebook.com/{self.api_version}/{self.phone_number_id}/messages"
        logger.info("Sending WhatsApp message to %s (%d chars)", to, len(body))
        try:
            response = httpx.post(
                url,
                headers={"Authorization": f"Bearer {self.token}"},
                json={
                    "messaging_product": "whatsapp",
                    "to": to,
                    "type": "text",
                    "text": {"body": body},
                },
                timeout=10.0,
            )
        except httpx.HTTPError as error:
            logger.error("WhatsApp send to %s failed: network error: %s", to, error)
            raise WhatsAppError(f"WhatsApp send to {to} failed: {error}") from error

        if response.status_code >= 400:
            logger.error(
                "WhatsApp send to %s failed (%d): %s", to, response.status_code, response.text
            )
            raise WhatsAppError(
                f"WhatsApp send failed ({response.status_code}): {response.text}"
            )
        payload = response.json()
        message_id = None
        messages = payload.get("messages") or []
        if messages:
            message_id = messages[0].get("id")
        logger.info("WhatsApp message sent to %s (id=%s)", to, message_id)
        return SentMessage(to=to, body=body, wa_message_id=message_id)

    def send_template(
        self,
        to: str,
        template_name: str,
        language_code: str,
        body_params: list[str] | None = None,
        button_param: str | None = None,
        button_sub_type: str = "url",
    ) -> SentMessage:
        """Send an approved Meta template message (e.g. an OTP code).

        Unlike ``send_text``, template messages can be sent to a number even
        outside the 24-hour customer-service window, which is why they're
        used for OTP delivery right after someone registers on the website
        (they haven't necessarily messaged the bot first).

        ``button_param`` fills a button component at index 0. Pass ``None``
        if the template has no button component. ``button_sub_type`` must
        match how the button was actually configured in Meta's template
        editor — despite the editor showing it as a "Copy code" button, the
        Cloud API has been observed to reject anything but ``"url"`` for
        some authentication templates (error 132018, "Button at index 0 must
        be of type Url"); Meta's UI label doesn't reliably predict which sub
        type the API expects, so this is configurable rather than hardcoded.
        """

        try:
            import httpx
        except ImportError as error:  # pragma: no cover - dependency is required in prod
            logger.error("Cannot send WhatsApp template: httpx is not installed")
            raise WhatsAppError(
                "httpx is required to send WhatsApp messages; install backend/requirements.txt"
            ) from error

        components: list[dict] = []
        if body_params:
            components.append(
                {
                    "type": "body",
                    "parameters": [{"type": "text", "text": value} for value in body_params],
                }
            )
        if button_param is not None:
            components.append(
                {
                    "type": "button",
                    "sub_type": button_sub_type,
                    "index": "0",
                    "parameters": [{"type": "text", "text": button_param}],
                }
            )

        url = f"https://graph.facebook.com/{self.api_version}/{self.phone_number_id}/messages"
        logger.info("Sending WhatsApp template %r to %s", template_name, to)
        try:
            response = httpx.post(
                url,
                headers={"Authorization": f"Bearer {self.token}"},
                json={
                    "messaging_product": "whatsapp",
                    "to": to,
                    "type": "template",
                    "template": {
                        "name": template_name,
                        "language": {"code": language_code},
                        "components": components,
                    },
                },
                timeout=10.0,
            )
        except httpx.HTTPError as error:
            logger.error("WhatsApp template send to %s failed: network error: %s", to, error)
            raise WhatsAppError(f"WhatsApp template send to {to} failed: {error}") from error

        if response.status_code >= 400:
            logger.error(
                "WhatsApp template send to %s failed (%d): %s", to, response.status_code, response.text
            )
            raise WhatsAppError(
                f"WhatsApp template send failed ({response.status_code}): {response.text}"
            )
        payload = response.json()
        message_id = None
        messages = payload.get("messages") or []
        if messages:
            message_id = messages[0].get("id")
        logger.info("WhatsApp template sent to %s (id=%s)", to, message_id)
        return SentMessage(to=to, body=f"[template:{template_name}]", wa_message_id=message_id)


@dataclass
class LoggingWhatsAppClient:
    """Fallback client used when no Cloud API credentials are configured.

    Logs the message instead of sending it, so the bot and admin endpoints
    remain usable in local development without a Meta Business account.
    """

    sent: list[SentMessage] = field(default_factory=list)

    def send_text(self, to: str, body: str) -> SentMessage:
        logger.info("WhatsApp (not configured, not sent) -> %s: %s", to, body)
        message = SentMessage(to=to, body=body, wa_message_id=None)
        self.sent.append(message)
        return message

    def send_template(
        self,
        to: str,
        template_name: str,
        language_code: str,
        body_params: list[str] | None = None,
        button_param: str | None = None,
        button_sub_type: str = "url",
    ) -> SentMessage:
        body = (
            f"[template:{template_name}:{language_code}] params={body_params} "
            f"button={button_param} button_sub_type={button_sub_type}"
        )
        logger.info("WhatsApp (not configured, not sent) -> %s: %s", to, body)
        message = SentMessage(to=to, body=body, wa_message_id=None)
        self.sent.append(message)
        return message


def get_client() -> WhatsAppClient | LoggingWhatsAppClient:
    """Build the configured client, or a logging fallback for local dev."""

    token = os.environ.get("WHATSAPP_TOKEN")
    phone_number_id = os.environ.get("WHATSAPP_PHONE_NUMBER_ID")
    if token and phone_number_id:
        return WhatsAppClient(
            token=token,
            phone_number_id=phone_number_id,
            api_version=os.environ.get("WHATSAPP_API_VERSION", DEFAULT_API_VERSION),
        )
    logger.warning(
        "WHATSAPP_TOKEN/WHATSAPP_PHONE_NUMBER_ID not set — WhatsApp messages will only be "
        "logged, not sent. Set both env vars to send real messages."
    )
    return LoggingWhatsAppClient()


def verify_webhook_signature(payload: bytes, signature_header: str | None) -> bool:
    """Validate Meta's ``X-Hub-Signature-256`` header against the app secret.

    Returns ``True`` when no app secret is configured, so local development
    and tests can exercise the webhook without simulating a signed request.
    Once ``WHATSAPP_APP_SECRET`` is set, an invalid or missing signature is
    rejected.
    """

    app_secret = os.environ.get("WHATSAPP_APP_SECRET")
    if not app_secret:
        return True
    if not signature_header or not signature_header.startswith("sha256="):
        logger.warning("Rejected WhatsApp webhook: missing or malformed X-Hub-Signature-256 header")
        return False
    expected = hmac.new(app_secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    provided = signature_header.split("=", 1)[1]
    valid = hmac.compare_digest(expected, provided)
    if not valid:
        logger.warning(
            "Rejected WhatsApp webhook: signature does not match WHATSAPP_APP_SECRET "
            "(check the app secret matches the app the webhook is registered under)"
        )
    return valid


def verify_webhook_challenge(mode: str | None, token: str | None) -> bool:
    """Check the ``hub.mode``/``hub.verify_token`` handshake Meta performs once."""

    verify_token = os.environ.get("WHATSAPP_VERIFY_TOKEN")
    if not verify_token:
        logger.warning(
            "WhatsApp webhook verification requested but WHATSAPP_VERIFY_TOKEN is not set"
        )
        return False
    if mode != "subscribe" or token != verify_token:
        logger.warning(
            "WhatsApp webhook verification failed: hub.mode=%r, token matched=%s",
            mode,
            token == verify_token,
        )
        return False
    return True
