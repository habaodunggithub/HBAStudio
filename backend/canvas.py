"""Board contents and layout are independent of business revisions."""

from typing import Literal
from pydantic import BaseModel, ConfigDict, Field
from . import domain
from .db import Session, transaction
from .models import CanvasBoard, Course, ENTITIES


class Position(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    x: float = Field(ge=-1000000, le=1000000)
    y: float = Field(ge=-1000000, le=1000000)


class Camera(Position):
    zoom: float = Field(ge=0.25, le=2)


class Size(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    width: float = Field(ge=260, le=2400)
    height: float = Field(ge=180, le=2400)


class NoteCard(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["note"] = "note"
    title: str = Field(default="Ghi chú", max_length=200)
    text: str = Field(default="", max_length=50000)


class Edge(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: str = Field(min_length=1, max_length=250)
    target: str = Field(min_length=1, max_length=250)
    arrow: bool = True


class LayoutPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    nodes: dict[str, Position] = Field(default_factory=dict, max_length=3000)
    camera: Camera | None = None
    sizes: dict[str, Size] = Field(default_factory=dict, max_length=3000)
    cards: dict[str, NoteCard | None] = Field(default_factory=dict, max_length=300)
    edges: dict[str, Edge | None] = Field(default_factory=dict, max_length=1000)
    hidden: list[str] | None = Field(default=None, max_length=3000)
    suggestions: bool | None = None
    view: Literal["board", "list"] | None = None


def check_board(s, ident):
    if ident in ("home", "unassigned", "work"):
        return
    if ident.startswith("work:"):
        _, kind, work_id = (ident.split(":", 2) + [""] * 2)[:3]
        if kind in {"tasks", "deadlines", "projects"} and s.get(ENTITIES[kind], work_id):
            return
    elif ident.startswith("course:") and s.get(Course, ident[7:]):
        return
    domain.fail("Không gian không còn tồn tại", 404)


def read(ident):
    with Session() as s:
        check_board(s, ident)
        row = s.get(CanvasBoard, ident)
        return row.data if row else {"nodes": {}, "camera": None}


def update(ident, payload):
    keys = (
        list(payload.nodes) + list(payload.sizes) + list(payload.cards) + list(payload.edges) + (payload.hidden or [])
    )
    if any(not key or len(key) > 250 for key in keys):
        domain.fail("Thẻ không hợp lệ")
    with transaction() as s:
        check_board(s, ident)
        row = s.get(CanvasBoard, ident)
        if row is None:
            row = CanvasBoard(id=ident, data={"nodes": {}, "camera": None})
            s.add(row)
        data = dict(row.data)
        for field, limit in (("nodes", 3000), ("sizes", 3000), ("cards", 300), ("edges", 1000)):
            patch = getattr(payload, field)
            if not patch:
                continue
            values = dict(data.get(field, {}))
            for key, value in patch.items():
                if value is None:
                    values.pop(key, None)
                    if field == "cards":
                        data["edges"] = {
                            k: e for k, e in data.get("edges", {}).items() if key not in (e["source"], e["target"])
                        }
                else:
                    values[key] = value.model_dump()
            if len(values) > limit:
                domain.fail("Không gian đã đủ số thẻ hoặc đường nối")
            data[field] = values
        for field in ("camera", "hidden", "suggestions", "view"):
            value = getattr(payload, field)
            if value is not None:
                data[field] = value.model_dump() if field == "camera" else value
        row.data = data
        return row.data
