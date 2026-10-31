import React, { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react'
import {
  CalendarDays,
  BookOpen,
  Check,
  X,
  Clock3,
  Plus,
  Trash2,
  Undo2,
  Leaf,
  AlertCircle,
  Play,
  Square,
  MessageSquare,
  Map as MapIcon,
  ListTodo,
  FileText,
  History,
  Settings,
  UserRound,
} from 'lucide-react'
import { api } from './api'
import { Button } from './ui'
import { EntityEditor } from './workspace/EntityEditor'
import { useTheme, ThemeToggle } from './theme'
import { SettingsPage } from './SettingsPage'
import { ConnectionsPage } from './connections/ConnectionsPage'
import { WorkWorkspace } from './WorkWorkspace'
import { CalendarView } from './CalendarView'
import { CodexChat } from './CodexChat'
import { flushReaderDrafts } from './readerDrafts'
import {
  insideChat,
  storedCardTags,
  tagKey,
  type BoardCardTag,
  type CardDrag,
} from './BoardCardTag'
import { CanvasSpace, courseFor } from './CanvasSpace'
import { SourceIntake } from './SourceIntake'
import { SpacePanel, SpaceResources, SpaceChanges } from './SpacePanels'

type Item = Record<string, any>
const TZ = 'Asia/Ho_Chi_Minh'
const dateText = (v: string, full = false) =>
  v
    ? new Date(v).toLocaleString('vi-VN', {
        timeZone: TZ,
        day: '2-digit',
        month: '2-digit',
        ...(full ? { hour: '2-digit', minute: '2-digit' } : {}),
      })
    : 'Chưa có hạn'
const clock = (v: string) =>
  new Date(v).toLocaleTimeString('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
const oldPanels: Item = {
  knowledge: 'resources',
  proposals: 'changes',
  settings: 'options',
  connections: 'connections',
}
const route = (value: string) =>
  value === 'tasks'
    ? 'space/work'
    : value === 'calendar' ||
        value === 'space' ||
        value.startsWith('space/') ||
        value.startsWith('workspace/')
      ? value
      : 'space'

export function App() {
  const theme = useTheme()
  const [chatOpen, setChatOpen] = useState(() => {
    const saved = localStorage.getItem('pdm-chat-open')
    return saved === null ? matchMedia('(min-width:1000px)').matches : saved === 'true'
  })
  useEffect(() => {
    localStorage.setItem('pdm-chat-open', String(chatOpen))
  }, [chatOpen])
  const [data, setData] = useState<Item | null>(null),
    [tab, setTabState] = useState(() => route(location.hash.slice(1) || 'space'))
  const setTab = (next: string) => {
    const pending = flushReaderDrafts()
    if (pending) void pending.then(() => setTabState(next)).catch((e) => setError(e.message))
    else setTabState(next)
  }
  const [panel, setPanel] = useState<string | null>(
      () => oldPanels[location.hash.slice(1)] || null,
    ),
    [selectedProposalId, setSelectedProposalId] = useState<string | null>(null)
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [lastUndo, setLastUndo] = useState('')
  const [intake, setIntake] = useState<Item | null>(null),
    [chatRequest, setChatRequest] = useState<Item | null>(null),
    [editor, setEditor] = useState<Item | null>(null),
    [excerpt, setExcerpt] = useState<Item | null>(null)
  const [attachedCards, setAttachedCards] = useState<BoardCardTag[]>(storedCardTags),
    [cardDrag, setCardDrag] = useState<CardDrag | null>(null)
  const cardGhost = useRef<HTMLDivElement>(null),
    cardPointer = useRef({ x: 0, y: 0 })
  useEffect(() => {
    try {
      localStorage.setItem('hba-chat-card-tags', JSON.stringify(attachedCards))
    } catch {}
  }, [attachedCards])
  useLayoutEffect(() => {
    if (cardGhost.current) {
      cardGhost.current.style.left = cardPointer.current.x + 14 + 'px'
      cardGhost.current.style.top = cardPointer.current.y + 14 + 'px'
    }
  }, [cardDrag])
  const attachCard = useCallback(
    (tag: BoardCardTag) => {
      setChatOpen(true)
      if (
        !attachedCards.some((item) => tagKey(item) === tagKey(tag)) &&
        attachedCards.length >= 20
      ) {
        setError('Chỉ gắn tối đa 20 thẻ mỗi lượt. Hãy gỡ bớt thẻ trong chat.')
        return
      }
      setAttachedCards((current) =>
        [...current.filter((item) => tagKey(item) !== tagKey(tag)), tag].slice(0, 20),
      )
    },
    [attachedCards],
  )
  const dragCard = useCallback((tag: BoardCardTag, point: { x: number; y: number } | null) => {
    if (!point) {
      setCardDrag(null)
      return
    }
    cardPointer.current = point
    setChatOpen(true)
    const over = insideChat(point.x, point.y)
    setCardDrag((current) =>
      current && tagKey(current.tag) === tagKey(tag) && current.over === over
        ? current
        : { tag, over },
    )
    if (cardGhost.current) {
      cardGhost.current.style.left = point.x + 14 + 'px'
      cardGhost.current.style.top = point.y + 14 + 'px'
    }
  }, [])
  const [priorityItems, setPriorityItems] = useState<Item[]>([]),
    [timer, setTimer] = useState<Item | null>(() => {
      try {
        return JSON.parse(localStorage.getItem('pdm-timer') || 'null')
      } catch {
        return null
      }
    })
  const [welcome, setWelcome] = useState(false)
  useEffect(() => {
    if (
      data &&
      !localStorage.getItem('hba-onboarding-done') &&
      !oldPanels[location.hash.slice(1)] &&
      ![...data.courses, ...data.projects, ...data.tasks, ...data.deadlines].length
    )
      setWelcome(true)
  }, [Boolean(data)])
  useEffect(() => {
    if (!welcome) return
    document.querySelector<HTMLElement>('.connection-welcome h1')?.focus()
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
      queueMicrotask(() => document.querySelector<HTMLElement>('.space-brand')?.focus())
    }
  }, [welcome])
  const finishWelcome = () => {
    localStorage.setItem('hba-onboarding-done', '1')
    setWelcome(false)
    setPanel(null)
  }
  const returnSpace = useRef<string | null>(null)
  const closeIntake = useCallback(() => setIntake(null), [])
  const load = useCallback(async () => {
    try {
      const [workspace, order] = await Promise.all([api('/workspace'), api('/priorities')])
      setData(workspace)
      setPriorityItems(order.items)
    } catch (e: any) {
      setError(e.message)
    }
  }, [])
  useEffect(() => {
    api('/bootstrap')
      .then(load)
      .catch((e) => setError(e.message))
    const id = setInterval(load, 15000)
    return () => clearInterval(id)
  }, [load])
  useEffect(() => {
    if (tab.startsWith('workspace/')) void load()
  }, [tab, load])
  useEffect(() => {
    const target = panel === 'connections' ? 'connections' : tab
    if (location.hash.slice(1) !== target) location.hash = target
  }, [tab, panel])
  useEffect(() => {
    const change = () => {
      const raw = location.hash.slice(1) || 'space'
      if (raw === tab) {
        if (panel === 'connections') setPanel(null)
        return
      }
      setTab(route(raw))
      if (oldPanels[raw]) setPanel(oldPanels[raw])
      else setPanel(null)
    }
    addEventListener('hashchange', change)
    return () => removeEventListener('hashchange', change)
  }, [tab, panel])
  useEffect(() => {
    if (!notice) return
    const timeout = setTimeout(() => setNotice(''), 6500)
    return () => clearTimeout(timeout)
  }, [notice])
  useEffect(() => {
    try {
      localStorage.setItem('pdm-timer', JSON.stringify(timer))
    } catch {}
  }, [timer])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editor) setEditor(null)
        else if (excerpt) setExcerpt(null)
      }
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [editor, excerpt])
  async function action(fn: () => Promise<any>, message = 'Đã lưu thay đổi') {
    setError('')
    setBusy(true)
    try {
      const r = await fn()
      setLastUndo(r?.revision_id || '')
      setNotice(message)
      await load()
      return r
    } catch (e: any) {
      setError(e.message)
      return null
    } finally {
      setBusy(false)
    }
  }
  const edit = (kind: string, item: Item = {}) => {
    setError('')
    setEditor({ ...item, kind })
  }
  const openCourse = (id: string | null) => {
    setPanel(null)
    returnSpace.current = null
    setTab(id ? 'space/' + encodeURIComponent(id) : 'space')
  }
  const openWork = (kind: string, id: string) => {
    if (tab.startsWith('space')) returnSpace.current = tab
    setPanel(null)
    setError('')
    setTab(`workspace/${kind}/${encodeURIComponent(id)}`)
  }
  const workRoute = tab.startsWith('workspace/') ? tab.split('/') : null
  const workItem =
    workRoute && data
      ? data[workRoute[1]]?.find((item: Item) => item.id === decodeURIComponent(workRoute[2] || ''))
      : null
  const workCourse = workItem && data ? courseFor(data, workItem, workRoute![1]) : null
  const canvasRoute = workRoute
    ? returnSpace.current ||
      (workCourse ? 'space/' + encodeURIComponent(workCourse) : 'space/unassigned')
    : tab === 'calendar'
      ? 'space'
      : tab
  const workView = canvasRoute === 'space/work'
  const courseId =
    canvasRoute.startsWith('space/') && !workView ? decodeURIComponent(canvasRoute.slice(6)) : null
  const backToCanvas = () => {
    setPanel(null)
    setTab(canvasRoute)
  }
  const openPanel = (name: string) => {
    if (tab === 'calendar') setTab('space')
    setPanel((previous) => (previous === name ? null : name))
  }
  if (!data)
    return (
      <div className="boot">
        <Leaf />
        <h2>Đang mở không gian của bạn…</h2>
        {error && <p role="alert">{error}</p>}
      </div>
    )
  const chatContext =
    workRoute && workItem
      ? { kind: workRoute[1], id: workItem.id, title: workItem.title, course_id: workCourse }
      : courseId && courseId !== 'unassigned'
        ? {
            kind: 'courses',
            id: courseId,
            title: data.courses.find((c: Item) => c.id === courseId)?.title || 'Môn học',
          }
        : null
  const openSources = (files: File[] = []) => setIntake({ context: chatContext, files })
  const analyzeSources = (text: string, context: Item | null, documentIds: string[]) => {
    setChatOpen(true)
    setChatRequest({ id: crypto.randomUUID(), text, context, documentIds })
  }
  const taskName = (id: string) => data.tasks.find((t: Item) => t.id === id)?.title || 'Công việc'
  const drafts = data.proposals.filter((p: Item) => p.status === 'draft')
  const lastRevision = data.revisions.at(-1),
    undoable = lastRevision && !lastRevision.undone && lastRevision.revision === data.revision
  const showExcerpt = async (id: string) => {
    try {
      setExcerpt(await api('/knowledge/excerpts/' + encodeURIComponent(id)))
    } catch (e: any) {
      setError(e.message)
    }
  }
  async function stopTimer() {
    if (!timer) return
    const minutes = Math.max(1, Math.round((Date.now() - timer.started) / 60000))
    const r = await action(
      () => api('/sessions', 'POST', { task_id: timer.task_id, minutes, note: 'Phiên tập trung' }),
      `Đã ghi ${minutes} phút tập trung`,
    )
    if (r) setTimer(null)
  }
  const startTimer = (id: string) => {
    if (timer) {
      setError('Hãy kết thúc phiên tập trung hiện tại trước')
      return
    }
    setTimer({ task_id: id, started: Date.now() })
    setEditor(null)
  }
  const tools = (
    <div className="space-utilities" role="toolbar" aria-label="Tiện ích không gian">
      <button
        className={workView ? 'active' : ''}
        aria-label={workView ? 'Xem các môn học' : 'Xem tất cả công việc'}
        title={workView ? 'Xem các môn học' : 'Deadline và công việc của mọi môn'}
        aria-pressed={workView}
        onClick={() => {
          setPanel(null)
          setTab(workView ? 'space' : 'space/work')
        }}
      >
        <ListTodo size={18} />
        <span>Việc cần làm</span>
      </button>
      <button
        className={panel === 'resources' ? 'active' : ''}
        aria-label="Tài liệu trong không gian"
        title="Tài liệu, ghi chú và đồ án"
        aria-expanded={panel === 'resources'}
        onClick={() => openPanel('resources')}
      >
        <FileText size={18} />
        <span>Tài liệu</span>
      </button>
      <button
        className={panel === 'changes' ? 'active' : ''}
        aria-label="Thay đổi trong không gian"
        title="Duyệt và hoàn tác thay đổi"
        aria-expanded={panel === 'changes'}
        onClick={() => openPanel('changes')}
      >
        <History size={18} />
        <span>Thay đổi</span>
        {drafts.length > 0 && <i className="space-change-count">{drafts.length}</i>}
      </button>
      <span className="space-tool-divider" />
      {undoable && (
        <button
          className="icon-btn"
          aria-label="Hoàn tác thay đổi gần nhất"
          title="Hoàn tác thay đổi gần nhất"
          disabled={busy}
          onClick={() =>
            action(() => api('/revisions/' + lastRevision.id + '/undo', 'POST'), 'Đã hoàn tác')
          }
        >
          <Undo2 size={17} />
        </button>
      )}
      <ThemeToggle
        dark={theme.dark}
        onToggle={() => theme.setMode(theme.dark ? 'light' : 'dark')}
      />
      <button
        className={'icon-btn ' + (panel === 'connections' ? 'active' : '')}
        aria-label="Tài khoản và kết nối"
        title="Tài khoản & kết nối"
        aria-expanded={panel === 'connections'}
        onClick={() => openPanel('connections')}
      >
        <UserRound size={18} />
      </button>
      <button
        className={'icon-btn ' + (panel === 'options' ? 'active' : '')}
        aria-label="Tùy chọn không gian"
        title="Tùy chọn không gian"
        aria-expanded={panel === 'options'}
        onClick={() => openPanel('options')}
      >
        <Settings size={18} />
      </button>
    </div>
  )
  const panelProps = {
    actions: (
      <>
        {undoable && (
          <button
            className="icon-btn"
            aria-label="Hoàn tác thay đổi gần nhất"
            title="Hoàn tác thay đổi gần nhất"
            disabled={busy}
            onClick={() =>
              action(() => api('/revisions/' + lastRevision.id + '/undo', 'POST'), 'Đã hoàn tác')
            }
          >
            <Undo2 size={17} />
          </button>
        )}
        <ThemeToggle
          dark={theme.dark}
          onToggle={() => theme.setMode(theme.dark ? 'light' : 'dark')}
        />
      </>
    ),
    inactive: !!editor || !!intake || !!excerpt || welcome,
  }
  return (
    <>
      <div
        className={'app-shell space-app is-space ' + (chatOpen ? 'chat-open' : '')}
        inert={welcome}
        aria-hidden={welcome || undefined}
      >
        <aside className="space-rail">
          <a
            className="space-brand"
            href="#space"
            onClick={() => openCourse(null)}
            aria-label="HBA Studio · Không gian"
            title="HBA Studio"
          >
            <img src="/hba-icon.svg" alt="HBA" width="42" height="42" />
            <span>Studio</span>
          </a>
          <nav aria-label="Điều hướng chính">
            <button
              className={'space-rail-link ' + (tab !== 'calendar' ? 'active' : '')}
              aria-label="Không gian"
              aria-current={tab !== 'calendar' ? 'page' : undefined}
              onClick={() => openCourse(null)}
            >
              <MapIcon size={23} />
              <span>Không gian</span>
            </button>
            <button
              className={'space-rail-link ' + (tab === 'calendar' ? 'active' : '')}
              aria-label="Lịch của tôi"
              aria-current={tab === 'calendar' ? 'page' : undefined}
              onClick={() => {
                setPanel(null)
                setTab('calendar')
              }}
            >
              <CalendarDays size={23} />
              <span>Lịch</span>
            </button>
          </nav>
          <div className="space-rail-bottom">
            <button
              className={'space-rail-link chat-toggle ' + (chatOpen ? 'active' : '')}
              aria-label="Chat với Codex"
              aria-expanded={chatOpen}
              aria-controls="codex-chat"
              onClick={() => setChatOpen((v) => !v)}
            >
              <MessageSquare size={23} />
              <span>Codex</span>
            </button>
          </div>
        </aside>
        <main>
          <div className="page-content space-content">
            {error && (
              <div className="alert error" role="alert">
                <AlertCircle size={18} />
                <span>{error}</span>
                <button aria-label="Đóng lỗi" onClick={() => setError('')}>
                  <X size={16} />
                </button>
              </div>
            )}
            {notice && (
              <div className="alert success" role="status">
                <Check size={18} />
                <span>{notice}</span>
                {lastUndo && (
                  <button
                    onClick={() =>
                      action(
                        () => api('/revisions/' + lastUndo + '/undo', 'POST'),
                        'Đã hoàn tác',
                      ).then((r) => {
                        if (r) setLastUndo('')
                      })
                    }
                  >
                    <Undo2 size={15} />
                    Hoàn tác
                  </button>
                )}
                <button aria-label="Đóng thông báo" onClick={() => setNotice('')}>
                  <X size={16} />
                </button>
              </div>
            )}
            <CanvasSpace
              key={canvasRoute}
              data={data}
              courseId={courseId}
              workView={workView}
              inactive={
                !!panel || !!workRoute || tab === 'calendar' || !!editor || !!intake || !!excerpt
              }
              tools={tools}
              priorities={priorityItems}
              onCourse={openCourse}
              onOpen={openWork}
              onEdit={edit}
              onUpload={openSources}
              onChat={() => setChatOpen(true)}
            />
            {tab === 'calendar' && !panel && (
              <SpacePanel {...panelProps} title="Lịch" wide close={() => openCourse(null)}>
                <CalendarView data={data} edit={edit} open={openWork} action={action} />
              </SpacePanel>
            )}
            {workRoute && !panel && (
              <SpacePanel
                {...panelProps}
                title="Chi tiết trong Không gian"
                headerless
                wide
                close={backToCanvas}
              >
                <WorkWorkspace
                  attachedCards={attachedCards}
                  onAttachCard={attachCard}
                  onCardDrag={dragCard}
                  headerActions={panelProps.actions}
                  key={tab}
                  kind={workRoute[1]}
                  id={decodeURIComponent(workRoute[2] || '')}
                  revision={data.revision}
                  open={openWork}
                  edit={edit}
                  action={action}
                  backLabel={
                    workView
                      ? 'Việc cần làm'
                      : workCourse
                        ? data.courses.find((c: Item) => c.id === workCourse)?.title
                        : 'Các môn học'
                  }
                  back={backToCanvas}
                  record={(id) => edit('sessions', { task_id: id, minutes: 30 })}
                  focus={startTimer}
                />
              </SpacePanel>
            )}
            {panel === 'resources' && (
              <SpacePanel {...panelProps} title="Tài liệu" close={() => setPanel(null)}>
                <SpaceResources
                  data={data}
                  courseId={courseId}
                  action={action}
                  edit={edit}
                  open={openWork}
                  onAdd={() => openSources()}
                  onExcerpt={showExcerpt}
                />
              </SpacePanel>
            )}
            {panel === 'changes' && (
              <SpacePanel {...panelProps} title="Thay đổi" close={() => setPanel(null)}>
                <SpaceChanges
                  data={data}
                  selectedId={selectedProposalId}
                  select={setSelectedProposalId}
                  action={action}
                  busy={busy}
                  editDraft={(p: Item, op: Item, index: number) =>
                    setEditor({
                      ...data[op.kind]?.find((x: Item) => x.id === op.id),
                      ...op.data,
                      id: op.id,
                      kind: op.kind,
                      draft: true,
                      op_index: index,
                      proposal_id: p.id,
                    })
                  }
                />
              </SpacePanel>
            )}
            {panel === 'connections' && (
              <SpacePanel {...panelProps} title="Tài khoản & kết nối" close={() => setPanel(null)}>
                <ConnectionsPage
                  onChanged={load}
                  onContinue={finishWelcome}
                  onGoogleSettings={() => {
                    sessionStorage.setItem('pdm-open-google-settings', '1')
                    setPanel('options')
                  }}
                />
              </SpacePanel>
            )}
            {panel === 'options' && (
              <SpacePanel {...panelProps} title="Tùy chọn không gian" close={() => setPanel(null)}>
                <SettingsPage
                  data={data}
                  action={action}
                  theme={theme}
                  embedded
                  onConnectionsChanged={load}
                />
                <div className="space-options-footer">
                  <a className="text-btn" href="/huong-dan-su-dung.md" download>
                    <BookOpen size={16} />
                    Hướng dẫn sử dụng
                  </a>
                </div>
              </SpacePanel>
            )}
          </div>
        </main>
        {timer && (
          <div className="focus-bar">
            <span className="pulse" />
            <div>
              <b>Đang tập trung</b>
              <small>
                {taskName(timer.task_id)} · bắt đầu {clock(new Date(timer.started).toISOString())}
              </small>
            </div>
            <Button onClick={stopTimer}>
              <Square size={13} />
              Kết thúc & ghi giờ
            </Button>
          </div>
        )}
        <CodexChat
          onConnect={() => {
            setChatOpen(false)
            openPanel('connections')
          }}
          cards={attachedCards}
          onCardsChange={setAttachedCards}
          cardDrag={cardDrag}
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          context={chatContext}
          onChanged={load}
          onAddSource={openSources}
          request={chatRequest}
          onProposal={async (id) => {
            const next = await api('/workspace')
            setData(next)
            if (!next.proposals.some((p: Item) => p.id === id))
              throw new Error('Đề xuất không còn tồn tại')
            setSelectedProposalId(id)
            if (tab === 'calendar') setTab('space')
            setPanel('changes')
          }}
          onSource={showExcerpt}
        />
        {cardDrag && (
          <div ref={cardGhost} className="card-tag-ghost" aria-hidden="true">
            @ {cardDrag.tag.title}
          </div>
        )}
        {intake && (
          <SourceIntake
            context={intake.context}
            initialFiles={intake.files}
            courses={data.courses}
            close={closeIntake}
            onChanged={load}
            onAnalyze={analyzeSources}
          />
        )}
        {editor && (
          <EntityEditor
            key={editor.kind + ':' + (editor.id || 'new')}
            editor={editor}
            error={error}
            saveDraft={async (payload: Item) => {
              const p = data.proposals.find((p: Item) => p.id === editor.proposal_id)
              if (!p) return null
              const ops = p.operations.map((o: Item, i: number) =>
                i === editor.op_index ? { ...o, data: payload } : o,
              )
              return action(
                () => api('/proposals/' + p.id, 'PATCH', { operations: ops }),
                'Đã chỉnh bản nháp',
              )
            }}
            data={data}
            close={() => setEditor(null)}
            busy={busy}
            action={action}
            recordWork={(id: string) => edit('sessions', { task_id: id, minutes: 30 })}
            startTimer={startTimer}
          />
        )}
        {excerpt && (
          <div className="modal-backdrop" onClick={() => setExcerpt(null)}>
            <section
              className="modal excerpt-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Đoạn nguồn"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-heading">
                <div>
                  <h2>{excerpt.title}</h2>
                  <p>{excerpt.location}</p>
                </div>
                <button
                  className="icon-btn"
                  aria-label="Đóng đoạn nguồn"
                  onClick={() => setExcerpt(null)}
                >
                  <X />
                </button>
              </div>
              <pre>{excerpt.text}</pre>
              <small className="muted">
                {excerpt.path}
                <br />
                Phiên bản: {excerpt.hash?.slice(0, 16)} · {dateText(excerpt.indexed_at, true)}
              </small>
            </section>
          </div>
        )}
      </div>
      {welcome && (
        <section
          className="connection-welcome"
          role="dialog"
          aria-modal="true"
          aria-label="Chào mừng đến HBA Studio"
          onKeyDown={(event) => {
            if (event.key !== 'Tab') return
            const items = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(
                'button:not(:disabled),a[href],summary,input:not(:disabled)',
              ),
            ).filter((item) => item.getClientRects().length)
            const first = items[0],
              last = items.at(-1)
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault()
              last?.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault()
              first?.focus()
            }
          }}
        >
          <header className="connection-welcome-brand">
            <div>
              <img src="/hba-icon.svg" alt="" />
              HBA Studio
            </div>
            <div>
              <ThemeToggle
                dark={theme.dark}
                onToggle={() => theme.setMode(theme.dark ? 'light' : 'dark')}
              />
              <button className="text-btn" onClick={finishWelcome}>
                Để sau
              </button>
            </div>
          </header>
          <ConnectionsPage welcome onChanged={load} onContinue={finishWelcome} />
        </section>
      )}
    </>
  )
}
