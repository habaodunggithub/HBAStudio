import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  FileText,
  Flag,
  GripVertical,
  LoaderCircle,
  Map as MapIcon,
  Maximize,
  MessageSquare,
  Minus,
  MoreHorizontal,
  Plus,
  Search,
  Upload,
  X,
} from 'lucide-react'
import { api } from './api'
import { CardResize, type CardSize } from './CardResize'
import { useCanvasBoard } from './board/useWorkBoard'
import { ArrangeControl } from './board/ArrangeControl'
import { fitArrangement, type Arrangement } from './board/arrangement'
import { edgeEndpoints } from './board/geometry'

type Item = Record<string, any>
type Point = { x: number; y: number }
type Camera = Point & { zoom: number }
type Node = {
  key: string
  kind: string
  item: Item
  title: string
  count?: number
  undated?: number
  next?: Item
  done?: boolean
  reason?: string
}
type Props = {
  data: Item
  courseId: string | null
  workView?: boolean
  inactive?: boolean
  tools?: React.ReactNode
  priorities: Item[]
  onCourse: (id: string | null) => void
  onOpen: (kind: string, id: string) => void
  onEdit: (kind: string, item?: Item) => void
  onUpload: (files?: File[]) => void
  onChat: (text?: string) => void
}
const PALETTE = ['#a5bde6', '#a6c49b', '#ebc5a5', '#cab7e4', '#a6c8c9', '#d7b7bf']
const BASE: Point[] = [
  { x: 140, y: 130 },
  { x: 650, y: 125 },
  { x: 215, y: 450 },
  { x: 735, y: 480 },
]
const initialPosition = (index: number): Point => ({
  x: BASE[index % 4].x,
  y: BASE[index % 4].y + Math.floor(index / 4) * 650,
})
const clamp = (value: number) => Math.max(0.25, Math.min(2, value))
const date = (value: string) =>
  new Date(value).toLocaleDateString('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
  })
const active = (kind: string, item: Item) =>
  kind === 'deadlines' ? !item.done : !['done', 'cancelled'].includes(item.status)

export function courseFor(data: Item, item: Item, kind = 'tasks'): string | null {
  let current = item
  const seen = new Set<string>()
  while (current) {
    if (current.course_id) return current.course_id
    const project = data.projects.find((p: Item) => p.id === current.project_id)
    if (project?.course_id) return project.course_id
    if (kind === 'documents' && current.work_id) {
      const linked = data[current.work_kind]?.find((work: Item) => work.id === current.work_id)
      if (linked) return courseFor(data, linked, current.work_kind)
    }
    const deadline = data.deadlines.find((d: Item) => d.id === current.deadline_id)
    if (deadline) {
      const course = courseFor(data, deadline, 'deadlines')
      if (course) return course
    }
    if (kind !== 'tasks' || !current.parent_id || seen.has(current.id)) break
    seen.add(current.id)
    current = data.tasks.find((t: Item) => t.id === current.parent_id)
  }
  return null
}

function works(data: Item): Node[] {
  return [
    ...data.deadlines.map((item: Item) => ({
      key: 'deadlines:' + item.id,
      kind: 'deadlines',
      item,
      title: item.title,
      done: !active('deadlines', item),
    })),
    ...data.tasks
      .filter((item: Item) => !item.parent_id && !item.deadline_id)
      .map((item: Item) => ({
        key: 'tasks:' + item.id,
        kind: 'tasks',
        item,
        title: item.title,
        done: !active('tasks', item),
      })),
  ]
}

export function CanvasSpace({
  data,
  courseId,
  workView = false,
  inactive = false,
  tools,
  priorities,
  onCourse,
  onOpen,
  onEdit,
  onUpload,
  onChat,
}: Props) {
  const boardId = workView
    ? 'work'
    : courseId === null
      ? 'home'
      : courseId === 'unassigned'
        ? 'unassigned'
        : 'course:' + courseId
  const course = data.courses.find((c: Item) => c.id === courseId)
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null)
  const [query, setQuery] = useState(''),
    [searching, setSearching] = useState(false),
    [showDone, setShowDone] = useState(false)
  const board = useCanvasBoard(boardId),
    { layout, loaded, change: persist, flush } = board
  const [, redraw] = useState(0),
    [resizing, setResizing] = useState<Record<string, CardSize>>({})
  const [measured, setMeasured] = useState<Record<string, CardSize>>({})
  const [preview, setPreview] = useState<Arrangement | null>(null),
    previewCamera = useRef<Camera | null>(null)
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 }),
    [size, setSize] = useState({ width: 0, height: 0 })
  const saveState = board.status === 'Đã lưu' ? 'Đã lưu vị trí' : board.status,
    error = board.failed ? board.status : ''
  const [dragOver, setDragOver] = useState(false),
    [moving, setMoving] = useState(false)
  const viewport = useRef<HTMLDivElement>(null),
    dots = useRef<HTMLCanvasElement>(null)
  const cameraRef = useRef(camera),
    positions = useRef<Record<string, Point>>({}),
    gesture = useRef<any>(null),
    pointers = useRef(new Map<number, Point>())
  const fitted = useRef(false)
  const previousWidth = useRef(0)
  const dragDepth = useRef(0)
  const allWorks = useMemo(() => works(data), [data])
  const allNodes = useMemo<Node[]>(() => {
    if (workView || courseId !== null)
      return allWorks
        .filter(
          (node) =>
            workView ||
            (courseId === 'unassigned'
              ? !courseFor(data, node.item, node.kind)
              : courseFor(data, node.item, node.kind) === courseId),
        )
        .map((node) => ({
          ...node,
          reason: priorities.find((p) => p.kind === node.kind && p.id === node.item.id)?.reason,
        }))
    const list = data.courses.map((item: Item) => {
      const pending = allWorks.filter(
        (node) => courseFor(data, node.item, node.kind) === item.id && !node.done,
      )
      const next = pending
        .filter((node) => node.item.due_at)
        .sort((a, b) => a.item.due_at.localeCompare(b.item.due_at))[0]?.item
      return {
        key: 'courses:' + item.id,
        kind: 'courses',
        item,
        title: item.title,
        count: pending.length,
        undated: pending.filter((node) => !node.item.due_at).length,
        next,
      }
    })
    const unassigned = allWorks.filter(
      (node) => !courseFor(data, node.item, node.kind) && !node.done,
    )
    if (unassigned.length)
      list.push({
        key: 'courses:unassigned',
        kind: 'courses',
        item: { id: 'unassigned' },
        title: 'Chưa gắn môn học',
        count: unassigned.length,
        undated: unassigned.filter((node) => !node.item.due_at).length,
        next: undefined,
      })
    return list
  }, [courseId, workView, data, allWorks, priorities])
  const nodes = allNodes.filter(
    (node) =>
      (showDone || !node.done) &&
      node.title.toLocaleLowerCase('vi').includes(query.toLocaleLowerCase('vi')),
  )
  const baseAt = (key: string) =>
    positions.current[key] ||
    layout.nodes[key] ||
    initialPosition(allNodes.findIndex((node) => node.key === key))
  const at = (key: string) => preview?.nodes[key] || baseAt(key)
  const dimensions = (node: Node) =>
    resizing[node.key] ||
    layout.sizes[node.key] ||
    measured[node.key] || { width: 320, height: node.kind === 'courses' ? 180 : 215 }
  const moveCamera = useCallback((value: Camera) => {
    cameraRef.current = value
    setCamera(value)
  }, [])
  useEffect(() => {
    positions.current = {}
    setResizing({})
    setPreview(null)
    previewCamera.current = null
    fitted.current = false
    previousWidth.current = 0
  }, [boardId])
  useEffect(() => {
    if (loaded && layout.camera && !fitted.current) {
      moveCamera(layout.camera)
      fitted.current = true
    }
  }, [loaded, layout.camera, moveCamera])
  const arrangeCards = nodes.map((node) => ({
    key: node.key,
    title: node.title,
    ...baseAt(node.key),
    ...dimensions(node),
    content: { item: node.item, revision: data.revision },
  }))
  useEffect(() => {
    const observer = new ResizeObserver((entries) =>
      setMeasured((old) => {
        const next = { ...old }
        let changed = false
        for (const entry of entries) {
          const el = entry.target as HTMLElement,
            key = el.dataset.canvasNode!
          const value = { width: el.offsetWidth, height: el.offsetHeight }
          if (old[key]?.width !== value.width || old[key]?.height !== value.height) {
            next[key] = value
            changed = true
          }
        }
        return changed ? next : old
      }),
    )
    viewport.current?.querySelectorAll('[data-canvas-node]').forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [loaded, nodes.map((node) => node.key).join('|')])
  function previewArrangement(next: Arrangement | null) {
    setPreview(next)
    if (next) {
      previewCamera.current ||= { ...cameraRef.current }
      moveCamera(fitArrangement(arrangeCards, next.nodes, size.width, size.height, 145))
    } else if (previewCamera.current) {
      moveCamera(previewCamera.current)
      previewCamera.current = null
    }
  }
  async function commitArrangement(next: Arrangement) {
    previewCamera.current = null
    setPreview(null)
    positions.current = {}
    const camera = fitArrangement(arrangeCards, next.nodes, size.width, size.height, 145)
    moveCamera(camera)
    persist({ nodes: next.nodes, edges: next.edges, camera })
    return flush()
  }
  useEffect(() => {
    const el = viewport.current
    if (!el) return
    const observer = new ResizeObserver(() =>
      setSize({ width: el.clientWidth, height: el.clientHeight }),
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  function fit() {
    if (!nodes.length || !size.width) return
    const points = nodes.map((node) => at(node.key)),
      left = Math.min(...points.map((p) => p.x)),
      right = Math.max(...nodes.map((node) => at(node.key).x + dimensions(node).width))
    const top = Math.min(...points.map((p) => p.y)),
      bottom = Math.max(...nodes.map((node) => at(node.key).y + dimensions(node).height))
    const zoom = clamp(
      Math.min(1, (size.width - 100) / (right - left), (size.height - 180) / (bottom - top)),
    )
    const next = {
      x: (size.width - (left + right) * zoom) / 2,
      y: 75 + (size.height - 150 - (top + bottom) * zoom) / 2,
      zoom,
    }
    moveCamera(next)
    persist({ camera: next })
  }
  useEffect(() => {
    if (loaded && size.width && nodes.length && !fitted.current) {
      fitted.current = true
      if (size.width < 600) {
        const point = at(nodes[0].key),
          zoom = Math.min(1, (size.width - 48) / dimensions(nodes[0]).width)
        const next = { zoom: clamp(zoom), x: 24 - point.x * zoom, y: 155 - point.y * zoom }
        moveCamera(next)
        persist({ camera: next })
      } else fit()
    }
  }, [loaded, size.width, nodes.length])
  useEffect(() => {
    if (!loaded || !size.width || !nodes.length) return
    if (previousWidth.current === size.width) return
    previousWidth.current = size.width
    if (size.width >= 600) return
    const current = cameraRef.current
    const visible = nodes.some((node) => {
      const point = at(node.key),
        s = dimensions(node),
        x = point.x * current.zoom + current.x,
        y = point.y * current.zoom + current.y
      return (
        x >= 16 &&
        x + s.width * current.zoom <= size.width - 16 &&
        y + s.height * current.zoom > 150 &&
        y < size.height - 140
      )
    })
    if (!visible) {
      const point = at(nodes[0].key),
        zoom = clamp(Math.min(1, (size.width - 48) / dimensions(nodes[0]).width)),
        next = { zoom, x: 24 - point.x * zoom, y: 155 - point.y * zoom }
      moveCamera(next)
      persist({ camera: next })
    }
  }, [loaded, size.width, size.height, nodes.length])
  useEffect(() => {
    const draw = () => {
      const canvas = dots.current
      if (!canvas || !size.width) return
      const ratio = Math.min(devicePixelRatio || 1, 2)
      canvas.width = size.width * ratio
      canvas.height = size.height * ratio
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.scale(ratio, ratio)
      ctx.clearRect(0, 0, size.width, size.height)
      const style = getComputedStyle(document.documentElement)
      ctx.fillStyle = style.getPropertyValue('--canvas-dot').trim() || '#dce1e2'
      const step = 14 * camera.zoom,
        radius = Math.max(0.55, 0.7 * camera.zoom)
      for (let x = ((camera.x % step) + step) % step; x < size.width; x += step)
        for (let y = ((camera.y % step) + step) % step; y < size.height; y += step) {
          ctx.beginPath()
          ctx.arc(x, y, radius, 0, Math.PI * 2)
          ctx.fill()
        }
    }
    draw()
    const observer = new MutationObserver(draw)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    return () => observer.disconnect()
  }, [size, camera])
  const zoomAt = (zoom: number, point: Point) => {
    const old = cameraRef.current,
      next = { zoom: clamp(zoom), x: 0, y: 0 }
    const ratio = next.zoom / old.zoom
    next.x = point.x - (point.x - old.x) * ratio
    next.y = point.y - (point.y - old.y) * ratio
    moveCamera(next)
    persist({ camera: next })
  }
  useEffect(() => {
    const el = viewport.current
    if (!el) return
    const wheel = (event: WheelEvent) => {
      if ((event.target as HTMLElement).closest('[data-canvas-ui]')) return
      event.preventDefault()
      const box = el.getBoundingClientRect()
      zoomAt(cameraRef.current.zoom * Math.exp(-event.deltaY * 0.002), {
        x: event.clientX - box.left,
        y: event.clientY - box.top,
      })
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [persist])
  function setPosition(key: string, position: Point) {
    positions.current = { ...positions.current, [key]: position }
    redraw((value) => value + 1)
  }
  function pointerDown(event: React.PointerEvent) {
    if (
      event.button !== 0 ||
      (event.target as HTMLElement).closest('[data-canvas-ui],[data-node-action]') ||
      !loaded
    )
      return
    const point = { x: event.clientX, y: event.clientY }
    pointers.current.set(event.pointerId, point)
    event.currentTarget.setPointerCapture(event.pointerId)
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()],
        box = viewport.current!.getBoundingClientRect()
      gesture.current = {
        type: 'pinch',
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        center: { x: (a.x + b.x) / 2 - box.left, y: (a.y + b.y) / 2 - box.top },
        camera: { ...cameraRef.current },
      }
      setMoving(true)
      return
    }
    const element = (event.target as HTMLElement).closest<HTMLElement>('[data-canvas-node]'),
      key = element?.dataset.canvasNode
    gesture.current = {
      type: key ? 'node' : 'pan',
      key,
      start: point,
      camera: { ...cameraRef.current },
      position: key ? { ...at(key) } : null,
      moved: false,
      grip: !!(event.target as HTMLElement).closest('.space-grip'),
    }
    if (key) element?.querySelector<HTMLElement>('.space-node-open')?.focus({ preventScroll: true })
  }
  function pointerMove(event: React.PointerEvent) {
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const g = gesture.current
    if (!g) return
    if (g.type === 'pinch' && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()],
        box = viewport.current!.getBoundingClientRect(),
        zoom = clamp((g.camera.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / Math.max(1, g.distance)),
        ratio = zoom / g.camera.zoom
      moveCamera({
        zoom,
        x: (a.x + b.x) / 2 - box.left - (g.center.x - g.camera.x) * ratio,
        y: (a.y + b.y) / 2 - box.top - (g.center.y - g.camera.y) * ratio,
      })
      return
    }
    const dx = event.clientX - g.start.x,
      dy = event.clientY - g.start.y
    if (Math.hypot(dx, dy) > 4) {
      g.moved = true
      setMoving(true)
    }
    if (!g.moved) return
    if (g.type === 'node')
      setPosition(g.key, {
        x: g.position.x + dx / cameraRef.current.zoom,
        y: g.position.y + dy / cameraRef.current.zoom,
      })
    else moveCamera({ ...g.camera, x: g.camera.x + dx, y: g.camera.y + dy })
  }
  function pointerEnd(event: React.PointerEvent, cancelled = false) {
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.delete(event.pointerId)
    const g = gesture.current
    if (g?.type === 'node') {
      if (g.moved) {
        persist({ nodes: { [g.key]: positions.current[g.key] } })
        delete positions.current[g.key]
      } else if (!cancelled && !g.grip) {
        const node = allNodes.find((n) => n.key === g.key)
        if (node) open(node)
      }
    } else if (g) persist({ camera: cameraRef.current })
    if (pointers.current.size === 1) {
      gesture.current = {
        type: 'pan',
        start: [...pointers.current.values()][0],
        camera: { ...cameraRef.current },
        moved: false,
      }
      return
    }
    gesture.current = null
    setMoving(false)
  }
  function open(node: Node) {
    if (node.kind === 'courses') onCourse(node.item.id)
    else onOpen(node.kind, node.item.id)
  }
  function keyMove(event: React.KeyboardEvent, node: Node) {
    const direction: Record<string, Point> = {
      ArrowLeft: { x: -20, y: 0 },
      ArrowRight: { x: 20, y: 0 },
      ArrowUp: { x: 0, y: -20 },
      ArrowDown: { x: 0, y: 20 },
    }
    const delta = direction[event.key]
    if (!delta) return
    event.preventDefault()
    event.stopPropagation()
    const old = at(node.key),
      next = { x: old.x + delta.x, y: old.y + delta.y }
    persist({ nodes: { [node.key]: next } })
  }
  const title = workView
    ? 'Việc cần làm'
    : courseId === null
      ? 'Các môn học'
      : courseId === 'unassigned'
        ? 'Chưa gắn môn học'
        : course?.title || 'Không tìm thấy môn học'
  const home = courseId === null && !workView,
    base = courseId && courseId !== 'unassigned' ? { course_id: courseId } : {}
  return (
    <section
      inert={inactive}
      aria-hidden={inactive || undefined}
      className={
        'space-viewport ' + (moving ? 'is-moving ' : '') + (dragOver ? 'is-drag-over' : '')
      }
      ref={viewport}
      aria-label={
        home
          ? 'Không gian các môn học'
          : workView
            ? 'Không gian công việc'
            : 'Không gian môn ' + title
      }
      tabIndex={0}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={(e) => pointerEnd(e)}
      onPointerCancel={(e) => pointerEnd(e, true)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Home') {
          e.preventDefault()
          fit()
        }
        if (e.key === '+' || e.key === '=') {
          e.preventDefault()
          zoomAt(camera.zoom * 1.15, { x: size.width / 2, y: size.height / 2 })
        }
        if (e.key === '-') {
          e.preventDefault()
          zoomAt(camera.zoom / 1.15, { x: size.width / 2, y: size.height / 2 })
        }
      }}
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          dragDepth.current++
          setDragOver(true)
        }
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault()
      }}
      onDragLeave={() => {
        if (--dragDepth.current <= 0) {
          dragDepth.current = 0
          setDragOver(false)
        }
      }}
      onDrop={(e) => {
        e.preventDefault()
        dragDepth.current = 0
        setDragOver(false)
        if (e.dataTransfer.files.length) onUpload(Array.from(e.dataTransfer.files))
      }}
    >
      <canvas className="space-dots" ref={dots} aria-hidden="true" />
      <div className="space-top" data-canvas-ui>
        <div className="space-breadcrumb">
          <MapIcon size={19} />
          {!home && (
            <>
              <button
                aria-label="Về các môn học"
                title="Về các môn học"
                onClick={() => onCourse(null)}
              >
                Các môn học
              </button>
              <ChevronRight size={14} />
            </>
          )}
          <h1>{title}</h1>
          <span className="space-count">
            {home ? `${data.courses.length} môn` : `${nodes.length} thẻ`}
          </span>
          <button
            className="space-search-toggle icon-btn"
            aria-label="Tìm trong không gian"
            aria-expanded={searching}
            onClick={() => setSearching(!searching)}
          >
            <Search size={18} />
          </button>
        </div>
        <div className="space-actions">
          <ArrangeControl
            key={boardId}
            boardId={boardId}
            cards={arrangeCards}
            edges={layout.edges}
            ready={loaded}
            flush={flush}
            onPreview={previewArrangement}
            onCommit={commitArrangement}
          />
          <button className="btn" onClick={() => onUpload()}>
            <Plus size={17} />
            <span>Thêm tài liệu</span>
          </button>
          <button
            className="btn subtle"
            onClick={() => onEdit(home ? 'courses' : workView ? 'tasks' : 'deadlines', base)}
          >
            <Plus size={17} />
            <span>{home ? 'Thêm môn' : workView ? 'Thêm công việc' : 'Thêm deadline'}</span>
          </button>
        </div>
      </div>
      {searching && (
        <div className="space-search" data-canvas-ui>
          <Search size={17} />
          <input
            autoFocus
            aria-label="Tìm môn học hoặc deadline"
            placeholder="Tìm trong không gian…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            className="icon-btn"
            aria-label="Đóng tìm kiếm"
            onClick={() => {
              setQuery('')
              setSearching(false)
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {!home && (
        <div className="space-course-tools" data-canvas-ui>
          <button
            className="text-btn"
            onClick={() => onEdit(workView ? 'deadlines' : 'tasks', base)}
          >
            <Plus size={14} />
            {workView ? 'Thêm deadline' : 'Thêm công việc'}
          </button>
          <button className="text-btn" onClick={() => setShowDone(!showDone)}>
            {showDone ? 'Ẩn đã hoàn thành' : 'Hiện đã hoàn thành'}
          </button>
          {course && (
            <button
              className="icon-btn"
              aria-label={'Sửa môn ' + title}
              onClick={() => onEdit('courses', course)}
            >
              <MoreHorizontal size={18} />
            </button>
          )}
        </div>
      )}
      {loaded ? (
        <div
          className="space-world"
          style={{ transform: `translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})` }}
        >
          <svg className="space-arrangement-edges" aria-label="Trình tự các thẻ">
            <defs>
              <marker
                id="space-arrange-arrow"
                markerWidth="10"
                markerHeight="10"
                refX="9"
                refY="5"
                orient="auto-start-reverse"
              >
                <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
              </marker>
            </defs>
            {Object.entries({ ...layout.edges, ...preview?.edges }).map(([id, edge]) => {
              if (!edge) return null
              const a = nodes.find((n) => n.key === edge.source),
                b = nodes.find((n) => n.key === edge.target)
              if (!a || !b) return null
              const points = edgeEndpoints(at(a.key), dimensions(a), at(b.key), dimensions(b))
              return (
                <g key={id} className={selectedEdge === id ? 'is-selected' : ''}>
                  <line
                    {...points}
                    markerEnd={edge.arrow ? 'url(#space-arrange-arrow)' : undefined}
                  />
                  <line
                    {...points}
                    className="space-edge-hit"
                    role="button"
                    tabIndex={0}
                    data-node-action
                    aria-label={'Chọn đường nối ' + a.title + ' đến ' + b.title}
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
            })}
          </svg>
          {nodes.map((node) => {
            const point = at(node.key),
              index = allNodes.findIndex((n) => n.key === node.key),
              isCourse = node.kind === 'courses',
              due = node.item.due_at,
              overdue = due && new Date(due).getTime() < Date.now() && !node.done
            return (
              <article
                key={node.key}
                className={
                  'space-node ' +
                  (isCourse ? 'is-course' : 'is-deadline') +
                  (node.done ? ' is-done' : '')
                }
                data-resizable-card
                data-resized={!!layout.sizes[node.key]}
                data-canvas-node={node.key}
                style={
                  {
                    left: point.x,
                    top: point.y,
                    ...(resizing[node.key] || layout.sizes[node.key]),
                    '--course-color':
                      PALETTE[
                        (courseId === null
                          ? index
                          : Math.max(
                              0,
                              data.courses.findIndex((c: Item) => c.id === courseId),
                            )) % PALETTE.length
                      ],
                  } as React.CSSProperties
                }
              >
                <button
                  className="space-grip icon-btn"
                  aria-label={'Di chuyển ' + node.title}
                  title="Kéo để di chuyển · Phím mũi tên để sắp xếp"
                  onKeyDown={(e) => keyMove(e, node)}
                >
                  <GripVertical size={17} />
                </button>
                <button
                  className="space-node-open"
                  aria-label={'Mở ' + node.title}
                  onClick={(e) => {
                    if (e.detail === 0) open(node)
                  }}
                >
                  {isCourse ? (
                    <BookOpen size={22} />
                  ) : node.done ? (
                    <Check size={21} />
                  ) : (
                    <Flag size={20} />
                  )}
                  <span>
                    <b>{node.title}</b>
                    {isCourse ? (
                      <>
                        <small>
                          {node.item.id === 'unassigned'
                            ? `${node.count} việc chưa gắn môn`
                            : node.undated === node.count && node.count
                              ? `${node.count} việc chưa có hạn`
                              : `${node.count! - (node.undated || 0)} deadline đang mở`}
                        </small>
                        <small className={node.next ? 'space-next' : undefined}>
                          {node.next ? (
                            <>
                              <span className="space-next-title" title={node.next.title}>
                                Gần nhất: {node.next.title}
                              </span>
                              <time className="space-next-date" dateTime={node.next.due_at}>
                                · {date(node.next.due_at)}
                              </time>
                            </>
                          ) : node.count ? (
                            'Có việc chưa đặt hạn'
                          ) : (
                            'Chưa có deadline đang mở'
                          )}
                        </small>
                      </>
                    ) : (
                      <>
                        <small className={overdue ? 'space-overdue' : ''}>
                          {node.done
                            ? 'Đã hoàn thành'
                            : due
                              ? `Hạn ${date(due)}`
                              : 'Chưa có hạn nộp'}
                        </small>
                        <small className="space-node-reason">
                          {node.reason || node.item.description || 'Mở để xem yêu cầu và tài liệu'}
                        </small>
                      </>
                    )}
                  </span>
                </button>
                <div className="space-node-footer">
                  <button
                    onClick={(e) => {
                      if (e.detail === 0) open(node)
                    }}
                  >
                    {isCourse ? 'Mở không gian' : 'Xem chi tiết'}
                    <ChevronRight size={15} />
                  </button>
                  {node.item.id !== 'unassigned' && (
                    <button
                      data-node-action
                      className="icon-btn"
                      aria-label={'Sửa ' + (isCourse ? 'môn ' : '') + node.title}
                      onClick={() => onEdit(node.kind, node.item)}
                    >
                      <MoreHorizontal size={18} />
                    </button>
                  )}
                </div>
                <CardResize
                  title={node.title}
                  zoom={camera.zoom}
                  onResize={(next) => setResizing((old) => ({ ...old, [node.key]: next }))}
                  onCommit={(next) => {
                    persist({ sizes: { [node.key]: next } })
                    setResizing((old) => {
                      const value = { ...old }
                      delete value[node.key]
                      return value
                    })
                  }}
                />
              </article>
            )
          })}
        </div>
      ) : (
        <div className="space-loading" role="status">
          <LoaderCircle className="spin" size={20} />
          Đang mở không gian…
        </div>
      )}
      {loaded && !nodes.length && (
        <div className="space-empty" data-canvas-ui>
          {query ? (
            <>
              <Search size={26} />
              <h2>Không tìm thấy “{query}”</h2>
              <button className="text-btn" onClick={() => setQuery('')}>
                Xóa tìm kiếm
              </button>
            </>
          ) : (
            <>
              <BookOpen size={28} />
              <h2>
                {home
                  ? 'Không gian học tập của bạn'
                  : workView
                    ? 'Chưa có việc đang mở'
                    : 'Môn học đã có không gian riêng'}
              </h2>
              <p>
                {home
                  ? 'Thêm một môn hoặc gửi tài liệu cho Codex để bắt đầu.'
                  : 'Thả đề bài, tài liệu hoặc dán tin nhắn giảng viên vào chat. Codex sẽ giúp bạn gom các deadline tại đây.'}
              </p>
              <div>
                <button className="btn subtle" onClick={() => onChat()}>
                  <MessageSquare size={16} />
                  Nhờ Codex sắp xếp
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {selectedEdge && layout.edges[selectedEdge] && (
        <div className="space-edge-tools" data-canvas-ui>
          <button
            className="text-btn"
            onClick={() => {
              persist({ edges: { [selectedEdge]: null } })
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
            <X size={15} />
          </button>
        </div>
      )}
      {dragOver && (
        <div className="space-drop-overlay">
          <Upload size={35} />
          <h2>Thả tài liệu vào không gian này</h2>
          <p>
            {courseId === null
              ? 'Codex sẽ giúp nhận diện môn học và deadline.'
              : `Tài liệu sẽ được gắn vào ${title}.`}
          </p>
        </div>
      )}
      <div className="space-bottom" data-canvas-ui>
        <div className="space-bottom-left">
          <div className="space-hints">
            {error ? (
              <span className="space-save-error" role="alert">
                {error}{' '}
                <button
                  onClick={() => {
                    persist({ nodes: positions.current, camera: cameraRef.current })
                    flush()
                  }}
                >
                  Thử lưu lại
                </button>
              </span>
            ) : (
              <span className="space-saved" role="status">
                {saveState}
              </span>
            )}
          </div>
          {tools}
        </div>
        <div className="space-zoom">
          <button
            className="icon-btn"
            aria-label="Vừa không gian"
            title="Xem tất cả thẻ (Home)"
            onClick={fit}
          >
            <Maximize size={18} />
          </button>
          <span />
          <button
            className="icon-btn"
            aria-label="Thu nhỏ không gian"
            disabled={camera.zoom <= 0.25}
            onClick={() => zoomAt(camera.zoom / 1.2, { x: size.width / 2, y: size.height / 2 })}
          >
            <Minus size={17} />
          </button>
          <button
            className="space-zoom-value"
            aria-label="Đặt thu phóng 100%"
            onClick={() => zoomAt(1, { x: size.width / 2, y: size.height / 2 })}
          >
            {Math.round(camera.zoom * 100)}%
          </button>
          <button
            className="icon-btn"
            aria-label="Phóng to không gian"
            disabled={camera.zoom >= 2}
            onClick={() => zoomAt(camera.zoom * 1.2, { x: size.width / 2, y: size.height / 2 })}
          >
            <Plus size={18} />
          </button>
        </div>
      </div>
    </section>
  )
}
