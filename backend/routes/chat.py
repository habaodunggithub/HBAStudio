"""Chat HTTP endpoints."""

from fastapi import APIRouter

from .. import chat

router = APIRouter(tags=["chat"])


@router.get("/api/v1/chat/threads")
def chat_threads():
    return chat.list_threads()


@router.post("/api/v1/chat/threads")
def chat_new():
    return chat.new_thread()


@router.get("/api/v1/chat/threads/{ident}")
def chat_read(ident: str):
    return chat.get_thread(ident)


@router.post("/api/v1/chat/threads/{ident}/messages")
def chat_send(ident: str, payload: chat.MessageInput):
    return chat.send_message(ident, payload)


@router.post("/api/v1/chat/threads/{ident}/interrupt")
def chat_interrupt(ident: str):
    return chat.interrupt(ident)
