import { WorkText, PriorityList } from './workspace/WorkText'
export { PriorityList } from './workspace/WorkText'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  LoaderCircle,
  MoreHorizontal,
  LayoutGrid,
  List,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { api } from './api'
import { WorkBoard } from './WorkBoard'
import { useWorkBoard } from './board/useWorkBoard'
import type { WorkView } from './board/model'
import { flushReaderDrafts } from './readerDrafts'
import type { BoardCardTag } from './BoardCardTag'
import { Button } from './ui'

type Item = Record<string, any>
type WorkTab = 'steps' | 'documents' | 'suggestions'
const timeText = (value: string) =>
  new Date(value).toLocaleTimeString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
  })
const dateText = (value: string) =>
  new Date(value).toLocaleDateString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
export function WorkWorkspace({
  kind,
  id,
  revision,
  open,
  edit,
  action,
  back,
  backLabel,
  focus,
  record,
  headerActions,
  attachedCards,
  onAttachCard,
  onCardDrag,
}: {
  attachedCards: BoardCardTag[]
  onAttachCard: (tag: BoardCardTag) => void
  onCardDrag: (tag: BoardCardTag, point: { x: number; y: number } | null) => void
  headerActions?: ReactNode
  kind: string
  id: string
  revision: number
  open: (kind: string, id: string) => void
  edit: (kind: string, item: Item) => void
  action: (fn: () => Promise<any>, message?: string) => Promise<any>
  back: () => void
  backLabel?: string
  focus: (id: string) => void
  record: (id: string) => void
}) {
  const [detail, setDetail] = useState<Item | null>(null),
    [error, setError] = useState(''),
    [loadError, setLoadError] = useState(''),
    [newStep, setNewStep] = useState(''),
    [saving, setSaving] = useState(false),
    [uploading, setUploading] = useState(false),
    [dragOver, setDragOver] = useState(false)
  const [tab, setTab] = useState<WorkTab>('steps'),
    [source, setSource] = useState<Item | null>(null),
    [editing, setEditing] = useState<number | null>(null),
    [editText, setEditText] = useState('')
  const board = useWorkBoard(kind, id)
  const [suggestionsRequested, setSuggestionsRequested] = useState(false),
    [info, setInfo] = useState(false),
    [preferredView, setPreferredView] = useState(
      () => localStorage.getItem('hba-work-view') || 'board',
    )
  const view = board.layout.view || preferredView
  async function setView(value: WorkView) {
    try {
      const pending = flushReaderDrafts()
      if (pending) await pending
      setPreferredView(value)
      localStorage.setItem('hba-work-view', value)
      board.change({ view: value })
    } catch (e: any) {
      setError(e.message)
    }
  }
  const requested = useRef(''),
    mounted = useRef(true),
    requestVersion = useRef(0),
    menuRef = useRef<HTMLDetailsElement>(null),
    sourceDialog = useRef<HTMLElement | null>(null),
    sourceOpener = useRef<HTMLElement | null>(null),
    tabsRef = useRef<HTMLDivElement>(null),
    fileInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (detail && document.activeElement === document.body)
      document
        .querySelector<HTMLElement>('.work-header .space-panel-close')
        ?.focus({ preventScroll: true })
  }, [Boolean(detail)])
  const load = useCallback(async () => {
    const version = ++requestVersion.current
    try {
      const result = await api(`/workspaces/${kind}/${encodeURIComponent(id)}`)
      if (mounted.current && version === requestVersion.current) {
        setDetail(result)
        setLoadError('')
      }
    } catch (e: any) {
      if (mounted.current && version === requestVersion.current) setLoadError(e.message)
    }
  }, [kind, id])
  useEffect(() => {
    mounted.current = true
    load()
    const timer = setInterval(load, 3000)
    return () => {
      mounted.current = false
      clearInterval(timer)
    }
  }, [load])
  useEffect(() => {
    load()
  }, [revision, load])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSource(null)
        setEditing(null)
        if (menuRef.current) menuRef.current.open = false
      }
    }
    const outside = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node))
        menuRef.current.open = false
    }
    addEventListener('keydown', key)
    addEventListener('pointerdown', outside)
    return () => {
      removeEventListener('keydown', key)
      removeEventListener('pointerdown', outside)
    }
  }, [])
  useEffect(() => {
    if (!source) return
    const dialog = sourceDialog.current
    ;(dialog?.querySelector('button') as HTMLButtonElement)?.focus()
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !dialog) return
      const buttons = Array.from(
        dialog.querySelectorAll<HTMLButtonElement>('button:not([disabled])'),
      )
      const first = buttons[0],
        last = buttons[buttons.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    dialog?.addEventListener('keydown', trap)
    return () => {
      dialog?.removeEventListener('keydown', trap)
      queueMicrotask(() => sourceOpener.current?.focus())
    }
  }, [Boolean(source)])
  useEffect(() => {
    if (
      suggestionsRequested &&
      detail &&
      !detail.documents.some((d: Item) => d.status === 'pending')
    ) {
      setSuggestionsRequested(false)
      void refresh()
    }
  }, [suggestionsRequested, detail])
  async function checklist(items: Item[]) {
    setSaving(true)
    requestVersion.current++
    setDetail((old) => (old ? { ...old, item: { ...old.item, checklist: items } } : old))
    const result = await action(
      () =>
        api(`/${kind}/${encodeURIComponent(id)}`, 'PATCH', {
          checklist: items,
        }),
      'Đã lưu đầu việc',
    )
    if (result) {
      setNewStep('')
      setEditing(null)
    }
    await load()
    setSaving(false)
    return !!result
  }
  async function refresh() {
    setSaving(true)
    setError('')
    try {
      await api(`/workspaces/${kind}/${encodeURIComponent(id)}/analyze`, 'POST', { force: true })
      requested.current = detail?.fingerprint || ''
      await load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }
  async function upload(files: File[]) {
    if (!files.length || uploading) return
    if (files.some((file) => !/\.(pdf|docx|xlsx|txt|md|markdown)$/i.test(file.name))) {
      setError('Chọn file PDF, DOCX, XLSX, Markdown hoặc TXT.')
      return
    }
    if (files.some((file) => file.size > 50 * 1024 * 1024)) {
      setError('Mỗi file cần nhỏ hơn hoặc bằng 50 MB.')
      return
    }
    setUploading(true)
    setError('')
    try {
      await action(
        async () => {
          for (const file of files) {
            const form = new FormData()
            form.append('file', file)
            form.append('work_kind', kind)
            form.append('work_id', id)
            await api('/knowledge/upload', 'POST', form)
          }
          return { ok: true }
        },
        files.length === 1 ? 'Đã thêm tài liệu' : `Đã thêm ${files.length} tài liệu`,
      )
      await load()
    } finally {
      setUploading(false)
    }
  }
  async function toggleDone() {
    setSaving(true)
    const done = kind === 'deadlines' ? detail?.item.done : detail?.item.status === 'done'
    await action(() =>
      api(
        `/${kind}/${encodeURIComponent(id)}`,
        'PATCH',
        kind === 'deadlines'
          ? { done: !done }
          : {
              status: done ? (kind === 'projects' ? 'active' : 'todo') : 'done',
            },
      ),
    )
    await load()
    setSaving(false)
  }
  function openSource(ref: Item) {
    sourceOpener.current = document.activeElement as HTMLElement
    setSource(ref)
  }
  function other(fn: () => void) {
    if (menuRef.current) menuRef.current.open = false
    fn()
  }
  function switchTab(next: WorkTab) {
    setTab(next)
    if (view === 'board' && next === 'suggestions')
      board.change({
        suggestions: true,
        hidden: board.layout.hidden.filter((key: string) => key !== 'suggestions'),
      })
    if (view === 'board' && next === 'documents') setView('list')
    if (
      next === 'suggestions' &&
      detail &&
      (!detail.analysis.brief || detail.analysis.stale) &&
      !['queued', 'running'].includes(detail.analysis.status)
    )
      setSuggestionsRequested(true)
  }
  function tabsKey(event: React.KeyboardEvent) {
    const names: WorkTab[] = ['steps', 'documents', 'suggestions']
    let index = names.indexOf(tab)
    if (event.key === 'ArrowRight') index = (index + 1) % 3
    else if (event.key === 'ArrowLeft') index = (index + 2) % 3
    else if (event.key === 'Home') index = 0
    else if (event.key === 'End') index = 2
    else return
    event.preventDefault()
    switchTab(names[index])
    ;(tabsRef.current?.querySelectorAll('button')[index] as HTMLButtonElement)?.focus()
  }
  if (!detail)
    return (
      <section className="work-loading">
        <div className="work-loading-actions">
          {headerActions}
          <button
            className="icon-btn space-panel-close"
            aria-label="Đóng chi tiết trong không gian"
            onClick={back}
          >
            <X size={18} />
          </button>
        </div>
        <Button subtle onClick={back}>
          <ArrowLeft size={15} />
          Quay lại
        </Button>
        <p role={error || loadError ? 'alert' : 'status'}>
          {error || loadError || 'Đang mở công việc…'}
        </p>
      </section>
    )
  const item = detail.item,
    analysis = detail.analysis,
    brief = !analysis.stale && analysis.status === 'ready' ? analysis.brief : null,
    steps: Item[] = item.checklist || []
  const pending = detail.documents.some((d: Item) => d.status === 'pending'),
    analyzing = ['queued', 'running'].includes(analysis.status),
    done = item.done || item.status === 'done'
  const recommendation = detail.recommendations.find((r: Item) => r.kind === kind && r.id === id),
    due = item.due_at || detail.deadline?.due_at
  const leaf = kind === 'tasks' && !detail.tasks.some((t: Item) => t.parent_id === id),
    related = detail.tasks.filter((t: Item) => t.id !== id)
  const adopted = (step: Item) =>
    steps.some(
      (existing) =>
        existing.text.trim().toLocaleLowerCase() === step.title.trim().toLocaleLowerCase(),
    )
  const newSuggestions: Item[] = brief?.steps.filter((step: Item) => !adopted(step)) || []
  const completed = steps.filter((step) => step.done).length
  const sourceIndex = source ? detail.sources.findIndex((ref: Item) => ref.id === source.id) : -1
  const warnings = [...new Set<string>(brief?.warnings || [])]
  const stepsContent = (
    <>
      <div className="work-section-title">
        <h2>Đầu việc cần làm</h2>
        {steps.length > 0 && (
          <span className="muted">
            {completed}/{steps.length} đã xong
          </span>
        )}
      </div>
      {steps.length > 0 && (
        <div
          className="work-progress"
          role="progressbar"
          aria-label="Tiến độ đầu việc"
          aria-valuenow={completed}
          aria-valuemin={0}
          aria-valuemax={steps.length}
        >
          <span style={{ width: (completed / steps.length) * 100 + '%' }} />
        </div>
      )}
      {!steps.length && (
        <div className="work-empty">
          <p>Chưa có đầu việc.</p>
          <span>
            Nhập một bước cần làm bên dưới
            {newSuggestions.length ? ' hoặc dùng gợi ý từ tài liệu.' : '.'}
          </span>
          {newSuggestions.length > 0 && (
            <button className="text-btn" onClick={() => switchTab('suggestions')}>
              Xem {newSuggestions.length} gợi ý <ArrowRight size={14} />
            </button>
          )}
        </div>
      )}
      <div className="work-checklist">
        {steps.map((step, index) =>
          editing === index ? (
            <form
              className="step-edit"
              key={index}
              onSubmit={(event) => {
                event.preventDefault()
                if (editText.trim())
                  checklist(
                    steps.map((s, i) => (i === index ? { ...s, text: editText.trim() } : s)),
                  )
              }}
            >
              <input
                autoFocus
                aria-label="Nội dung đầu việc"
                value={editText}
                onChange={(event) => setEditText(event.target.value)}
              />
              <button
                className="icon-btn"
                type="submit"
                disabled={saving || !editText.trim()}
                aria-label="Lưu đầu việc"
              >
                <Check size={16} />
              </button>
              <button
                className="icon-btn"
                type="button"
                onClick={() => setEditing(null)}
                aria-label="Hủy sửa đầu việc"
              >
                <X size={16} />
              </button>
            </form>
          ) : (
            <div className={'work-check-row ' + (step.done ? 'is-done' : '')} key={index}>
              <label>
                <input
                  type="checkbox"
                  checked={step.done}
                  disabled={saving}
                  onChange={(event) =>
                    checklist(
                      steps.map((s, i) => (i === index ? { ...s, done: event.target.checked } : s)),
                    )
                  }
                />
                <span>{step.text}</span>
              </label>
              <div className="step-row-actions">
                <button
                  className="icon-btn"
                  disabled={saving}
                  aria-label={'Sửa đầu việc ' + step.text}
                  onClick={() => {
                    setEditing(index)
                    setEditText(step.text)
                  }}
                >
                  <Pencil size={14} />
                </button>
                <button
                  className="icon-btn"
                  disabled={saving}
                  aria-label={'Xóa đầu việc ' + step.text}
                  onClick={() => checklist(steps.filter((_, i) => i !== index))}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ),
        )}
      </div>
      <form
        className="step-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (newStep.trim() && steps.length < 200)
            checklist([...steps, { text: newStep.trim(), done: false }])
        }}
      >
        <Plus size={17} />
        <input
          aria-label="Đầu việc mới"
          value={newStep}
          onChange={(event) => setNewStep(event.target.value)}
          placeholder="Thêm đầu việc…"
          maxLength={2000}
          disabled={saving || steps.length >= 200}
        />
        <Button type="submit" subtle disabled={saving || !newStep.trim() || steps.length >= 200}>
          Thêm
        </Button>
      </form>
      {steps.length >= 200 && (
        <p className="muted">Đã đủ 200 đầu việc. Bạn có thể chỉnh sửa các mục hiện có.</p>
      )}
      {view === 'list' && related.length > 0 && (
        <div className="work-linked">
          <h3>Công việc liên quan</h3>
          {related.map((task: Item) => (
            <button key={task.id} className="work-related" onClick={() => open('tasks', task.id)}>
              <span>{task.title}</span>
              <ArrowUpRight size={15} />
            </button>
          ))}
        </div>
      )}
    </>
  )
  const suggestionsContent = (
    <div aria-label="Phân tích tài liệu">
      <div className="work-section-title">
        <div>
          <h2>Gợi ý thực hiện</h2>
          <p>Tổng hợp từ mô tả và tài liệu của công việc.</p>
        </div>
        <Button subtle onClick={refresh} disabled={saving || pending || analyzing}>
          <RefreshCw size={14} />
          Đọc lại
        </Button>
      </div>
      {pending || analyzing ? (
        <p role="status" className="work-inline-status">
          <LoaderCircle size={15} className="spin" />
          {pending ? 'Đang xử lý tài liệu mới…' : 'Đang đọc tài liệu…'}
        </p>
      ) : analysis.status === 'error' ? (
        <div className="work-analysis-error">
          <p>Chưa đọc được tài liệu.</p>
          <details>
            <summary>Xem lý do</summary>
            <p>{analysis.error}</p>
          </details>
        </div>
      ) : !brief ? (
        <p className="muted">Đang chuẩn bị gợi ý…</p>
      ) : null}
      {brief && (
        <>
          <div className="work-brief-summary">
            <WorkText value={brief.summary} />
          </div>
          {warnings.length > 0 && (
            <details className="work-caveats">
              <summary>
                Cần kiểm tra thêm <span>{warnings.length}</span>
              </summary>
              <ul>
                {warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
              {!detail.documents.length && (
                <button className="text-btn" onClick={() => switchTab('documents')}>
                  Thêm đề bài <ArrowRight size={13} />
                </button>
              )}
            </details>
          )}
          <div className="suggestion-actions">
            <span className="muted">
              {newSuggestions.length
                ? `${newSuggestions.length} gợi ý có thể thêm`
                : 'Các gợi ý đã có trong đầu việc'}
            </span>
            <Button
              subtle
              disabled={saving || !newSuggestions.length || steps.length >= 200}
              onClick={async () => {
                if (
                  await checklist(
                    [
                      ...steps,
                      ...newSuggestions.map((step) => ({
                        text: step.title,
                        done: false,
                      })),
                    ].slice(0, 200),
                  )
                )
                  switchTab('steps')
              }}
            >
              Thêm vào đầu việc
            </Button>
          </div>
          <div className="agent-steps">
            {brief.steps.map((step: Item, index: number) => (
              <details className="suggested-step" key={index}>
                <summary>
                  <span className="suggestion-number">{index + 1}</span>
                  <b>{step.title}</b>
                  {adopted(step) ? (
                    <Check size={15} aria-label="Đã thêm" />
                  ) : (
                    <ChevronRight size={15} />
                  )}
                </summary>
                <div className="suggested-step-body">
                  <WorkText value={step.detail} />
                  <div className="source-tags">
                    {step.source_ids.map((sourceId: string) => {
                      const ref = detail.sources.find((s: Item) => s.id === sourceId)
                      return sourceId === 'description' ? (
                        <span className="source-note" key={sourceId}>
                          Dựa trên mô tả
                        </span>
                      ) : ref ? (
                        <button className="text-btn" key={sourceId} onClick={() => openSource(ref)}>
                          <FileText size={13} />
                          {ref.title} · {ref.location}
                        </button>
                      ) : null
                    })}
                    {!step.source_ids.length && (
                      <span className="source-note">Đề xuất để bạn cân nhắc</span>
                    )}
                  </div>
                  {!adopted(step) && (
                    <button
                      className="text-btn"
                      disabled={saving || steps.length >= 200}
                      onClick={() => checklist([...steps, { text: step.title, done: false }])}
                    >
                      <Plus size={13} />
                      Thêm đầu việc này
                    </button>
                  )}
                </div>
              </details>
            ))}
          </div>
          {brief.priority_reason && (
            <details className="work-description work-priority-detail">
              <summary>Vì sao nên làm theo thứ tự này?</summary>
              <WorkText value={brief.priority_reason} />
            </details>
          )}
        </>
      )}
    </div>
  )
  return (
    <div className={'work-workspace ' + (view === 'board' ? 'has-board' : 'has-list')}>
      <header className="work-header">
        <button
          className="icon-btn work-back"
          aria-label={'Quay lại ' + (backLabel || 'Không gian')}
          title={'Quay lại ' + (backLabel || 'Không gian')}
          onClick={back}
        >
          <ArrowLeft size={17} />
        </button>
        <div className="work-heading">
          <h1 title={item.title}>{item.title}</h1>
        </div>
        <div className="work-header-actions">
          <div className="work-view-switch" role="group" aria-label="Cách xem công việc">
            <button
              aria-label="Board"
              title="Board"
              aria-pressed={view === 'board'}
              onClick={() => setView('board')}
            >
              <LayoutGrid size={14} aria-hidden="true" />
              <span>Board</span>
            </button>
            <button
              aria-label="Danh sách"
              title="Danh sách"
              aria-pressed={view === 'list'}
              onClick={() => setView('list')}
            >
              <List size={14} aria-hidden="true" />
              <span>Danh sách</span>
            </button>
          </div>
          {leaf && !done && (
            <button
              className="icon-btn"
              title="Tập trung"
              aria-label="Tập trung"
              onClick={() => focus(id)}
            >
              <Play size={16} />
            </button>
          )}
          {(kind !== 'tasks' || leaf) && (
            <button
              className={'icon-btn work-complete ' + (done ? 'is-done' : '')}
              title={done ? 'Mở lại công việc' : 'Hoàn thành'}
              onClick={toggleDone}
              disabled={saving}
              aria-label={done ? 'Mở lại công việc' : 'Đánh dấu hoàn thành'}
            >
              <Check size={17} />
            </button>
          )}
          <details className="work-menu" ref={menuRef}>
            <summary className="icon-btn" aria-label="Thao tác khác">
              <MoreHorizontal size={20} />
            </summary>
            <div className="work-menu-items">
              <button onClick={() => other(() => setInfo(!info))}>
                <FileText size={15} />
                Thông tin công việc
              </button>
              <button onClick={() => other(() => edit(kind, item))}>
                <Pencil size={15} />
                Chỉnh thông tin
              </button>
              {leaf && (
                <>
                  <button onClick={() => other(() => record(id))}>
                    <Clock3 size={15} />
                    Ghi thời gian
                  </button>
                  {done && (
                    <button onClick={() => other(() => focus(id))}>
                      <Play size={15} />
                      Bắt đầu tập trung
                    </button>
                  )}
                </>
              )}
            </div>
          </details>
          {headerActions}
          <button
            className="icon-btn space-panel-close"
            title="Đóng không gian công việc"
            aria-label="Đóng chi tiết trong không gian"
            onClick={back}
          >
            <X size={18} />
          </button>
        </div>
      </header>
      {(error || loadError) && (
        <div className="alert error" role="alert">
          <span>{error || loadError}</span>
          <button
            aria-label="Đóng lỗi trong công việc"
            onClick={() => {
              setError('')
              setLoadError('')
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {view === 'board' ? (
        board.loaded ? (
          <WorkBoard
            attachedCards={attachedCards}
            onAttachCard={onAttachCard}
            onCardDrag={onCardDrag}
            board={board}
            detail={detail}
            stepsContent={stepsContent}
            suggestionsContent={suggestionsContent}
            upload={upload}
            uploading={uploading}
            edit={edit}
            onSuggest={() => {
              if (!brief && !analyzing) setSuggestionsRequested(true)
            }}
            open={open}
          />
        ) : (
          <p role={board.failed ? 'alert' : 'status'}>{board.status || 'Đang mở board…'}</p>
        )
      ) : (
        <div className="work-layout">
          <div className="work-main">
            <div
              className="work-tabs"
              role="tablist"
              aria-label="Nội dung công việc"
              ref={tabsRef}
              onKeyDown={tabsKey}
            >
              {(
                [
                  ['steps', 'Đầu việc', steps.length],
                  ['documents', 'Tài liệu', detail.documents.length],
                  ['suggestions', 'Gợi ý', null],
                ] as const
              ).map(([value, label, count]) => (
                <button
                  key={value}
                  id={'work-tab-' + value}
                  role="tab"
                  aria-selected={tab === value}
                  aria-controls={'work-panel-' + value}
                  tabIndex={tab === value ? 0 : -1}
                  onClick={() => switchTab(value)}
                >
                  {label}
                  {count !== null && count > 0 && <span>{count}</span>}
                  {value === 'suggestions' && analyzing && (
                    <LoaderCircle size={12} className="spin" />
                  )}
                </button>
              ))}
            </div>
            <section
              id={'work-panel-' + tab}
              aria-labelledby={'work-tab-' + tab}
              role="tabpanel"
              tabIndex={0}
              className="work-tab-panel"
            >
              {tab === 'steps' && stepsContent}
              {tab === 'documents' && (
                <>
                  <div className="work-section-title">
                    <div>
                      <h2>Tài liệu của công việc</h2>
                      <p>Đề bài và tài liệu tham khảo liên quan.</p>
                    </div>
                  </div>
                  <div
                    className={'work-upload ' + (dragOver ? 'is-dragging' : '')}
                    onDragOver={(event) => {
                      event.preventDefault()
                      setDragOver(true)
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(event) => {
                      event.preventDefault()
                      setDragOver(false)
                      upload(Array.from(event.dataTransfer.files))
                    }}
                  >
                    <Upload size={21} />
                    <div>
                      <p>
                        Kéo file vào đây hoặc{' '}
                        <button
                          disabled={uploading}
                          className="text-btn"
                          onClick={() => fileInput.current?.click()}
                        >
                          chọn tài liệu
                        </button>
                      </p>
                      <small>PDF, DOCX, XLSX, Markdown, TXT · Tối đa 50 MB/file</small>
                    </div>
                    <input
                      ref={fileInput}
                      type="file"
                      aria-label="Thêm tài liệu cho công việc"
                      hidden
                      multiple
                      accept=".pdf,.docx,.xlsx,.txt,.md,.markdown"
                      disabled={uploading}
                      onChange={(event) => {
                        upload(Array.from(event.target.files || []))
                        event.target.value = ''
                      }}
                    />
                  </div>
                  {uploading && (
                    <p role="status" className="work-inline-status">
                      <LoaderCircle className="spin" size={14} />
                      Đang tải tài liệu…
                    </p>
                  )}
                  {!detail.documents.length && (
                    <p className="work-empty-note">
                      Tài liệu được thêm ở đây sẽ gắn với công việc này.
                    </p>
                  )}
                  <div className="work-documents">
                    {detail.documents.map((doc: Item) => {
                      const refs = detail.sources.filter((ref: Item) => ref.document_id === doc.id)
                      return (
                        <details className="work-document" key={doc.id}>
                          <summary>
                            <FileText size={18} />
                            <div>
                              <b>{doc.title}</b>
                              <small>
                                {doc.error ||
                                  (doc.unavailable
                                    ? 'Không tìm thấy file gốc'
                                    : doc.status === 'ready'
                                      ? doc.work_id
                                        ? 'Tài liệu riêng'
                                        : 'Tài liệu dùng chung'
                                      : 'Đang xử lý…')}
                              </small>
                            </div>
                            <ChevronRight size={15} />
                          </summary>
                          <div className="work-document-content">
                            {refs.length ? (
                              refs.map((ref: Item, index: number) => (
                                <button
                                  className="work-source"
                                  key={ref.id}
                                  onClick={() => openSource(ref)}
                                >
                                  {ref.location}
                                  {refs.filter((r: Item) => r.location === ref.location).length > 1
                                    ? ` · Đoạn ${index + 1}`
                                    : ''}
                                  <ArrowUpRight size={13} />
                                </button>
                              ))
                            ) : (
                              <p className="muted">
                                {doc.status === 'pending'
                                  ? 'Đang đọc nội dung file.'
                                  : 'Chưa có đoạn trích có thể xem.'}
                              </p>
                            )}
                          </div>
                        </details>
                      )
                    })}
                  </div>
                  {detail.sources.some((ref: Item) => !ref.document_id) && (
                    <details className="work-description">
                      <summary>Ghi chú tham khảo</summary>
                      {detail.sources
                        .filter((ref: Item) => !ref.document_id)
                        .map((ref: Item) => (
                          <button
                            className="work-source"
                            key={ref.id}
                            onClick={() => openSource(ref)}
                          >
                            {ref.title}
                          </button>
                        ))}
                    </details>
                  )}
                </>
              )}
              {tab === 'suggestions' && suggestionsContent}
            </section>
          </div>
        </div>
      )}
      {info && (
        <aside
          className="work-info-panel"
          aria-label="Thông tin công việc"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              setInfo(false)
              menuRef.current?.querySelector<HTMLElement>('summary')?.focus()
            }
          }}
        >
          <div className="work-info-heading">
            <h2>Thông tin công việc</h2>
            <button
              className="icon-btn"
              aria-label="Đóng thông tin công việc"
              onClick={() => setInfo(false)}
            >
              <X size={16} />
            </button>
          </div>
          <section className="work-info">
            <h2>Thông tin</h2>
            <p className={'work-state ' + (done ? 'is-done' : '')}>
              {done ? 'Đã hoàn thành' : item.status === 'doing' ? 'Đang thực hiện' : 'Đang mở'}
            </p>
            <dl>
              <div>
                <dt>Hạn hoàn thành</dt>
                <dd>{due ? dateText(due) + ' · ' + timeText(due) : 'Chưa có hạn'}</dd>
              </div>
              {recommendation && (
                <div>
                  <dt>Thứ tự gợi ý</dt>
                  <dd>#{recommendation.rank}</dd>
                </div>
              )}
              {item.estimate_minutes && (
                <div>
                  <dt>Dự kiến</dt>
                  <dd>{item.estimate_minutes} phút</dd>
                </div>
              )}
              <div>
                <dt>Tài liệu</dt>
                <dd>
                  <button
                    className="text-btn"
                    onClick={() => {
                      setView('list')
                      switchTab('documents')
                      setInfo(false)
                    }}
                  >
                    {detail.documents.length} file
                  </button>
                </dd>
              </div>
            </dl>
            {recommendation && <p className="work-order-note">{recommendation.reason}</p>}
          </section>
          <details
            className="work-description"
            open={kind === 'deadlines' || !item.description || undefined}
          >
            <summary>Mô tả & liên kết</summary>
            {item.description ? (
              <WorkText value={item.description} />
            ) : (
              <button className="text-btn" onClick={() => edit(kind, item)}>
                Thêm mô tả
              </button>
            )}
          </details>
          <details className="work-description work-order">
            <summary>Thứ tự các công việc</summary>
            <PriorityList items={detail.recommendations} open={open} limit={8} />
          </details>
        </aside>
      )}
      {source && (
        <div className="modal-backdrop" onClick={() => setSource(null)}>
          <section
            className="modal excerpt-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Nguồn của gợi ý"
            ref={sourceDialog}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <h2>{source.title}</h2>
                <p>{source.location}</p>
              </div>
              <button className="icon-btn" aria-label="Đóng nguồn" onClick={() => setSource(null)}>
                <X size={19} />
              </button>
            </div>
            <pre>{source.text}</pre>
            <div className="work-source-footer">
              <small className="muted">
                Phiên bản {source.hash?.slice(0, 10) || 'ghi chú hiện tại'}
              </small>
              <div className="button-row">
                <button
                  className="icon-btn"
                  aria-label="Đoạn nguồn trước"
                  disabled={sourceIndex <= 0}
                  onClick={() => setSource(detail.sources[sourceIndex - 1])}
                >
                  <ChevronLeft size={17} />
                </button>
                <span>
                  {sourceIndex + 1}/{detail.sources.length}
                </span>
                <button
                  className="icon-btn"
                  aria-label="Đoạn nguồn tiếp theo"
                  disabled={sourceIndex < 0 || sourceIndex >= detail.sources.length - 1}
                  onClick={() => setSource(detail.sources[sourceIndex + 1])}
                >
                  <ChevronRight size={17} />
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
