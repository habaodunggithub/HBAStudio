import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Columns3, Grid2X2, LayoutList, LoaderCircle, Sparkles, Undo2, X } from 'lucide-react'
import { api } from '../api'
import { flushReaderDrafts } from '../readerDrafts'
import {
  arrange,
  arrangementSignature,
  visualOrder,
  type ArrangeCard,
  type Arrangement,
  type ArrangeMode,
  type CodexArrangement,
} from './arrangement'
import type { Edge } from './model'
import './arrangement.css'

type Props = {
  boardId: string
  cards: ArrangeCard[]
  edges: Record<string, Edge>
  ready: boolean
  flush: () => Promise<boolean>
  onPreview: (plan: Arrangement | null) => void
  onCommit: (plan: Arrangement) => Promise<boolean>
}

export function ArrangeControl(props: Props) {
  const titleId = useId()
  const { boardId, cards, edges, ready, flush, onPreview, onCommit } = props
  const [open, setOpen] = useState(false),
    [mode, setMode] = useState<ArrangeMode | 'codex'>('grid')
  const [plan, setPlan] = useState<Arrangement | null>(null),
    [proposal, setProposal] = useState<CodexArrangement | null>(null)
  const [arrows, setArrows] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [baseline, setBaseline] = useState('')
  const [undo, setUndo] = useState<{ plan: Arrangement; signature: string } | null>(null)
  const dialog = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLButtonElement>(null)
  const request = useRef<AbortController | null>(null),
    live = useRef(props),
    sequence = useRef(0)
  live.current = props
  const signature = arrangementSignature(cards, edges)
  const stale = open && signature !== baseline

  useEffect(() => {
    if (open) dialog.current?.showModal()
    return () => {
      dialog.current?.close()
    }
  }, [open])
  useEffect(
    () => () => {
      request.current?.abort()
      sequence.current++
    },
    [],
  )

  function close() {
    sequence.current++
    request.current?.abort()
    request.current = null
    onPreview(null)
    setOpen(false)
    setBusy(false)
    setError('')
    setPlan(null)
    setProposal(null)
    trigger.current?.focus({ preventScroll: true })
  }
  function start() {
    setBaseline(signature)
    setOpen(true)
    setMode('grid')
    setError('')
    setProposal(null)
    setArrows(false)
    const next = arrange(visualOrder(cards), 'grid')
    setPlan(next)
    onPreview(next)
  }
  function select(next: ArrangeMode | 'codex') {
    sequence.current++
    request.current?.abort()
    setBusy(false)
    setError('')
    setProposal(null)
    setMode(next)
    const value = next === 'codex' ? null : arrange(visualOrder(cards), next)
    setPlan(value)
    onPreview(value)
  }
  function withArrows(result: CodexArrangement, enabled: boolean) {
    const index = new Map(cards.map((card) => [card.key, card]))
    if (
      result.order.length !== cards.length ||
      new Set(result.order).size !== cards.length ||
      result.order.some((key) => !index.has(key))
    )
      throw new Error('Danh sách thẻ đã thay đổi. Hãy mở lại Sắp xếp.')
    const value = arrange(
      result.order.map((key) => index.get(key)!),
      'grid',
    )
    if (enabled) {
      for (const [id, edge] of Object.entries(edges))
        if (id.startsWith('arrange:') && index.has(edge.source) && index.has(edge.target))
          value.edges[id] = null
      for (const link of result.links) {
        if (!index.has(link.source) || !index.has(link.target))
          throw new Error('Đường nối không hợp lệ.')
        if (
          !Object.entries(edges).some(
            ([id, edge]) =>
              !id.startsWith('arrange:') &&
              edge.source === link.source &&
              edge.target === link.target &&
              edge.arrow,
          )
        )
          value.edges['arrange:' + crypto.randomUUID()] = {
            source: link.source,
            target: link.target,
            arrow: true,
          }
      }
    }
    return value
  }
  async function askCodex() {
    const token = ++sequence.current
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError('')
    try {
      const pending = flushReaderDrafts()
      if (pending) await pending
      if (!(await flush())) throw new Error('Hãy lưu các thay đổi trên board rồi thử lại.')
      if (token !== sequence.current) return
      const result = await api<CodexArrangement>(
        '/canvas/' + encodeURIComponent(boardId) + '/arrange',
        'POST',
        { keys: cards.map((c) => c.key) },
        { signal: controller.signal },
      )
      if (token !== sequence.current) return
      if (arrangementSignature(live.current.cards, live.current.edges) !== baseline)
        throw new Error('Không gian đã thay đổi trong lúc Codex xử lý. Hãy mở lại Sắp xếp.')
      const next = withArrows(result, arrows)
      setProposal(result)
      setPlan(next)
      onPreview(next)
    } catch (e: any) {
      if (token === sequence.current) setError(e.message)
    } finally {
      if (token === sequence.current) {
        setBusy(false)
        request.current = null
      }
    }
  }
  async function apply() {
    if (!plan || stale || busy) return
    setBusy(true)
    setError('')
    const previous: Arrangement = {
      nodes: Object.fromEntries(cards.map((c) => [c.key, { x: c.x, y: c.y }])),
      edges: Object.fromEntries(Object.keys(plan.edges).map((id) => [id, edges[id] || null])),
    }
    const mergedEdges = { ...edges }
    for (const [id, edge] of Object.entries(plan.edges)) {
      if (edge) mergedEdges[id] = edge
      else delete mergedEdges[id]
    }
    const expected = arrangementSignature(
      cards.map((c) => ({ ...c, ...plan.nodes[c.key] })),
      mergedEdges,
    )
    // Apply locally even if persistence fails; the board's existing retry queue retains it.
    await onCommit(plan)
    setUndo({ plan: previous, signature: expected })
    close()
  }
  async function undoLayout() {
    if (!undo || signature !== undo.signature || busy) return
    setBusy(true)
    await onCommit(undo.plan)
    setUndo(null)
    setBusy(false)
  }
  return (
    <>
      <button
        ref={trigger}
        className="text-btn arrange-trigger"
        disabled={!ready || !cards.length || busy}
        onClick={start}
      >
        <Grid2X2 size={15} />
        Sắp xếp
      </button>
      {undo && (
        <button
          className="text-btn arrange-undo"
          disabled={busy || signature !== undo.signature}
          title={
            signature !== undo.signature
              ? 'Bố cục đã thay đổi sau khi sắp xếp'
              : 'Khôi phục vị trí trước khi sắp xếp'
          }
          onClick={undoLayout}
        >
          <Undo2 size={14} />
          Hoàn tác sắp xếp
        </button>
      )}
      {open &&
        createPortal(
          <dialog
            ref={dialog}
            className="arrange-dialog"
            aria-labelledby={titleId}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            onCancel={(e) => {
              e.preventDefault()
              if (!busy || request.current) close()
            }}
          >
            <header>
              <h2 id={titleId}>Sắp xếp không gian</h2>
              <button
                className="icon-btn"
                aria-label="Đóng sắp xếp"
                disabled={busy && !request.current}
                onClick={close}
              >
                <X size={18} />
              </button>
            </header>
            <p>{cards.length} thẻ đang hiển thị · Giữ nguyên nội dung và kích thước</p>
            <div className="arrange-modes" aria-label="Cách sắp xếp">
              {(
                [
                  ['row', 'Hàng ngang', Columns3],
                  ['column', 'Cột dọc', LayoutList],
                  ['grid', 'Hàng và cột', Grid2X2],
                  ['codex', 'Dùng Codex', Sparkles],
                ] as const
              ).map(([value, label, Icon]) => (
                <button
                  key={value}
                  aria-pressed={mode === value}
                  disabled={stale || busy}
                  onClick={() => select(value)}
                >
                  <Icon size={18} />
                  {label}
                </button>
              ))}
            </div>
            {mode === 'codex' && (
              <>
                <p>
                  Codex đọc nội dung thẻ, trích đoạn tài liệu và các phụ thuộc để đề xuất thứ tự.
                  Bạn xem trước rồi áp dụng.
                </p>
                {cards.length > 80 ? (
                  <p role="alert">
                    Codex hỗ trợ tối đa 80 thẻ mỗi lần. Hãy lọc bớt thẻ hoặc chọn hàng/cột.
                  </p>
                ) : (
                  !proposal && (
                    <button className="btn subtle" disabled={busy || stale} onClick={askCodex}>
                      {busy ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}{' '}
                      {busy ? 'Codex đang suy luận…' : 'Nhờ Codex sắp xếp'}
                    </button>
                  )
                )}
                {proposal && (
                  <div className="arrange-explanation">
                    <p>{proposal.summary}</p>
                    <label>
                      <input
                        type="checkbox"
                        checked={arrows}
                        disabled={busy || stale}
                        onChange={(e) => {
                          const next = withArrows(proposal, e.target.checked)
                          setArrows(e.target.checked)
                          setPlan(next)
                          onPreview(next)
                        }}
                      />
                      Thêm mũi tên trình tự ({proposal.links.length})
                    </label>
                    {Object.keys(edges).some((id) => id.startsWith('arrange:')) && (
                      <p>
                        Bật mũi tên để thay các mũi tên sắp xếp cũ của những thẻ này. Đường nối bạn
                        vẽ được giữ lại.
                      </p>
                    )}
                    {proposal.links.length > 0 && (
                      <details>
                        <summary>Xem lý do các mũi tên</summary>
                        <ul>
                          {proposal.links.map((link, index) => (
                            <li key={index}>
                              {cards.find((c) => c.key === link.source)?.title} →{' '}
                              {cards.find((c) => c.key === link.target)?.title}: {link.reason}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {proposal.warnings.map((warning, index) => (
                      <p key={index}>{warning}</p>
                    ))}
                  </div>
                )}
              </>
            )}
            {mode !== 'codex' && (
              <p>
                Thứ tự đọc theo vị trí hiện tại, từ trên xuống dưới. Bố cục đang được xem trước trên
                bảng.
              </p>
            )}
            {stale && (
              <p role="alert">
                Không gian đã thay đổi. Hãy đóng và mở lại Sắp xếp để lấy các thẻ mới nhất.
              </p>
            )}
            {error && <p role="alert">{error}</p>}
            <footer>
              <button className="btn subtle" disabled={busy && !request.current} onClick={close}>
                Hủy
              </button>
              <button className="btn" disabled={!plan || stale || busy} onClick={apply}>
                Áp dụng bố cục
              </button>
            </footer>
          </dialog>,
          document.body,
        )}
    </>
  )
}
