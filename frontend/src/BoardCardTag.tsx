import { useEffect, useRef, type PointerEvent } from 'react'

export type BoardCardRef = {
  kind: 'tasks' | 'deadlines' | 'projects'
  id: string
  card_key: string
}
export type BoardCardTag = BoardCardRef & { title: string; type: string; work_title: string }
export type CardDrag = { tag: BoardCardTag; over: boolean }
export const tagKey = (tag: BoardCardRef) => JSON.stringify([tag.kind, tag.id, tag.card_key])
export function insideChat(x: number, y: number) {
  const box = document.getElementById('codex-chat')?.getBoundingClientRect()
  return !!box && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
}
export function storedCardTags(): BoardCardTag[] {
  try {
    const tags = JSON.parse(localStorage.getItem('hba-chat-card-tags') || '[]')
    return Array.isArray(tags)
      ? tags
          .filter(
            (tag) =>
              ['tasks', 'deadlines', 'projects'].includes(tag?.kind) &&
              typeof tag.id === 'string' &&
              tag.id.length > 0 &&
              tag.id.length <= 200 &&
              typeof tag.card_key === 'string' &&
              tag.card_key.length > 0 &&
              tag.card_key.length <= 250 &&
              typeof tag.title === 'string' &&
              typeof tag.work_title === 'string',
          )
          .slice(0, 20)
      : []
  } catch {
    return []
  }
}

export function CardTagHandle({
  tag,
  selected,
  onAttach,
  onDrag,
}: {
  tag: BoardCardTag
  selected: boolean
  onAttach: (tag: BoardCardTag) => void
  onDrag: (tag: BoardCardTag, point: { x: number; y: number } | null) => void
}) {
  const gesture = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null),
    suppressClick = useRef(false)
  const cancel = () => {
    if (gesture.current?.moved) onDrag(tag, null)
    gesture.current = null
    suppressClick.current = false
  }
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (gesture.current && event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        cancel()
      }
    }
    addEventListener('keydown', escape, true)
    addEventListener('blur', cancel)
    return () => {
      removeEventListener('keydown', escape, true)
      removeEventListener('blur', cancel)
      cancel()
    }
  }, [tag.kind, tag.id, tag.card_key, onDrag])
  function start(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    suppressClick.current = false
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const g = gesture.current
    if (!g || g.id !== event.pointerId) return
    event.stopPropagation()
    if (Math.hypot(event.clientX - g.x, event.clientY - g.y) > 6) g.moved = true
    if (g.moved) {
      suppressClick.current = true
      onDrag(tag, { x: event.clientX, y: event.clientY })
    }
  }
  function end(event: PointerEvent<HTMLButtonElement>, cancelled = false) {
    const g = gesture.current
    if (!g || g.id !== event.pointerId) return
    event.stopPropagation()
    gesture.current = null
    if (g.moved) onDrag(tag, null)
    if (!cancelled && (!g.moved || insideChat(event.clientX, event.clientY))) onAttach(tag)
    setTimeout(() => {
      suppressClick.current = false
    }, 0)
  }
  return (
    <button
      type="button"
      className="wb-codex-tag"
      aria-label={'Gắn thẻ ' + tag.title + ' vào Codex'}
      aria-pressed={selected}
      title="Gắn thẻ vào Codex · Kéo chấm sang chat · Dùng nội dung đã lưu"
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={(e) => end(e)}
      onPointerCancel={(e) => end(e, true)}
      onLostPointerCapture={(e) => end(e, true)}
      onClick={(e) => {
        e.stopPropagation()
        if (e.detail === 0 && !suppressClick.current) onAttach(tag)
        suppressClick.current = false
      }}
    >
      <span aria-hidden="true" />
    </button>
  )
}
