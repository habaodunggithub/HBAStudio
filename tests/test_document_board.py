from io import BytesIO
from pathlib import Path
from openpyxl import Workbook
from .conftest import create
from backend import config, knowledge
from backend.db import transaction
from backend.models import Document


def test_work_board_contents_are_independent_and_merge_without_losing_notes(client):
    first = create(client, "tasks", title="Board A")
    second = create(client, "tasks", title="Board B")
    path = "/api/v1/canvas/work:tasks:" + first["id"]
    revision = client.get("/api/v1/workspace").json()["revision"]
    patch = {
        "cards": {"note:a": {"title": "Ý tưởng", "text": "Giữ nguyên nội dung"}},
        "nodes": {"note:a": {"x": 120, "y": -40}},
        "sizes": {"note:a": {"width": 410, "height": 310}},
        "edges": {"edge:a": {"source": "steps", "target": "note:a", "arrow": True}},
        "view": "board",
        "suggestions": True,
    }
    assert client.patch(path, json=patch).status_code == 200
    assert client.patch(path, json={"camera": {"x": 20, "y": 50, "zoom": 0.75}}).status_code == 200
    stored = client.get(path).json()
    assert stored["cards"]["note:a"]["text"] == "Giữ nguyên nội dung"
    assert stored["sizes"]["note:a"]["width"] == 410
    assert client.get("/api/v1/canvas/work:tasks:" + second["id"]).json() == {"nodes": {}, "camera": None}
    assert client.get("/api/v1/workspace").json()["revision"] == revision
    assert client.patch(path, json={"edges": {"edge:a": None}}).status_code == 200
    assert client.get(path).json()["edges"] == {}
    assert client.patch(path, json={"sizes": {"note:a": {"width": -1, "height": 310}}}).status_code == 422
    assert client.get("/api/v1/canvas/work:tasks:missing").status_code == 404


def test_document_reader_auth_file_boundaries_and_xlsx_paging(client, tmp_path):
    work = create(client, "tasks", title="Read workbook")
    book = Workbook()
    book.active.title = "Dữ liệu"
    for i in range(205):
        book.active.append([f"Hàng {i + 1}", i + 1])
    book.create_sheet("Tổng kết").append(["Tổng", 205])
    buffer = BytesIO()
    book.save(buffer)
    result = client.post(
        "/api/v1/knowledge/upload",
        data={"work_kind": "tasks", "work_id": work["id"]},
        files={"file": ("workbook.xlsx", buffer.getvalue())},
    )
    assert result.status_code == 200
    ident = result.json()["id"]
    path = "/api/v1/knowledge/documents/" + ident
    original = client.get(path + "/file")
    assert original.status_code == 200 and original.content == buffer.getvalue()
    assert original.headers["content-type"].startswith("application/vnd.openxmlformats")
    page = client.get(path + "/spreadsheet?row=100").json()
    assert page["sheets"] == ["Dữ liệu", "Tổng kết"] and page["values"][0] == ["Hàng 101", "101"]
    assert len(page["values"]) == 100 and page["rows"] == 205
    assert client.get(path + "/spreadsheet?sheet=1").json()["values"][0] == ["Tổng", "205"]
    assert client.get(path + "/spreadsheet?sheet=2").status_code == 404
    assert client.get(path + "/spreadsheet?row=-1").status_code == 422
    with transaction() as s:
        doc = s.get(Document, ident)
        actual = Path(doc.data["path"])
    assert any("Hàng 101" in text for _, text in knowledge.extract(actual))
    outside = tmp_path / "private.txt"
    outside.write_text("private")
    with transaction() as s:
        s.add(Document(id="outside", data={"path": str(outside), "title": "private.txt"}))
    assert client.get("/api/v1/knowledge/documents/outside/file").status_code == 404
    symlink = config.DATA / "uploads" / "escaped.txt"
    symlink.symlink_to(outside)
    with transaction() as s:
        s.add(Document(id="symlink", data={"path": str(symlink)}))
    assert client.get("/api/v1/knowledge/documents/symlink/file").status_code == 404
    client.cookies.clear()
    assert client.get(path + "/file").status_code == 401
