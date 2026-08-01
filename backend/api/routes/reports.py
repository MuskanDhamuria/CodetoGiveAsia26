"""Post-event report and publicity endpoints."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from backend.database import connect


router = APIRouter(prefix="/reports", tags=["reports"])


class CompletedEventReport(BaseModel):
    id: int
    name: str
    date: str
    venue: str
    template_name: str
    is_skills_workshop: bool
    report_status: Literal["Complete", "Incomplete"]
    attendees: int
    volunteers: int
    participant_names: list[str]
    volunteer_names: list[str]
    partners: list[str]
    generated_caption: str


class CompleteReportResponse(BaseModel):
    event_id: int
    report_status: Literal["Complete"]


class PhotoCaptionRequest(BaseModel):
    file_name: str = Field(min_length=1)
    caption: str = ""
    alt_text: str = ""


class PhotoCaptionResponse(BaseModel):
    id: int
    event_id: int


class GeneratePhotoCaptionRequest(BaseModel):
    file_name: str = Field(min_length=1)
    mime_type: str = Field(pattern=r"^image/")
    image_data: str = Field(min_length=1)
    event_name: str = ""
    venue: str = ""
    attendees: int = 0
    volunteers: int = 0
    partners: list[str] = []


class GeneratePhotoCaptionResponse(PhotoCaptionResponse):
    caption: str
    alt_text: str


def build_caption(
    name: str,
    attendees: int,
    volunteers: int,
    partners: list[str],
) -> str:
    partner_text = ", ".join(partners) if partners else "our community partners"
    return (
        f"{name} welcomed {attendees} attendees with the support of "
        f"{volunteers} volunteers and partners {partner_text}. Thank you to "
        "everyone who helped create a meaningful day of service and community "
        "connection. #PassionToServe #VolunteerSG"
    )


def parse_gemini_caption(text: str, event_name: str, file_name: str) -> tuple[str, str]:
    caption = ""
    alt_text = ""
    for line in text.splitlines():
        normalized_line = line.strip()
        lower_line = normalized_line.lower()
        if lower_line.startswith("caption:"):
            caption = normalized_line.split(":", 1)[1].strip()
        if lower_line.startswith("alt text:") or lower_line.startswith("alt_text:"):
            alt_text = normalized_line.split(":", 1)[1].strip()

    if not caption:
        caption = text.strip()
    if not alt_text:
        alt_text = f"Uploaded event photo from {event_name}. File name: {file_name}."

    return caption, alt_text


async def generate_caption_with_gemini(
    *,
    event_name: str,
    venue: str,
    attendees: int,
    volunteers: int,
    partners: list[str],
    file_name: str,
    mime_type: str,
    image_data: str,
) -> tuple[str, str]:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="GEMINI_API_KEY is not configured",
        )

    partner_text = ", ".join(partners) if partners else "community partners"
    prompt = (
        "Look closely at the uploaded post-event photo and describe what is "
        "visibly happening. Do not invent people, actions, logos, emotions, "
        "or organizations that are not visible.\n"
        f"Event: {event_name}\n"
        f"Venue: {venue}\n"
        f"Attendees: {attendees}\n"
        f"Volunteers: {volunteers}\n"
        f"Partners: {partner_text}\n"
        f"File name: {file_name}\n\n"
        "Return exactly two lines:\n"
        "Caption: one warm social media caption under 45 words that starts "
        "by describing the visible scene, then briefly connects it to the event.\n"
        "Alt text: concise accessible alt text under 25 words describing only "
        "visible photo content."
    )
    model = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")
    payload = {
        "contents": [
            {
                "parts": [
                    {
                        "inline_data": {
                            "mime_type": mime_type,
                            "data": image_data,
                        }
                    },
                    {"text": prompt},
                ]
            }
        ]
    }

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                headers={
                    "Content-Type": "application/json",
                    "x-goog-api-key": api_key,
                },
                json=payload,
            )
            response.raise_for_status()
    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Gemini caption generation failed",
        ) from error

    data = response.json()
    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError) as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Gemini returned an unexpected response",
        ) from error

    return parse_gemini_caption(text, event_name, file_name)


@router.get(
    "/completed",
    response_model=list[CompletedEventReport],
    summary="List completed events for post-event reports",
)
def completed_reports(request: Request) -> list[CompletedEventReport]:
    database_path: Path = request.app.state.database_path
    with connect(database_path) as connection:
        rows = connection.execute(
            """
            SELECT
                events.id,
                events.name,
                events.event_date,
                events.venue,
                event_templates.name AS template_name,
                COALESCE(event_reports.status, 'incomplete') AS report_status,
                COALESCE(event_reports.generated_caption, '') AS generated_caption,
                COUNT(DISTINCT participations.id) AS attendees,
                COUNT(DISTINCT volunteer_signups.id) AS volunteers,
                GROUP_CONCAT(DISTINCT event_partners.name) AS partners,
                GROUP_CONCAT(DISTINCT participants.name) AS participant_names,
                GROUP_CONCAT(DISTINCT volunteers.name) AS volunteer_names
            FROM events
            JOIN event_templates
                ON event_templates.id = events.event_template_id
            LEFT JOIN event_reports
                ON event_reports.event_id = events.id
            LEFT JOIN participations
                ON participations.event_id = events.id
                AND COALESCE(participations.attendance, 1) = 1
            LEFT JOIN participants
                ON participants.id = participations.participant_id
            LEFT JOIN volunteer_signups
                ON volunteer_signups.event_id = events.id
                AND volunteer_signups.status = 'approved'
                AND COALESCE(volunteer_signups.attendance, 1) = 1
            LEFT JOIN volunteers
                ON volunteers.id = volunteer_signups.volunteer_id
            LEFT JOIN event_partners
                ON event_partners.event_id = events.id
            WHERE events.status = 'closed'
            GROUP BY events.id
            ORDER BY events.event_date DESC, events.id DESC
            """
        ).fetchall()

    reports: list[CompletedEventReport] = []
    for row in rows:
        partners = [partner for partner in (row["partners"] or "").split(",") if partner]
        participant_names = [
            name for name in (row["participant_names"] or "").split(",") if name
        ]
        volunteer_names = [
            name for name in (row["volunteer_names"] or "").split(",") if name
        ]
        generated_caption = row["generated_caption"] or build_caption(
            row["name"],
            row["attendees"],
            row["volunteers"],
            partners,
        )
        reports.append(
            CompletedEventReport(
                id=row["id"],
                name=row["name"],
                date=row["event_date"],
                venue=row["venue"],
                template_name=row["template_name"],
                is_skills_workshop=(
                    "skill" in row["name"].lower()
                    or "workshop" in row["name"].lower()
                    or "skill" in row["template_name"].lower()
                    or "workshop" in row["template_name"].lower()
                ),
                report_status="Complete"
                if row["report_status"] == "complete"
                else "Incomplete",
                attendees=row["attendees"],
                volunteers=row["volunteers"],
                participant_names=participant_names,
                volunteer_names=volunteer_names,
                partners=partners,
                generated_caption=generated_caption,
            )
        )
    return reports


@router.put(
    "/{event_id}/complete",
    response_model=CompleteReportResponse,
    summary="Mark a completed event report complete",
)
def mark_report_complete(event_id: int, request: Request) -> CompleteReportResponse:
    database_path: Path = request.app.state.database_path
    with connect(database_path) as connection:
        connection.execute(
            """
            INSERT INTO event_reports (event_id, status, completed_at)
            VALUES (?, 'complete', CURRENT_TIMESTAMP)
            ON CONFLICT(event_id) DO UPDATE SET
                status = 'complete',
                completed_at = CURRENT_TIMESTAMP
            """,
            (event_id,),
        )

    return CompleteReportResponse(event_id=event_id, report_status="Complete")


@router.post(
    "/{event_id}/photo-caption",
    response_model=GeneratePhotoCaptionResponse,
    summary="Generate and save an AI caption for an uploaded event photo",
)
async def generate_photo_caption(
    event_id: int,
    payload: GeneratePhotoCaptionRequest,
    request: Request,
) -> GeneratePhotoCaptionResponse:
    database_path: Path = request.app.state.database_path
    with connect(database_path) as connection:
        event_row = connection.execute(
            """
            SELECT
                events.name,
                events.venue,
                COUNT(DISTINCT participations.id) AS attendees,
                COUNT(DISTINCT volunteer_signups.id) AS volunteers,
                GROUP_CONCAT(DISTINCT event_partners.name) AS partners
            FROM events
            LEFT JOIN participations
                ON participations.event_id = events.id
                AND COALESCE(participations.attendance, 1) = 1
            LEFT JOIN volunteer_signups
                ON volunteer_signups.event_id = events.id
                AND volunteer_signups.status = 'approved'
                AND COALESCE(volunteer_signups.attendance, 1) = 1
            LEFT JOIN event_partners
                ON event_partners.event_id = events.id
            WHERE events.id = ?
            GROUP BY events.id
            """,
            (event_id,),
        ).fetchone()

    partners = (
        [partner for partner in (event_row["partners"] or "").split(",") if partner]
        if event_row is not None
        else payload.partners
    )
    caption, alt_text = await generate_caption_with_gemini(
        event_name=event_row["name"] if event_row is not None else payload.event_name,
        venue=event_row["venue"] if event_row is not None else payload.venue,
        attendees=event_row["attendees"] if event_row is not None else payload.attendees,
        volunteers=event_row["volunteers"] if event_row is not None else payload.volunteers,
        partners=partners,
        file_name=payload.file_name,
        mime_type=payload.mime_type,
        image_data=payload.image_data,
    )

    if event_row is None:
        return GeneratePhotoCaptionResponse(
            id=0,
            event_id=event_id,
            caption=caption,
            alt_text=alt_text,
        )

    with connect(database_path) as connection:
        row = connection.execute(
            """
            INSERT INTO report_photo_captions
                (event_id, file_name, caption, alt_text)
            VALUES (?, ?, ?, ?)
            RETURNING id
            """,
            (event_id, payload.file_name, caption, alt_text),
        ).fetchone()

    return GeneratePhotoCaptionResponse(
        id=row["id"],
        event_id=event_id,
        caption=caption,
        alt_text=alt_text,
    )


@router.post(
    "/{event_id}/photo-captions",
    response_model=PhotoCaptionResponse,
    summary="Save a generated photo caption",
)
def save_photo_caption(
    event_id: int,
    payload: PhotoCaptionRequest,
    request: Request,
) -> PhotoCaptionResponse:
    database_path: Path = request.app.state.database_path
    with connect(database_path) as connection:
        row = connection.execute(
            """
            INSERT INTO report_photo_captions
                (event_id, file_name, caption, alt_text)
            VALUES (?, ?, ?, ?)
            RETURNING id
            """,
            (event_id, payload.file_name, payload.caption, payload.alt_text),
        ).fetchone()

    return PhotoCaptionResponse(id=row["id"], event_id=event_id)
