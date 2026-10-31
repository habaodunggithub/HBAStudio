from .conftest import create


def test_layouts_merge_and_survive_business_undo_without_invalidating_drafts(client):
    course = create(client, "courses", title="Hệ điều hành")
    revision = client.get("/api/v1/workspace").json()["revision"]
    draft = client.post(
        "/api/v1/proposals",
        json={
            "operations": [
                {
                    "kind": "deadlines",
                    "action": "create",
                    "data": {"title": "Lab 3", "course_id": course["id"], "due_at": "2026-10-25"},
                }
            ]
        },
    ).json()
    assert client.get("/api/v1/canvas/home").json() == {"nodes": {}, "camera": None}
    path = "/api/v1/canvas/course:" + course["id"]
    assert (
        client.patch(
            path, json={"nodes": {"first": {"x": -55, "y": 900}}, "camera": {"x": 400, "y": -100, "zoom": 0.6}}
        ).status_code
        == 200
    )
    assert client.patch(path, json={"nodes": {"second": {"x": 300, "y": 150}}}).status_code == 200
    layout = client.get(path).json()
    assert layout["nodes"] == {"first": {"x": -55, "y": 900}, "second": {"x": 300, "y": 150}}
    assert layout["camera"]["zoom"] == 0.6
    assert client.get("/api/v1/workspace").json()["revision"] == revision
    applied = client.post("/api/v1/proposals/" + draft["id"] + "/apply")
    assert applied.status_code == 200
    assert client.post("/api/v1/revisions/" + applied.json()["revision_id"] + "/undo").status_code == 200
    assert client.get(path).json() == layout
    assert client.get("/api/v1/canvas/home").json()["nodes"] == {}
    assert client.patch("/api/v1/canvas/work", json={"camera": {"x": 120, "y": -20, "zoom": 0.8}}).status_code == 200
    assert client.get("/api/v1/canvas/work").json()["camera"]["zoom"] == 0.8
    assert client.get("/api/v1/canvas/home").json()["camera"] is None
    assert client.get(path).json() == layout


def test_layout_checks_course_and_rejects_invalid_coordinates(client):
    assert client.get("/api/v1/canvas/course:missing").status_code == 404
    for patch in (
        {"camera": {"x": 0, "y": 0, "zoom": 0}},
        {"nodes": {"x": {"x": 1000001, "y": 0}}},
        {"nodes": {"x": {"x": "NaN", "y": 0}}},
    ):
        assert client.patch("/api/v1/canvas/home", json=patch).status_code == 422
    assert client.get("/api/v1/canvas/home").json()["nodes"] == {}
