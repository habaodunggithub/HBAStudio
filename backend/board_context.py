"""Resolve explicitly tagged board cards from saved app data."""

import json
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field
from . import canvas, domain, workspaces
from .db import write_lock


class CardReference(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["tasks", "deadlines", "projects"]
    id: str = Field(min_length=1, max_length=200)
    card_key: str = Field(min_length=1, max_length=250)


def resolve(references):
    attached, boards, seen, remaining = [], {}, set(), 48000
    with write_lock:
        for ref in references:
            key = (ref.kind, ref.id, ref.card_key)
            if key in seen:
                continue
            seen.add(key)
            board_key = (ref.kind, ref.id)
            if board_key not in boards:
                boards[board_key] = (workspaces.context(ref.kind, ref.id), canvas.read(f"work:{ref.kind}:{ref.id}"))
            detail, layout = boards[board_key]
            item, card = detail["item"], ref.card_key
            title, kind, value, document_id = "", "", None, None
            if card == "steps":
                title, kind, value = "Đầu việc", "steps", item.get("checklist", [])
            elif card.startswith("note:") and card in layout.get("cards", {}):
                note = layout["cards"][card]
                title, kind, value = note.get("title") or "Ghi chú", "note", note.get("text", "")
            elif card.startswith("task:"):
                task = next(
                    (task for task in detail["tasks"] if "task:" + task["id"] == card and task["id"] != item["id"]),
                    None,
                )
                if task:
                    title, kind, value = task["title"], "task", task
            elif card.startswith("document:"):
                doc = next((doc for doc in detail["documents"] if "document:" + doc["id"] == card), None)
                if doc:
                    title, kind, document_id = doc["title"], "document", doc["id"]
                    if doc.get("status") == "pending":
                        domain.fail(f"Tài liệu {title} đang được xử lý. Hãy gửi lại khi tài liệu sẵn sàng.", 409)
                    value = {field: doc.get(field) for field in ("status", "error", "unavailable")}
            elif card == "suggestions" and layout.get("suggestions"):
                analysis = detail["analysis"]
                title, kind = "Gợi ý Codex", "suggestions"
                value = {
                    "status": analysis["status"],
                    "stale": analysis["stale"],
                    "brief": analysis.get("brief") if not analysis["stale"] else None,
                }
            if value is None:
                domain.fail("Có thẻ đính kèm không còn tồn tại trong không gian. Hãy gỡ thẻ đó và chọn lại.", 404)
            content = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
            limit = min(12000, remaining)
            attached.append(
                {
                    **ref.model_dump(),
                    "title": title,
                    "type": kind,
                    "work_title": item["title"],
                    "text": content[:limit],
                    "truncated": len(content) > limit,
                    **({"document_id": document_id} if document_id else {}),
                }
            )
            remaining -= min(len(content), limit)
    return attached
