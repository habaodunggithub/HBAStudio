"""Real stdio MCP protocol check, optionally including a real Codex CLI turn.

Runs against an isolated temporary workspace; never changes personal tasks.
"""

import asyncio
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
import httpx
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parent.parent


async def verify(env):
    params = StdioServerParameters(command=sys.executable, args=["-m", "backend.mcp_server"], env=env, cwd=str(ROOT))
    async with stdio_client(params) as (reader, writer):
        async with ClientSession(reader, writer) as session:
            await session.initialize()
            available = await session.list_tools()
            assert {t.name for t in available.tools} == {
                "get_planning_context",
                "search_knowledge",
                "get_source_excerpt",
                "propose_changes",
                "preview_schedule",
            }
            context = await session.call_tool("get_planning_context", {})
            assert not context.isError
            search = await session.call_tool("search_knowledge", {"query": "yeu cau bao cao"})
            assert not search.isError
            payload = json.loads(search.content[0].text)
            assert payload["hits"]
            excerpt = await session.call_tool("get_source_excerpt", {"chunk_id": payload["hits"][0]["chunk_id"]})
            assert not excerpt.isError
            draft = await session.call_tool(
                "propose_changes",
                {
                    "title": "MCP protocol smoke",
                    "operations": [
                        {
                            "kind": "tasks",
                            "action": "create",
                            "data": {"title": "Đọc yêu cầu báo cáo", "estimate_minutes": 45},
                        }
                    ],
                },
            )
            assert not draft.isError, draft
            print("MCP stdio: 5 tools, live context, cited search, excerpt and draft verified", flush=True)


def main():
    with tempfile.TemporaryDirectory(prefix="pdm-mcp-smoke-") as directory:
        env = {
            **os.environ,
            "PDM_DATA_DIR": directory + "/data",
            "PDM_CACHE_DIR": directory + "/cache",
            "PDM_PORT": "8767",
            "PDM_NO_WORKER": "1",
        }
        server = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "backend.app:app",
                "--host",
                "127.0.0.1",
                "--port",
                "8767",
                "--no-access-log",
            ],
            cwd=ROOT,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        try:
            with httpx.Client(base_url="http://127.0.0.1:8767/api/v1", timeout=10) as client:
                for _ in range(100):
                    try:
                        if client.get("/health").is_success:
                            break
                    except httpx.ConnectError:
                        pass
                    time.sleep(0.1)
                else:
                    raise RuntimeError("Backend did not start")
                client.get("/bootstrap")
                upload = client.post(
                    "/knowledge/upload",
                    files={
                        "file": (
                            "spec.md",
                            "# Yêu cầu báo cáo\nBáo cáo cần có phân tích thuật toán và thực nghiệm.".encode(),
                            "text/markdown",
                        )
                    },
                ).json()
                # Test worker is off for deterministic isolation: explicitly ingest the fixture.
                code = (
                    "from backend.knowledge import ingest; import pathlib; p=next((pathlib.Path(__import__('os').environ['PDM_DATA_DIR'])/'uploads').iterdir()); ingest(p,doc_id="
                    + repr(upload["id"])
                    + ")"
                )
                subprocess.run([sys.executable, "-c", code], env=env, cwd=ROOT, check=True, capture_output=True)
                asyncio.run(verify(env))
                assert client.get("/tasks").json() == []
                assert len(client.get("/workspace").json()["proposals"]) == 1
                if "--codex" in sys.argv:
                    commands = [
                        "codex",
                        "exec",
                        "--skip-git-repo-check",
                        "--sandbox",
                        "read-only",
                        "-c",
                        'mcp_servers.pdm_verify.command="' + sys.executable + '"',
                        "-c",
                        'mcp_servers.pdm_verify.args=["-m","backend.mcp_server"]',
                        "-c",
                        'mcp_servers.pdm_verify.cwd="' + str(ROOT) + '"',
                        "-c",
                        'mcp_servers.pdm_verify.env={PDM_DATA_DIR="'
                        + env["PDM_DATA_DIR"]
                        + '",PDM_CACHE_DIR="'
                        + env["PDM_CACHE_DIR"]
                        + '",PDM_PORT="8767"}',
                        "-c",
                        "mcp_servers.pdm_verify.required=true",
                        'Đây là kiểm chứng tích hợp MCP trong workspace tạm. Chỉ dùng tools của pdm_verify, không dùng shell/web hay tool khác. Gọi get_planning_context, search_knowledge với query "yêu cầu báo cáo", get_source_excerpt theo kết quả, rồi propose_changes tạo đúng một task tên "Codex live verification" thời lượng 30 phút. Không áp dụng. Trả ngắn gọn nguồn đã đọc và id bản nháp.',
                    ]
                    result = subprocess.run(commands, cwd=ROOT, env=env, capture_output=True, text=True, timeout=180)
                    print(result.stdout[-6000:])
                    if result.returncode:
                        print(result.stderr[-3000:], file=sys.stderr)
                        raise RuntimeError("Codex live verification failed")
                    data = client.get("/workspace").json()
                    assert len(data["proposals"]) == 2 and not data["tasks"], data["proposals"]
                    print("Codex CLI live: cited source and one unapplied draft verified", flush=True)
        finally:
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()


if __name__ == "__main__":
    main()
