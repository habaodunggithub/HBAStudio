import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowUpRight,
  ArrowRight,
  CheckSquare,
  FileText,
  GripVertical,
  Maximize,
  Minus,
  Plus,
  Sparkles,
  StickyNote,
  X,
  Undo2,
} from 'lucide-react'
import { type BoardState } from './board/useWorkBoard'
import { defaultPosition, edgeEndpoints, zoomAt } from './board/geometry'
import type { Camera, Point, NoteCard } from './board/model'
import { CardResize } from './CardResize'
import { CardTagHandle, tagKey, type BoardCardTag } from './BoardCardTag'
import { DocumentMenu, DocumentReader } from './DocumentReader'
import { flushReaderDrafts } from './readerDrafts'
import { ArrangeControl } from './board/ArrangeControl'
import { fitArrangement, type Arrangement } from './board/arrangement'

type Item = Record<string, any>
type Card = {
  key: string
  title: string
  type: string
  document?: Item
  task?: Item
  note?: NoteCard
  width: number
  height: number
}
export function WorkBoard({
  board,
  detail,
  stepsContent,
  suggestionsContent,
  upload,
  onSuggest,
  open,
  edit,
  uploading,
  attachedCards,
  onAttachCard,
  onCardDrag,
}: {
  attachedCards: BoardCardTag[]
  onAttachCard: (tag: BoardCardTag) => void
  onCardDrag: (tag: BoardCardTag, point: { x: number; y: number } | null) => void
  board: BoardState
  detail: Item
  stepsContent: ReactNode
  suggestionsContent: ReactNode
  upload: (files: File[]) => void
  uploading: boolean
  edit: (kind: string, item: Item) => void
  onSuggest: () => void
  open: (kind: string, id: string) => void
}) {
  const { layout, change } = board
  const viewport = useRef<HTMLDivElement>(null),
    files = useRef<HTMLInputElement>(null),
    gesture = useRef<any>(null)
  const [camera, setCamera] = useState<Camera>({ x: 24, y: 24, zoom: 1 }),
    cameraRef = useRef(camera),
    [positions, setPositions] = useState<Item>({}),
    [sizes, setSizes] = useState<Item>({}),
    [connect, setConnect] = useState<'arrow' | 'line' | null>(null),
    [source, setSource] = useState<string | null>(null),
    [selectedEdge, setSelectedEdge] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false),
    [dragOver, setDragOver] = useState(false)
  const [readerVersions, setReaderVersions] = useState<Record<string, number>>({})
  const [readerError, setReaderError] = useState('')
  const [preview, setPreview] = useState<Arrangement | null>(null)
  const previewCamera = useRef<Camera | null>(null)
  const loaded = useRef(false)
  const cards = useMemo<Card[]>(
    () => [
      {
        key: 'steps',
        title: 'Đầu việc',
        type: 'steps',
        width: 340,
        height: 380,
      },
      ...detail.tasks
        .filter((t: Item) => t.id !== detail.item.id)
        .map((task: Item) => ({
          key: 'task:' + task.id,
          title: task.title,
          type: 'task',
          task,
          width: 300,
          height: 180,
        })),
      ...detail.documents.map((document: Item) => ({
        key: 'document:' + document.id,
        title: document.title,
        type: 'document',
        document,
        width: 520,
        height: 580,
      })),
      ...Object.entries(layout.cards || {}).map(([key, note]: [string, any]) => ({
        key,
        title: note.title || 'Ghi chú',
        type: 'note',
        note,
        width: 300,
        height: 260,
      })),
      ...(layout.suggestions
        ? [
            {
              key: 'suggestions',
              title: 'Gợi ý Codex',
              type: 'suggestions',
              width: 380,
              height: 480,
            },
          ]
        : []),
    ],
    [detail.tasks, detail.documents, detail.item.id, layout.cards, layout.suggestions],
  )
  const cardIndex = useMemo(() => new Map(cards.map((card, index) => [card.key, index])), [cards])
  const visible = useMemo(() => {
    const hidden = new Set(layout.hidden)
    return cards.filter((card) => !hidden.has(card.key))
  }, [cards, layout.hidden])
  const visibleByKey = useMemo(() => new Map(visible.map((card) => [card.key, card])), [visible])
  const attachedKeys = useMemo(() => new Set(attachedCards.map(tagKey)), [attachedCards])
  useEffect(() => {
    if (!board.loaded) return
    const nodes: Item = {}
    cards.forEach((card, index) => {
      if (!layout.nodes[card.key]) nodes[card.key] = defaultPosition(index)
    })
    if (Object.keys(nodes).length) change({ nodes })
  }, [board.loaded, cards.map((card) => card.key).join('|')])
  function basePosition(card: Card) {
    return (
      positions[card.key] || layout.nodes[card.key] || defaultPosition(cardIndex.get(card.key) || 0)
    )
  }
  function position(card: Card) {
    return preview?.nodes[card.key] || basePosition(card)
  }
  function size(card: Card) {
    return sizes[card.key] || layout.sizes[card.key] || { width: card.width, height: card.height }
  }
  function moveCamera(next: Camera) {
    cameraRef.current = next
    setCamera(next)
  }
  const arrangeCards = visible.map((card) => ({
    key: card.key,
    title: card.title,
    ...basePosition(card),
    ...size(card),
    content: {
      value:
        card.note ||
        card.task ||
        card.document ||
        (card.type === 'steps' ? detail.item.checklist : detail.analysis),
      fingerprint: detail.fingerprint,
    },
  }))
  function previewArrangement(next: Arrangement | null) {
    setPreview(next)
    if (next) {
      previewCamera.current ||= { ...cameraRef.current }
      const el = viewport.current
      if (el) moveCamera(fitArrangement(arrangeCards, next.nodes, el.clientWidth, el.clientHeight))
    } else if (previewCamera.current) {
      moveCamera(previewCamera.current)
      previewCamera.current = null
    }
  }
  async function commitArrangement(next: Arrangement) {
    previewCamera.current = null
    setPreview(null)
    setPositions({})
    setSelectedEdge(null)
    setConnect(null)
    setSource(null)
    const el = viewport.current!
    const camera = fitArrangement(arrangeCards, next.nodes, el.clientWidth, el.clientHeight)
    moveCamera(camera)
    change({ nodes: next.nodes, edges: next.edges, camera })
    return board.flush()
  }
  useEffect(() => {
    if (!board.loaded || loaded.current) return
    loaded.current = true
    let next = layout.camera || { x: 24, y: 24, zoom: 1 }
    const width = viewport.current?.clientWidth || 1000
    if (width < 600) {
      const first = visible[0]
      if (first) {
        const p = position(first),
          w = size(first).width
        next = {
          zoom: Math.max(0.25, Math.min(1, (width - 32) / w)),
          x: 16,
          y: 20,
        }
        next.x -= p.x * next.zoom
        next.y -= p.y * next.zoom
      }
    }
    moveCamera(next)
  }, [board.loaded])
  function zoom(amount: number, point?: Point) {
    const rect = viewport.current!.getBoundingClientRect(),
      p = point || { x: rect.width / 2, y: rect.height / 2 },
      next = zoomAt(cameraRef.current, amount, p)
    moveCamera(next)
    change({ camera: next })
  }
  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      if (!(event.target instanceof Element) || event.target.closest('.wb-card,.wb-ui')) return
      event.preventDefault()
      const box = element.getBoundingClientRect(),
        unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1
      zoom(cameraRef.current.zoom * Math.exp(-event.deltaY * unit * 0.002), {
        x: event.clientX - box.left,
        y: event.clientY - box.top,
      })
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [change])
  function fit() {
    if (!visible.length) return
    const box = viewport.current!.getBoundingClientRect(),
      left = Math.min(...visible.map((c) => position(c).x)),
      top = Math.min(...visible.map((c) => position(c).y)),
      right = Math.max(...visible.map((c) => position(c).x + size(c).width)),
      bottom = Math.max(...visible.map((c) => position(c).y + size(c).height)),
      z = Math.max(
        0.25,
        Math.min(1, (box.width - 48) / (right - left), (box.height - 90) / (bottom - top)),
      ),
      next = {
        zoom: z,
        x: (box.width - (right - left) * z) / 2 - left * z,
        y: 24 - top * z,
      }
    moveCamera(next)
    change({ camera: next })
  }
  function start(event: React.PointerEvent, mode: string, card?: Card) {
    if (event.button !== 0 || connect) return
    if (mode === 'pan' && (event.target as HTMLElement).closest('.wb-card,.wb-ui')) return
    event.preventDefault()
    event.stopPropagation()
    const p = card ? position(card) : cameraRef.current
    gesture.current = {
      mode,
      card,
      x: event.clientX,
      y: event.clientY,
      original: { ...p },
      size: card ? size(card) : null,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }
  function move(event: React.PointerEvent) {
    const g = gesture.current
    if (!g) return
    const dx = (event.clientX - g.x) / cameraRef.current.zoom,
      dy = (event.clientY - g.y) / cameraRef.current.zoom
    if (g.mode === 'pan')
      moveCamera({
        ...g.original,
        x: g.original.x + event.clientX - g.x,
        y: g.original.y + event.clientY - g.y,
      })
    else
      setPositions((old) => ({
        ...old,
        [g.card.key]: { x: g.original.x + dx, y: g.original.y + dy },
      }))
  }
  function end(event: React.PointerEvent, cancel = false) {
    const g = gesture.current
    if (!g) return
    gesture.current = null
    setDragging(false)
    if (cancel) {
      if (g.mode === 'pan') moveCamera(g.original)
      else setPositions((old) => ({ ...old, [g.card.key]: g.original }))
      return
    }
    if (g.mode === 'pan') change({ camera: cameraRef.current })
    else {
      change({ nodes: { [g.card.key]: positions[g.card.key] || g.original } })
      setPositions((old) => {
        const next = { ...old }
        delete next[g.card.key]
        return next
      })
    }
  }
  async function attachCard(tag: BoardCardTag) {
    if (await board.flush()) onAttachCard(tag)
  }
  function cardTag(card: Card): BoardCardTag {
    return {
      kind: detail.kind,
      id: detail.item.id,
      card_key: card.key,
      title: card.title,
      type: card.type,
      work_title: detail.item.title,
    }
  }
  function join(card: Card) {
    if (!connect) return
    if (!source) {
      setSource(card.key)
      return
    }
    if (source === card.key) {
      setSource(null)
      return
    }
    change({
      edges: {
        [crypto.randomUUID()]: {
          source,
          target: card.key,
          arrow: connect === 'arrow',
        },
      },
    })
    setSource(null)
    setConnect(null)
  }
  async function hide(card: Card) {
    try {
      const pending = card.document ? flushReaderDrafts(card.document.id) : null
      if (pending) await pending
      change({ hidden: [...layout.hidden, card.key] })
    } catch (e: any) {
      setReaderError(e.message)
    }
  }
  async function reloadReader(card: Card) {
    try {
      const pending = card.document ? flushReaderDrafts(card.document.id) : null
      if (pending) await pending
      setReaderVersions((old) => ({
        ...old,
        [card.key]: (old[card.key] || 0) + 1,
      }))
    } catch (e: any) {
      setReaderError(e.message)
    }
  }
  function addNote() {
    const key = 'note:' + crypto.randomUUID(),
      rect = viewport.current!.getBoundingClientRect(),
      cam = cameraRef.current
    change({
      cards: { [key]: { type: 'note', title: 'Ghi chú', text: '' } },
      nodes: {
        [key]: {
          x: (rect.width / 2 - cam.x) / cam.zoom - 150,
          y: (80 - cam.y) / cam.zoom,
        },
      },
    })
  }
  function keyCard(event: React.KeyboardEvent, card: Card) {
    const deltas: Item = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }
    if (!deltas[event.key]) return
    event.preventDefault()
    event.stopPropagation()
    const [dx, dy] = deltas[event.key],
      n = event.shiftKey ? 40 : 10,
      prev = position(card),
      next = { x: prev.x + dx * n, y: prev.y + dy * n }
    change({ nodes: { [card.key]: next } })
  }

  return (
    <div className="work-board-shell">
      <div className="wb-toolbar" role="toolbar" aria-label="Công cụ board">
        <ArrangeControl
          boardId={'work:' + detail.kind + ':' + detail.item.id}
          cards={arrangeCards}
          edges={layout.edges}
          ready={board.loaded}
          flush={board.flush}
          onPreview={previewArrangement}
          onCommit={commitArrangement}
        />
        <span className="wb-divider" />
        <button
          className="text-btn"
          onClick={() => {
            change({
              hidden: layout.hidden.filter((key: string) => key !== 'steps'),
            })
            const c = cards[0],
              p = position(c),
              zoom = Math.min(1, ((viewport.current?.clientWidth || 1000) - 32) / size(c).width),
              next = { zoom, x: 16 - p.x * zoom, y: 20 - p.y * zoom }
            moveCamera(next)
            change({ camera: next })
            viewport.current
              ?.querySelector<HTMLInputElement>('[aria-label="Đầu việc mới"]')
              ?.focus({ preventScroll: true })
          }}
        >
          <CheckSquare size={16} />
          Đầu việc
        </button>
        <button
          className="text-btn"
          onClick={() =>
            edit(
              'tasks',
              detail.kind === 'tasks'
                ? { parent_id: detail.item.id }
                : detail.kind === 'deadlines'
                  ? { deadline_id: detail.item.id }
                  : { project_id: detail.item.id },
            )
          }
        >
          <Plus size={16} />
          Thẻ công việc
        </button>
        <button className="text-btn" disabled={uploading} onClick={() => files.current?.click()}>
          <FileText size={16} />
          {uploading ? 'Đang tải…' : 'Tài liệu'}
        </button>
        <button className="text-btn" onClick={addNote}>
          <StickyNote size={16} />
          Ghi chú
        </button>
        <span className="wb-divider" />
        <button
          className="text-btn"
          aria-pressed={connect === 'arrow'}
          onClick={() => {
            setConnect(connect === 'arrow' ? null : 'arrow')
            setSource(null)
          }}
        >
          <ArrowUpRight size={16} />
          Mũi tên
        </button>
        <button
          className="text-btn"
          aria-pressed={connect === 'line'}
          onClick={() => {
            setConnect(connect === 'line' ? null : 'line')
            setSource(null)
          }}
        >
          <Minus size={16} />
          Đường thẳng
        </button>
        <span className="wb-divider" />
        <button
          className="text-btn"
          aria-pressed={layout.suggestions}
          onClick={() => {
            const show = !layout.suggestions
            change({
              suggestions: show,
              hidden: layout.hidden.filter((key: string) => key !== 'suggestions'),
            })
            if (show) onSuggest()
          }}
        >
          <Sparkles size={16} />
          Gợi ý Codex
        </button>
        {layout.hidden.length > 0 && (
          <button className="text-btn" onClick={() => change({ hidden: [] })}>
            <Undo2 size={15} />
            Hiện thẻ đã ẩn ({layout.hidden.length})
          </button>
        )}
        <input
          ref={files}
          hidden
          type="file"
          multiple
          accept=".pdf,.docx,.xlsx,.txt,.md,.markdown"
          aria-label="Thêm tài liệu trên board"
          disabled={uploading}
          onChange={(e) => {
            upload(Array.from(e.target.files || []))
            e.target.value = ''
          }}
        />
      </div>
      <div
        ref={viewport}
        className={'work-board ' + (dragging ? 'is-dragging' : '')}
        tabIndex={0}
        aria-label="Board công việc"
        style={{
          backgroundSize: `${14 * camera.zoom}px ${14 * camera.zoom}px`,
          backgroundPosition: `${camera.x}px ${camera.y}px`,
        }}
        onPointerDown={(e) => start(e, 'pan')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={(e) => end(e, true)}
        onKeyDown={(e) => {
          if ((e.target as HTMLElement).closest('input,textarea,select,button')) return
          if (e.key === 'Escape') {
            setSource(null)
            setConnect(null)
            setSelectedEdge(null)
            e.stopPropagation()
          }
          if (e.key === 'Home') {
            e.preventDefault()
            fit()
          }
          if ((e.key === 'Delete' || e.key === 'Backspace') && selectedEdge) {
            e.preventDefault()
            change({ edges: { [selectedEdge]: null } })
            setSelectedEdge(null)
          }
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault()
            setDragOver(true)
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          upload(Array.from(e.dataTransfer.files))
        }}
      >
        <div
          className="wb-world"
          style={{
            transform: `translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})`,
          }}
        >
          <svg className="wb-connections" aria-label="Đường nối giữa các thẻ">
            <defs>
              <marker
                id="wb-arrow"
                markerWidth="10"
                markerHeight="10"
                refX="9"
                refY="5"
                orient="auto-start-reverse"
              >
                <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
              </marker>
            </defs>
            {Object.entries({ ...layout.edges, ...preview?.edges }).map(
              ([id, edge]: [string, any]) => {
                if (!edge) return null
                const a = visibleByKey.get(edge.source),
                  b = visibleByKey.get(edge.target)
                if (!a || !b) return null
                const points = edgeEndpoints(position(a), size(a), position(b), size(b))
                return (
                  <g key={id} className={selectedEdge === id ? 'selected' : ''}>
                    <line {...points} markerEnd={edge.arrow ? 'url(#wb-arrow)' : undefined} />
                    <line
                      className="wb-edge-hit"
                      {...points}
                      role="button"
                      tabIndex={0}
                      aria-label={`Chọn đường nối ${a.title} đến ${b.title}`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => setSelectedEdge(id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setSelectedEdge(id)
                        }
                      }}
                    />
                  </g>
                )
              },
            )}
          </svg>
          {visible.map((card) => (
            <article
              key={card.key}
              data-resizable-card
              data-board-card={card.key}
              className={'wb-card wb-' + card.type + (source === card.key ? ' is-connecting' : '')}
              style={{
                left: position(card).x,
                top: position(card).y,
                ...size(card),
              }}
            >
              <header className="wb-card-heading">
                <button
                  className="wb-handle"
                  aria-label={(connect ? 'Nối thẻ ' : 'Di chuyển thẻ ') + card.title}
                  onPointerDown={(e) => start(e, 'move', card)}
                  onClick={() => join(card)}
                  onKeyDown={(e) => keyCard(e, card)}
                >
                  <GripVertical size={15} />
                  <span>{card.title}</span>
                </button>
                <CardTagHandle
                  tag={cardTag(card)}
                  selected={attachedKeys.has(tagKey(cardTag(card)))}
                  onAttach={attachCard}
                  onDrag={onCardDrag}
                />
                {card.type === 'document' && (
                  <DocumentMenu doc={card.document!} reload={() => reloadReader(card)} />
                )}
                <button
                  className="icon-btn"
                  aria-label={'Ẩn thẻ ' + card.title}
                  onClick={() => hide(card)}
                >
                  <X size={15} />
                </button>
              </header>
              <div className="wb-card-content">
                {card.type === 'steps' ? (
                  stepsContent
                ) : card.type === 'document' ? (
                  <DocumentReader
                    key={readerVersions[card.key] || 0}
                    doc={card.document!}
                    boardZoom={camera.zoom}
                  />
                ) : card.type === 'note' ? (
                  <div className="wb-note-fields">
                    <input
                      aria-label="Tên ghi chú"
                      value={card.note!.title}
                      maxLength={200}
                      onChange={(e) =>
                        change({
                          cards: {
                            [card.key]: { ...card.note, title: e.target.value },
                          },
                        })
                      }
                    />
                    <textarea
                      aria-label="Nội dung ghi chú"
                      placeholder="Viết điều bạn muốn giữ lại…"
                      maxLength={50000}
                      value={card.note!.text}
                      onChange={(e) =>
                        change({
                          cards: {
                            [card.key]: { ...card.note, text: e.target.value },
                          },
                        })
                      }
                    />
                  </div>
                ) : card.type === 'suggestions' ? (
                  suggestionsContent
                ) : (
                  <div className="wb-related-content">
                    <p>{card.task!.status === 'done' ? 'Đã hoàn thành' : 'Chưa hoàn thành'}</p>
                    <p>{card.task!.description || 'Mở để xem đầu việc và tài liệu.'}</p>
                    <button className="text-btn" onClick={() => open('tasks', card.task!.id)}>
                      Mở không gian <ArrowRight size={15} />
                    </button>
                    <button className="text-btn" onClick={() => edit('tasks', card.task!)}>
                      Chỉnh thông tin
                    </button>
                  </div>
                )}
              </div>
              <CardResize
                title={card.title}
                zoom={camera.zoom}
                onResize={(next) => setSizes((old) => ({ ...old, [card.key]: next }))}
                onCommit={(next) => {
                  change({ sizes: { [card.key]: next } })
                  setSizes((old) => {
                    const value = { ...old }
                    delete value[card.key]
                    return value
                  })
                }}
              />
            </article>
          ))}
        </div>
        {readerError && (
          <div className="wb-connection-help wb-ui" role="alert">
            {readerError}
            <button
              className="icon-btn"
              aria-label="Đóng lỗi tài liệu"
              onClick={() => setReaderError('')}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {connect && (
          <div className="wb-connection-help wb-ui" role="status">
            {source ? 'Chọn tiêu đề thẻ đích' : 'Chọn tiêu đề thẻ bắt đầu'}
            <button
              className="icon-btn"
              aria-label="Hủy nối thẻ"
              onClick={() => {
                setSource(null)
                setConnect(null)
              }}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {selectedEdge && (
          <div className="wb-connection-help wb-ui">
            <button
              className="text-btn"
              onClick={() => {
                change({ edges: { [selectedEdge]: null } })
                setSelectedEdge(null)
              }}
            >
              Xóa đường nối
            </button>
            <button
              className="icon-btn"
              aria-label="Bỏ chọn đường nối"
              onClick={() => setSelectedEdge(null)}
            >
              <X size={14} />
            </button>
          </div>
        )}
        <div className="wb-bottom wb-ui">
          <span role={board.failed ? 'alert' : 'status'}>
            {board.status}
            {board.failed && (
              <button className="text-btn" onClick={board.retry}>
                Thử lưu lại
              </button>
            )}
          </span>
          <div className="space-zoom">
            <button className="icon-btn" aria-label="Vừa board công việc" onClick={fit}>
              <Maximize size={17} />
            </button>
            <button
              className="icon-btn"
              aria-label="Thu nhỏ board"
              disabled={camera.zoom <= 0.25}
              onClick={() => zoom(camera.zoom / 1.2)}
            >
              <Minus size={17} />
            </button>
            <button className="space-zoom-value" onClick={() => zoom(1)}>
              {Math.round(camera.zoom * 100)}%
            </button>
            <button
              className="icon-btn"
              aria-label="Phóng to board"
              disabled={camera.zoom >= 2}
              onClick={() => zoom(camera.zoom * 1.2)}
            >
              <Plus size={17} />
            </button>
          </div>
        </div>
        {dragOver && (
          <div className="space-drop-overlay">
            <FileText size={32} />
            <h2>Thả để thêm thẻ tài liệu</h2>
          </div>
        )}
      </div>
    </div>
  )
}
