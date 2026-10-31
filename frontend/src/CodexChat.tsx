import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  ArrowUp,
  Link2,
  BookOpen,
  FileCheck2,
  LoaderCircle,
  Map,
  MessageSquare,
  Paperclip,
  Plus,
  Square,
  Undo2,
  X,
} from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from './api'
import { tagKey, type BoardCardRef, type BoardCardTag, type CardDrag } from './BoardCardTag'
import './chat.css'

type Item = Record<string, any>
type Props = {
  onConnect?: () => void
  cards: BoardCardTag[]
  onCardsChange: Dispatch<SetStateAction<BoardCardTag[]>>
  cardDrag: CardDrag | null
  open: boolean
  onClose: () => void
  context: Item | null
  onChanged: () => Promise<void>
  onProposal: (id: string) => Promise<void>
  onSource: (id: string) => Promise<void>
  onAddSource?: (files?: File[]) => void
  request?: Item | null
}

export function CodexChat({
  open,
  onClose,
  context,
  onChanged,
  onProposal,
  onSource,
  onAddSource,
  request,
  cards,
  onCardsChange,
  cardDrag,
  onConnect,
}: Props) {
  const [threads, setThreads] = useState<Item[]>([]),
    [thread, setThread] = useState<Item | null>(null)
  const [available, setAvailable] = useState(true),
    [loading, setLoading] = useState(false),
    [sending, setSending] = useState(false),
    [error, setError] = useState('')
  const [pollError, setPollError] = useState('')
  const [autoApply, setAutoApply] = useState(
    () => localStorage.getItem('pdm-chat-auto-apply') !== 'false',
  )
  const [waitingSources, setWaitingSources] = useState(false),
    [readyRequest, setReadyRequest] = useState<Item | null>(null)
  const [draftSources, setDraftSources] = useState<string[]>(() => {
    try {
      const value = JSON.parse(localStorage.getItem('pdm-chat-draft-sources') || '[]')
      return Array.isArray(value) ? value.filter((x) => typeof x === 'string').slice(0, 50) : []
    } catch {
      return []
    }
  })
  const [text, setText] = useState(() => localStorage.getItem('pdm-chat-draft') || ''),
    [attach, setAttach] = useState(true),
    [unread, setUnread] = useState(false)
  const [mobile, setMobile] = useState(() => matchMedia('(max-width:760px)').matches)
  const input = useRef<HTMLTextAreaElement>(null),
    body = useRef<HTMLDivElement>(null),
    nearBottom = useRef(true),
    selected = useRef(''),
    previousStatus = useRef(''),
    alive = useRef(true)
  const handledRequest = useRef('')
  const running = thread?.status === 'running'
  const close = useCallback(() => {
    onClose()
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.chat-toggle')?.focus())
  }, [onClose])
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    const media = matchMedia('(max-width:760px)')
    const update = () => setMobile(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    localStorage.setItem('pdm-chat-draft', text)
  }, [text])
  useEffect(() => {
    localStorage.setItem('pdm-chat-auto-apply', String(autoApply))
  }, [autoApply])
  useEffect(() => {
    localStorage.setItem('pdm-chat-draft-sources', JSON.stringify(draftSources))
  }, [draftSources])
  useEffect(() => {
    if (!request?.id) return
    let disposed = false
    setText(request.text)
    setDraftSources(request.documentIds || [])
    setError('')
    setWaitingSources(!!request.documentIds?.length)
    ;(async () => {
      try {
        const started = Date.now()
        while (request.documentIds?.length) {
          const workspace = await api('/workspace')
          if (disposed) return
          const docs = request.documentIds.map((id: string) =>
            workspace.documents.find((d: Item) => d.id === id),
          )
          if (docs.some((d: Item) => !d))
            throw new Error('Có nguồn không còn tồn tại. Hãy thêm lại nguồn đó.')
          const failed = docs.find((d: Item) => d.status === 'error')
          if (failed)
            throw new Error(failed.title + ': ' + (failed.error || 'Chưa đọc được nguồn.'))
          if (docs.every((d: Item) => d.status === 'ready')) break
          if (Date.now() - started > 240000)
            throw new Error(
              'Nguồn vẫn đang được đọc. Bạn có thể gửi yêu cầu sau khi tài liệu xử lý xong.',
            )
          await new Promise((resolve) => setTimeout(resolve, 1200))
          if (disposed) return
        }
        if (!disposed) setReadyRequest(request)
      } catch (e: any) {
        if (!disposed) setError(e.message)
      } finally {
        if (!disposed) setWaitingSources(false)
      }
    })()
    return () => {
      disposed = true
    }
  }, [request?.id])
  useEffect(() => {
    if (
      !open ||
      !readyRequest ||
      loading ||
      sending ||
      running ||
      handledRequest.current === readyRequest.id
    )
      return
    handledRequest.current = readyRequest.id
    void send(readyRequest.text, readyRequest.context, readyRequest.documentIds || [], [])
  }, [open, readyRequest, loading, sending, running])
  useEffect(() => {
    const update = () => {
      if (open) void refresh().catch((e) => setError(e.message))
    }
    addEventListener('hba-connections-changed', update)
    return () => removeEventListener('hba-connections-changed', update)
  }, [open])
  const adopt = (next: Item) => {
    if (!alive.current) return
    if (selected.current && next.id !== selected.current) return
    if (previousStatus.current === 'running' && next.status !== 'running') void onChanged()
    previousStatus.current = next.status
    selected.current = next.id
    localStorage.setItem('pdm-chat-thread', next.id)
    setThread(next)
    setThreads((current) =>
      current.map((t) =>
        t.id === next.id
          ? { ...t, title: next.title, status: next.status, updated_at: next.updated_at }
          : t,
      ),
    )
  }
  const refresh = async () => {
    const result = await api('/chat/threads')
    if (!alive.current) return
    setThreads(result.threads)
    setAvailable(result.available)
    const id = selected.current || localStorage.getItem('pdm-chat-thread')
    const found = result.threads.find((t: Item) => t.id === id) || result.threads[0]
    if (found) {
      selected.current = found.id
      adopt(await api('/chat/threads/' + found.id))
    } else {
      selected.current = ''
      setThread(null)
    }
  }
  useEffect(() => {
    if (!open) return
    const focusAtOpen = document.activeElement
    setLoading(true)
    setError('')
    refresh()
      .then(() => setPollError(''))
      .catch((e) => setPollError(e.message))
      .finally(() => setLoading(false))
    const id = setTimeout(() => {
      // A user may already have moved to another card with the keyboard.
      // Late focus must not redirect their next Enter into sending a message.
      const active = document.activeElement
      if (
        !cardDrag &&
        (active === focusAtOpen ||
          active === document.body ||
          document.getElementById('codex-chat')?.contains(active))
      )
        input.current?.focus()
    }, 100)
    return () => clearTimeout(id)
  }, [open])
  useEffect(() => {
    if (open && cards.length && !cardDrag) input.current?.focus()
  }, [open, cards, !!cardDrag])
  useEffect(() => {
    if (!open || !thread?.id) return
    let disposed = false
    const tick = async () => {
      try {
        const next = await api('/chat/threads/' + thread.id)
        if (!disposed) {
          adopt(next)
          setPollError('')
        }
      } catch (e: any) {
        if (!disposed) setPollError(e.message)
      }
      if (!disposed) timeout = setTimeout(tick, running ? 650 : 4000)
    }
    let timeout = setTimeout(tick, running ? 650 : 4000)
    return () => {
      disposed = true
      clearTimeout(timeout)
    }
  }, [open, thread?.id, running])
  useEffect(() => {
    if (!open) return
    if (nearBottom.current) {
      body.current?.scrollTo({ top: body.current.scrollHeight })
      setUnread(false)
    } else setUnread(true)
  }, [JSON.stringify(thread?.messages), open])
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.modal-backdrop')) {
        e.preventDefault()
        close()
      }
      if (e.key === 'Tab' && mobile && !document.querySelector('.modal-backdrop')) {
        const nodes = Array.from(
          document.querySelectorAll<HTMLElement>(
            '#codex-chat button:not(:disabled),#codex-chat select:not(:disabled),#codex-chat textarea:not(:disabled),#codex-chat input:not(:disabled),#codex-chat a[href],#codex-chat summary',
          ),
        ).filter((el) => el.getClientRects().length)
        const first = nodes[0],
          last = nodes.at(-1)
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last?.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first?.focus()
        }
      }
    }
    const overflow = document.body.style.overflow
    if (mobile) document.body.style.overflow = 'hidden'
    addEventListener('keydown', key)
    return () => {
      removeEventListener('keydown', key)
      document.body.style.overflow = overflow
    }
  }, [open, close, mobile])
  async function newThread() {
    setError('')
    setLoading(true)
    try {
      const next = await api('/chat/threads', 'POST')
      selected.current = next.id
      previousStatus.current = ''
      nearBottom.current = true
      adopt(next)
      await refresh()
      input.current?.focus()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }
  async function choose(id: string) {
    if (!id) return
    selected.current = id
    previousStatus.current = ''
    setLoading(true)
    setError('')
    nearBottom.current = true
    try {
      adopt(await api('/chat/threads/' + id))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }
  async function send(
    value = text,
    scope: Item | null = context,
    documentIds: string[] = draftSources,
    references: BoardCardRef[] = cards,
  ) {
    if (!value.trim() || sending || running) return
    setSending(true)
    setError('')
    nearBottom.current = true
    try {
      let current = thread
      if (!current) {
        current = await api('/chat/threads', 'POST')
        selected.current = current!.id
        adopt(current!)
      }
      const next = await api('/chat/threads/' + current!.id + '/messages', 'POST', {
        text: value.trim(),
        context: attach && scope ? { kind: scope.kind, id: scope.id } : null,
        auto_apply: autoApply,
        document_ids: documentIds,
        card_references: references.map(({ kind, id, card_key }) => ({ kind, id, card_key })),
      })
      const sent = new Set(references.map(tagKey))
      onCardsChange((current) => current.filter((card) => !sent.has(tagKey(card))))
      adopt(next)
      setText('')
      setDraftSources([])
      await refresh()
      await onChanged()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }
  async function stop() {
    setError('')
    try {
      await api('/chat/threads/' + thread!.id + '/interrupt', 'POST')
    } catch (e: any) {
      setError(e.message)
    }
  }
  async function showProposal(id: string) {
    try {
      await onProposal(id)
      if (mobile) close()
    } catch (e: any) {
      setError(e.message)
    }
  }
  async function showSource(id: string) {
    try {
      await onSource(id)
    } catch (e: any) {
      setError(e.message)
    }
  }
  async function undo(id: string) {
    setError('')
    try {
      await api('/revisions/' + encodeURIComponent(id) + '/undo', 'POST')
      await onChanged()
      await refresh()
    } catch (e: any) {
      setError(e.message)
    }
  }
  if (!open) return null
  return (
    <section
      id="codex-chat"
      className={
        'codex-chat' +
        (cardDrag ? ' is-card-drop-target' : '') +
        (cardDrag?.over ? ' is-card-drop-over' : '')
      }
      role="dialog"
      aria-modal={mobile || undefined}
      aria-label="Chat với Codex"
      aria-busy={loading}
    >
      <header className="chat-heading">
        <div>
          <MessageSquare size={18} />
          <h2>Codex</h2>
        </div>
        <div>
          {onConnect && (
            <button
              className="icon-btn"
              aria-label="Kết nối Codex"
              title="Quản lý kết nối Codex"
              disabled={loading || running || sending}
              onClick={onConnect}
            >
              <Link2 size={16} />
            </button>
          )}
          <button
            className="icon-btn"
            aria-label="Cuộc trò chuyện mới"
            title="Cuộc trò chuyện mới"
            disabled={loading || running || sending}
            onClick={newThread}
          >
            <Plus size={18} />
          </button>
          <button
            className="icon-btn"
            aria-label="Đóng chat"
            title="Đóng chat (Esc)"
            onClick={close}
          >
            <X size={19} />
          </button>
        </div>
      </header>
      {cardDrag && (
        <div className="chat-card-dropzone" role="status">
          Thả để gắn thẻ vào tin nhắn
        </div>
      )}
      <div className="chat-scope">
        <Map size={17} />
        <span>
          Ngữ cảnh: <b>{attach && context ? context.title : 'Tất cả môn học'}</b>
        </span>
      </div>
      {threads.length > 0 && (
        <div className="chat-history">
          <select
            aria-label="Lịch sử trò chuyện"
            value={thread?.id || ''}
            onChange={(e) => choose(e.target.value)}
            disabled={loading || sending}
          >
            {threads.map((t) => (
              <option key={t.id} value={t.id}>
                {t.status === 'running' ? 'Đang trả lời · ' : ''}
                {t.title}
              </option>
            ))}
          </select>
        </div>
      )}
      <div
        className="chat-body"
        ref={body}
        onScroll={() => {
          const el = body.current!
          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90
          if (nearBottom.current) setUnread(false)
        }}
      >
        {!thread?.messages.length && (
          <div className="chat-empty">
            <h3>Cứ đưa việc cho Codex.</h3>
            <p>
              Dán tin nhắn giảng viên hoặc thêm tài liệu. Mình sẽ giúp gom yêu cầu, cập nhật
              deadline và biết việc nào nên làm trước.
            </p>
            <div>
              {[
                'Tuần này tôi nên làm gì trước?',
                'Tổng hợp deadline các môn',
                'Đọc tài liệu và cập nhật yêu cầu',
              ].map((v) => (
                <button
                  key={v}
                  onClick={() => {
                    setText(v)
                    input.current?.focus()
                  }}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        )}
        {thread?.messages.map((m: Item, i: number) => (
          <article
            key={m.id}
            className={'chat-message ' + m.role}
            aria-label={m.role === 'user' ? 'Bạn' : 'Codex'}
          >
            <div className="chat-speaker">{m.role === 'user' ? 'Bạn' : 'Codex'}</div>
            {m.context && <small className="chat-attached">Đã đính kèm workspace</small>}
            {!!m.attached_cards?.length && (
              <ul className="chat-message-card-tags" aria-label="Thẻ đã gửi">
                {m.attached_cards.map((card: Item, index: number) => (
                  <li key={index} title={card.work_title}>
                    @ {card.title}
                  </li>
                ))}
              </ul>
            )}
            {m.role === 'user' ? (
              <p className="chat-user-text">{m.text}</p>
            ) : (
              <div className="chat-markdown">
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ href, children }) => (
                      <a href={href} target="_blank" rel="noreferrer">
                        {children}
                      </a>
                    ),
                  }}
                >
                  {m.text}
                </Markdown>
              </div>
            )}
            {!!m.proposals?.length && (
              <div className="chat-proposals">
                {m.proposals.map((p: Item) => (
                  <div className="chat-change" key={p.id}>
                    <button onClick={() => showProposal(p.id)} disabled={p.status === 'missing'}>
                      <FileCheck2 size={17} />
                      <span>
                        <b>{p.title}</b>
                        <small>
                          {p.count} thay đổi ·{' '}
                          {p.status === 'draft'
                            ? 'Chờ bạn duyệt'
                            : p.status === 'applied'
                              ? 'Đã áp dụng'
                              : p.status === 'undone'
                                ? 'Đã hoàn tác'
                                : 'Đã bỏ qua'}
                        </small>
                        <span>{p.status === 'draft' ? 'Xem đề xuất' : 'Xem thay đổi'} →</span>
                      </span>
                    </button>
                    {p.status === 'applied' && p.revision_id && (
                      <button
                        className="chat-undo text-btn"
                        disabled={running || sending}
                        onClick={() => undo(p.revision_id)}
                      >
                        <Undo2 size={14} />
                        Hoàn tác
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {!!m.sources?.length && (
              <details className="chat-sources">
                <summary>{m.sources.length} nguồn đã tra cứu</summary>
                {m.sources.map((s: Item) =>
                  s.chunk_id.startsWith('note:') ? (
                    <span key={s.chunk_id}>{s.title} · Ghi chú</span>
                  ) : (
                    <button key={s.chunk_id} onClick={() => showSource(s.chunk_id)}>
                      <BookOpen size={13} />
                      {s.title} · {s.location}
                    </button>
                  ),
                )}
              </details>
            )}
            {m.status === 'running' && (
              <p className="chat-activity" role="status">
                <span />
                {thread.activity || 'Đang xử lý…'}
              </p>
            )}
            {m.status === 'interrupted' && (
              <p className="chat-interrupted">{m.error || 'Đã dừng trả lời.'}</p>
            )}
            {m.status === 'error' && (
              <div className="chat-error" role="alert">
                <p>{m.error || 'Chưa nhận được câu trả lời.'}</p>
                <button
                  className="text-btn"
                  disabled={sending || running}
                  onClick={() => {
                    const previous = thread.messages[i - 1]
                    void send(
                      previous?.text,
                      previous?.context,
                      previous?.document_ids || [],
                      previous?.card_references || [],
                    )
                  }}
                >
                  Gửi lại
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
      {unread && (
        <button
          className="chat-jump"
          onClick={() => {
            nearBottom.current = true
            body.current?.scrollTo({ top: body.current.scrollHeight, behavior: 'smooth' })
            setUnread(false)
          }}
        >
          Xem tin nhắn mới ↓
        </button>
      )}
      <div className="chat-compose">
        {!available && (
          <p className="chat-error" role="status">
            Kết nối Codex để trò chuyện trong không gian của bạn.{' '}
            {onConnect && (
              <button className="text-btn" onClick={onConnect}>
                Mở kết nối Codex
              </button>
            )}
          </p>
        )}
        {(error || pollError) && (
          <div className="chat-error" role="alert">
            {error || pollError}
            <button
              className="text-btn"
              onClick={() =>
                refresh()
                  .then(() => {
                    setError('')
                    setPollError('')
                  })
                  .catch((e) => setPollError(e.message))
              }
            >
              Thử kết nối lại
            </button>
          </div>
        )}
        {waitingSources && (
          <p className="chat-source-progress" role="status">
            <LoaderCircle className="spin" size={15} />
            Đang đọc nguồn mới, sẽ tổng hợp khi sẵn sàng…
          </p>
        )}
        {draftSources.length > 0 && !waitingSources && (
          <div className="chat-draft-sources">
            <Paperclip size={13} />
            <span>{draftSources.length} nguồn đính kèm</span>
            <button
              className="icon-btn"
              aria-label="Bỏ đính kèm nguồn"
              onClick={() => setDraftSources([])}
            >
              <X size={13} />
            </button>
          </div>
        )}
        {cards.length > 0 && (
          <>
            <ul className="chat-card-tags" aria-label="Thẻ đính kèm Codex">
              {cards.map((card) => (
                <li key={tagKey(card)} data-chat-card-tag={tagKey(card)}>
                  <span title={card.work_title + ' / ' + card.title}>@ {card.title}</span>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={'Bỏ thẻ ' + card.title + ' (' + card.work_title + ')'}
                    onClick={() =>
                      onCardsChange((current) =>
                        current.filter((item) => tagKey(item) !== tagKey(card)),
                      )
                    }
                  >
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
            <p className="chat-card-note">Dùng nội dung đã lưu của thẻ khi gửi.</p>
          </>
        )}
        {context && (
          <label className="chat-context">
            <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} />
            <span>Đính kèm: {context.title}</span>
          </label>
        )}
        <label
          className="chat-auto-mode"
          title="Thêm và sửa dữ liệu được lưu ngay, có hoàn tác. Xóa và xếp buổi làm vẫn cần duyệt."
        >
          <input
            type="checkbox"
            aria-label="AI tự áp dụng thêm và sửa"
            checked={autoApply}
            onChange={(e) => setAutoApply(e.target.checked)}
            disabled={running || sending}
          />
          <span>{autoApply ? 'AI quản lý · có hoàn tác' : 'Chỉ tạo bản nháp'}</span>
        </label>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!waitingSources) void send()
          }}
        >
          <label className="sr-only" htmlFor="codex-message">
            Tin nhắn cho Codex
          </label>
          <textarea
            ref={input}
            id="codex-message"
            placeholder="Nhắn Codex hoặc dán yêu cầu…"
            rows={3}
            maxLength={12000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              if (e.clipboardData.files.length && onAddSource) {
                e.preventDefault()
                onAddSource(Array.from(e.clipboardData.files))
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                if (!waitingSources) void send()
              }
            }}
          />
          <div className="chat-compose-actions">
            {onAddSource ? (
              <button
                type="button"
                className="chat-attach"
                disabled={sending || running || waitingSources}
                onClick={() => onAddSource()}
              >
                <Paperclip size={15} />
                Thêm nguồn
              </button>
            ) : (
              <small>Enter để gửi</small>
            )}
            {running ? (
              <button type="button" className="chat-send" aria-label="Dừng trả lời" onClick={stop}>
                <Square size={14} />
              </button>
            ) : (
              <button
                className="chat-send"
                type="submit"
                aria-label="Gửi tin nhắn"
                disabled={!text.trim() || sending || loading || !available || waitingSources}
              >
                <ArrowUp size={18} />
              </button>
            )}
          </div>
        </form>
        <p className="chat-shortcuts">Enter để gửi · Shift + Enter xuống dòng</p>
        <p className="chat-footnote">Nội dung và nguồn đính kèm được xử lý qua Codex.</p>
      </div>
    </section>
  )
}
