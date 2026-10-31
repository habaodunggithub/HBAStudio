import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  FileText,
  Plus,
  Search,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'
import { api } from './api'
import { Button, Empty } from './ui'
import { courseFor } from './CanvasSpace'

type Item = Record<string, any>
const when = (value: string) =>
  new Date(value).toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
const kinds: Item = {
  courses: 'Môn học',
  projects: 'Đồ án',
  deadlines: 'Deadline',
  tasks: 'Công việc',
  notes: 'Ghi chú',
  events: 'Sự kiện',
  blocks: 'Buổi làm',
  sessions: 'Thời gian đã làm',
}

export function SpacePanel({
  title,
  close,
  wide = false,
  children,
  actions,
  inactive = false,
  headerless = false,
}: {
  title: string
  close: () => void
  wide?: boolean
  children: ReactNode
  actions?: ReactNode
  inactive?: boolean
  headerless?: boolean
}) {
  const panel = useRef<HTMLElement>(null),
    opener = useRef<HTMLElement | null>(null)
  useEffect(() => {
    opener.current = document.activeElement as HTMLElement
    panel.current
      ?.querySelector<HTMLButtonElement>('.space-panel-close')
      ?.focus({ preventScroll: true })
    return () => {
      const previous = opener.current
      queueMicrotask(() => {
        if (
          previous?.isConnected &&
          (document.activeElement === document.body || !document.activeElement?.isConnected)
        )
          previous.focus({ preventScroll: true })
      })
    }
  }, [])
  return (
    <div
      className="space-panel-layer"
      inert={inactive}
      aria-hidden={inactive || undefined}
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <section
        ref={panel}
        className={'space-panel ' + (wide ? 'is-wide' : '')}
        role="dialog"
        aria-label={title}
        onKeyDown={(e) => {
          if (
            e.key === 'Escape' &&
            !e.defaultPrevented &&
            !(e.target as HTMLElement).closest('.modal-backdrop')
          ) {
            e.stopPropagation()
            close()
          }
        }}
      >
        {!headerless && (
          <header className="space-panel-heading">
            <h2>{title}</h2>
            <div className="space-panel-header-actions">
              {actions}
              <button
                className="icon-btn space-panel-close"
                aria-label={'Đóng ' + title.toLocaleLowerCase('vi')}
                onClick={close}
              >
                <X size={19} />
              </button>
            </div>
          </header>
        )}
        <div className="space-panel-body">{children}</div>
      </section>
    </div>
  )
}

export function SpaceResources({ data, courseId, action, edit, open, onAdd, onExcerpt }: any) {
  const [query, setQuery] = useState(''),
    [results, setResults] = useState<Item | null>(null),
    [searching, setSearching] = useState(false),
    [error, setError] = useState('')
  const request = useRef(0)
  useEffect(() => {
    request.current++
    setResults(null)
    setQuery('')
    setError('')
    setSearching(false)
  }, [courseId])
  const within = (item: Item, kind: string) =>
    !courseId ||
    (courseId === 'unassigned'
      ? !courseFor(data, item, kind)
      : courseFor(data, item, kind) === courseId)
  const documents = data.documents.filter((d: Item) => within(d, 'documents'))
  const notes = data.notes.filter((n: Item) => within(n, 'notes'))
  const projects = data.projects.filter((p: Item) => within(p, 'projects'))
  const base = courseId && courseId !== 'unassigned' ? { course_id: courseId } : {}
  async function search(event: React.FormEvent) {
    event.preventDefault()
    const version = ++request.current
    setSearching(true)
    setError('')
    try {
      const next = await api(
        '/knowledge/search?q=' +
          encodeURIComponent(query) +
          (courseId && courseId !== 'unassigned'
            ? '&course_id=' + encodeURIComponent(courseId)
            : ''),
      )
      if (version === request.current) setResults(next)
    } catch (e: any) {
      if (version === request.current) setError(e.message)
    } finally {
      if (version === request.current) setSearching(false)
    }
  }
  return (
    <div className="space-resources">
      <div className="space-panel-intro">
        <p>
          {courseId && courseId !== 'unassigned'
            ? data.courses.find((c: Item) => c.id === courseId)?.title
            : 'Nguồn tài liệu trong không gian của bạn'}
        </p>
        <Button subtle onClick={onAdd}>
          <Plus size={16} />
          Thêm tài liệu
        </Button>
      </div>
      <form className="space-source-search" onSubmit={search}>
        <Search size={17} />
        <input
          aria-label="Tìm tài liệu"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            if (!e.target.value) {
              request.current++
              setResults(null)
              setSearching(false)
            }
          }}
          placeholder="Tìm trong nội dung tài liệu…"
        />
        <button
          className="icon-btn"
          aria-label="Tìm kiếm"
          type="submit"
          disabled={searching || !query.trim()}
        >
          <ArrowUpRight size={18} />
        </button>
      </form>
      {error && (
        <p role="alert" className="chat-error">
          {error}
        </p>
      )}
      {searching && (
        <p role="status" className="muted">
          Đang tìm…
        </p>
      )}
      {results && (
        <section className="space-source-results">
          <div className="section-heading">
            <h3>Kết quả tra cứu</h3>
            <button
              className="text-btn"
              onClick={() => {
                request.current++
                setResults(null)
                setSearching(false)
              }}
            >
              Đóng kết quả
            </button>
          </div>
          {results.warning && <p className="muted">{results.warning}</p>}
          {results.hits.map((hit: Item) => (
            <button
              className="search-hit"
              key={hit.chunk_id}
              onClick={() => onExcerpt(hit.chunk_id)}
            >
              <span className="citation">
                <FileText size={14} />
                {hit.citation}
              </span>
              <p>{hit.text}</p>
              <span className="text-btn">
                Xem đoạn nguồn <ArrowUpRight size={14} />
              </span>
            </button>
          ))}
          {results.notes.map((n: Item) => (
            <div className="search-hit" key={n.note_id}>
              <b>{n.citation}</b>
              <p>{n.text}</p>
            </div>
          ))}
          {!results.hits.length && !results.notes.length && (
            <p className="muted pad">Chưa tìm thấy nguồn phù hợp. Thử từ khóa khác.</p>
          )}
        </section>
      )}
      <section>
        <h3 className="space-section-label">
          Tài liệu <span>{documents.length}</span>
        </h3>
        {documents.map((doc: Item) => (
          <div className="space-document" key={doc.id}>
            <FileText size={19} />
            <div>
              <b>{doc.title.replace(/^[a-f0-9]{32}-/, '')}</b>
              <small className={doc.status === 'error' || doc.unavailable ? 'overdue' : ''}>
                {doc.error ||
                  (doc.unavailable
                    ? 'Mất nguồn'
                    : doc.status === 'ready'
                      ? 'Sẵn sàng'
                      : doc.status === 'error'
                        ? 'Lỗi đọc file'
                        : 'Đang xử lý…')}
              </small>
              <label>
                <select
                  aria-label={'Môn học ' + doc.title}
                  value={doc.course_id || ''}
                  onChange={(e) =>
                    action(() =>
                      api('/knowledge/documents/' + doc.id, 'PATCH', {
                        course_id: e.target.value || null,
                      }),
                    )
                  }
                >
                  <option value="">Chưa gắn môn</option>
                  {data.courses.map((c: Item) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {!doc.source_id && (
              <button
                className="icon-btn"
                aria-label={'Gỡ ' + doc.title}
                onClick={() =>
                  action(() => api('/knowledge/documents/' + doc.id, 'DELETE'), 'Đã gỡ tài liệu')
                }
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        ))}
        {!documents.length && (
          <Empty icon={FileText} title="Chưa có tài liệu">
            Thêm đề bài, ảnh hoặc tin nhắn giảng viên để Codex tổng hợp.
          </Empty>
        )}
      </section>
      <details className="space-resource-group">
        <summary>
          Ghi chú <span>{notes.length}</span>
        </summary>
        <div className="space-resource-items">
          {notes.map((note: Item) => (
            <button
              className="space-resource-row"
              key={note.id}
              onClick={() => edit('notes', note)}
            >
              <span>
                <b>{note.title}</b>
                <small>{note.description?.slice(0, 120)}</small>
              </span>
              <ArrowUpRight size={15} />
            </button>
          ))}
          <button className="text-btn" onClick={() => edit('notes', base)}>
            <Plus size={15} />
            Thêm ghi chú
          </button>
        </div>
      </details>
      <details className="space-resource-group">
        <summary>
          Đồ án <span>{projects.length}</span>
        </summary>
        <div className="space-resource-items">
          {projects.map((project: Item) => (
            <button
              className="space-resource-row"
              key={project.id}
              onClick={() => open('projects', project.id)}
            >
              <span>
                <b>{project.title}</b>
                <small>
                  {data.courses.find((c: Item) => c.id === project.course_id)?.title ||
                    'Chưa gắn môn'}
                </small>
              </span>
              <ArrowUpRight size={15} />
            </button>
          ))}
          <button className="text-btn" onClick={() => edit('projects', base)}>
            <Plus size={15} />
            Thêm đồ án
          </button>
        </div>
      </details>
    </div>
  )
}

export function SpaceChanges({ data, selectedId, select, action, editDraft, busy }: any) {
  const [view, setView] = useState(
    selectedId && data.proposals.find((p: Item) => p.id === selectedId)?.status !== 'draft'
      ? 'history'
      : 'draft',
  )
  useEffect(() => {
    if (selectedId)
      setView(
        data.proposals.find((p: Item) => p.id === selectedId)?.status === 'draft'
          ? 'draft'
          : 'history',
      )
  }, [selectedId])
  const selected = data.proposals.find((p: Item) => p.id === selectedId),
    drafts = data.proposals.filter((p: Item) => p.status === 'draft')
  const revisions = [...data.revisions].reverse()
  const revision = selected ? revisions.find((r: Item) => r.proposal_id === selected.id) : null
  const undoable = (r: Item) => r && !r.undone && r.revision === data.revision
  const status = (p: Item) =>
    revisions.some((r: Item) => r.proposal_id === p.id && r.undone)
      ? 'Đã hoàn tác'
      : p.status === 'draft'
        ? 'Chờ duyệt'
        : p.status === 'applied'
          ? 'Đã áp dụng'
          : 'Đã bỏ qua'
  const list = (
    view === 'draft' ? drafts : data.proposals.filter((p: Item) => p.status !== 'draft')
  )
    .slice()
    .reverse()
  return (
    <div className="space-changes">
      <div className="page-tabs" role="tablist" aria-label="Trạng thái thay đổi">
        <button
          role="tab"
          aria-selected={view === 'draft'}
          onClick={() => {
            setView('draft')
            select(null)
          }}
        >
          Chờ duyệt <span>{drafts.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={view === 'history'}
          onClick={() => {
            setView('history')
            select(null)
          }}
        >
          Lịch sử
        </button>
      </div>
      {selected ? (
        <section className="space-change-detail">
          <button className="text-btn" onClick={() => select(null)}>
            <ArrowLeft size={15} />
            Tất cả thay đổi
          </button>
          <h2>{selected.title}</h2>
          <p className="muted">{selected.reason}</p>
          <small className="muted">
            {status(selected)} · {when(selected.created_at)}
          </small>
          {selected.status === 'draft' && selected.base_revision !== data.revision && (
            <p role="alert" className="alert error">
              Dữ liệu đã đổi. Cần nhờ Codex tạo bản xem trước mới.
            </p>
          )}
          {selected.preview?.risks?.map((risk: Item, index: number) => (
            <p className="space-change-risk" key={index}>
              {risk.title}: {risk.reason}
            </p>
          ))}
          {(selected.operations || []).map((op: Item, index: number) => (
            <div className="operation" key={index}>
              <span className={'tag ' + (op.action === 'delete' ? 'amber' : '')}>
                {op.action === 'create' ? 'Thêm' : op.action === 'update' ? 'Sửa' : 'Gỡ'}
              </span>
              <div>
                <b>
                  {op.data?.title ||
                    data[op.kind]?.find((item: Item) => item.id === op.id)?.title ||
                    kinds[op.kind]}
                </b>
                <small>
                  {kinds[op.kind]}
                  {op.data?.estimate_minutes
                    ? ` · ${op.data.estimate_minutes >= 60 ? op.data.estimate_minutes / 60 + ' giờ' : op.data.estimate_minutes + ' phút'}`
                    : ''}
                  {op.data?.due_at ? ' · ' + when(op.data.due_at) : ''}
                  {op.data?.start ? ' · ' + when(op.data.start) : ''}
                </small>
                {op.data?.description && <p>{op.data.description}</p>}
                {selected.status === 'draft' && op.action !== 'delete' && (
                  <button className="text-btn" onClick={() => editDraft(selected, op, index)}>
                    Chỉnh thay đổi này
                  </button>
                )}
              </div>
            </div>
          ))}
          {selected.status === 'draft' ? (
            <div className="proposal-actions">
              <Button
                subtle
                disabled={busy}
                onClick={() =>
                  action(
                    () => api('/proposals/' + selected.id + '/reject', 'POST'),
                    'Đã bỏ qua đề xuất',
                  ).then((r: any) => {
                    if (r) select(null)
                  })
                }
              >
                Bỏ qua
              </Button>
              <Button
                disabled={busy || selected.base_revision !== data.revision}
                onClick={() =>
                  action(
                    () => api('/proposals/' + selected.id + '/apply', 'POST'),
                    'Đã áp dụng đề xuất',
                  ).then((r: any) => {
                    if (r) select(null)
                  })
                }
              >
                <Check size={16} />
                Áp dụng thay đổi
              </Button>
            </div>
          ) : (
            undoable(revision) && (
              <Button
                subtle
                disabled={busy}
                onClick={() =>
                  action(() => api('/revisions/' + revision.id + '/undo', 'POST'), 'Đã hoàn tác')
                }
              >
                <Undo2 size={15} />
                Hoàn tác thay đổi này
              </Button>
            )
          )}
        </section>
      ) : (
        <>
          <div className="space-change-list">
            {list.map((p: Item) => (
              <button className="space-change-row" key={p.id} onClick={() => select(p.id)}>
                <span className="tag">{status(p)}</span>
                <h3>{p.title}</h3>
                <small>
                  {p.operations?.length || 0} thay đổi · {when(p.created_at)}
                </small>
              </button>
            ))}
            {!list.length && (
              <Empty
                icon={Check}
                title={view === 'draft' ? 'Không có thay đổi chờ duyệt' : 'Chưa có thay đổi từ AI'}
              >
                {view === 'draft'
                  ? 'Những thay đổi cần duyệt sẽ xuất hiện ở đây.'
                  : 'Các thay đổi từ Codex sẽ được giữ lại để bạn xem và hoàn tác.'}
              </Empty>
            )}
          </div>
          {view === 'history' && revisions.some((r: Item) => !r.proposal_id) && (
            <details className="space-resource-group">
              <summary>Chỉnh sửa trực tiếp</summary>
              {revisions
                .filter((r: Item) => !r.proposal_id)
                .map((r: Item) => (
                  <div className="space-revision" key={r.id}>
                    <small>
                      {when(r.created_at)}
                      {r.undone ? ' · Đã hoàn tác' : ''}
                    </small>
                    {undoable(r) && (
                      <button
                        className="text-btn"
                        disabled={busy}
                        onClick={() =>
                          action(() => api('/revisions/' + r.id + '/undo', 'POST'), 'Đã hoàn tác')
                        }
                      >
                        <Undo2 size={14} />
                        Hoàn tác
                      </button>
                    )}
                  </div>
                ))}
            </details>
          )}
        </>
      )}
    </div>
  )
}
