import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { MoveDiagonal2 } from 'lucide-react'
import './card-resize.css'

export type CardSize = { width: number; height: number }
type Axis = 'both' | 'width' | 'height'
const bounded = (size: CardSize): CardSize => ({
  width: Math.max(260, Math.min(2400, size.width)),
  height: Math.max(180, Math.min(2400, size.height)),
})
function measured(element: HTMLElement): CardSize {
  const card = element.closest<HTMLElement>('[data-resizable-card]')!
  return { width: card.offsetWidth, height: card.offsetHeight }
}

export function CardResize({
  title,
  zoom,
  onResize,
  onCommit,
}: {
  title: string
  zoom: number
  onResize: (size: CardSize) => void
  onCommit: (size: CardSize) => void
}) {
  const gesture = useRef<{
    pointer: number
    x: number
    y: number
    original: CardSize
    next: CardSize
    axis: Axis
  } | null>(null)
  const [preview, setPreview] = useState<CardSize | null>(null)
  function start(event: PointerEvent<HTMLButtonElement>, axis: Axis) {
    if (event.button !== 0 || gesture.current) return
    event.preventDefault()
    event.stopPropagation()
    const original = measured(event.currentTarget)
    gesture.current = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      original,
      next: original,
      axis,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setPreview(original)
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const g = gesture.current
    if (!g || g.pointer !== event.pointerId) return
    event.stopPropagation()
    g.next = bounded({
      width: g.original.width + (g.axis === 'height' ? 0 : (event.clientX - g.x) / zoom),
      height: g.original.height + (g.axis === 'width' ? 0 : (event.clientY - g.y) / zoom),
    })
    onResize(g.next)
    setPreview(g.next)
  }
  function end(event: PointerEvent<HTMLButtonElement>, cancel = false) {
    const g = gesture.current
    if (!g || g.pointer !== event.pointerId) return
    event.stopPropagation()
    gesture.current = null
    setPreview(null)
    if (cancel) onResize(g.original)
    else if (g.next.width !== g.original.width || g.next.height !== g.original.height)
      onCommit(g.next)
  }
  function key(event: KeyboardEvent<HTMLButtonElement>, axis: Axis) {
    const directions: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }
    const delta = directions[event.key]
    if (!delta) return
    event.preventDefault()
    event.stopPropagation()
    const size = measured(event.currentTarget),
      step = event.shiftKey ? 40 : 10,
      next = bounded({
        width: size.width + (axis === 'height' ? 0 : delta[0] * step),
        height: size.height + (axis === 'width' ? 0 : delta[1] * step),
      })
    onResize(next)
    onCommit(next)
  }
  return (
    <>
      {(['width', 'height', 'both'] as Axis[]).map((axis) => (
        <button
          key={axis}
          data-node-action
          type="button"
          className={
            'card-resize ' +
            (axis === 'both' ? 'card-resize-corner wb-resize' : 'card-resize-' + axis)
          }
          aria-label={
            (axis === 'both'
              ? 'Đổi kích thước thẻ '
              : axis === 'width'
                ? 'Đổi chiều rộng thẻ '
                : 'Đổi chiều cao thẻ ') + title
          }
          title="Kéo để đổi kích thước · Phím mũi tên · Shift để tăng bước"
          onPointerDown={(e) => start(e, axis)}
          onPointerMove={move}
          onPointerUp={(e) => end(e)}
          onPointerCancel={(e) => end(e, true)}
          onLostPointerCapture={(e) => end(e, true)}
          onKeyDown={(e) => key(e, axis)}
          onClick={(e) => e.stopPropagation()}
        >
          {axis === 'both' && <MoveDiagonal2 size={16} />}
        </button>
      ))}
      {preview && (
        <output className="card-size-indicator" aria-hidden="true">
          {Math.round(preview.width)} × {Math.round(preview.height)}
        </output>
      )}
    </>
  )
}
