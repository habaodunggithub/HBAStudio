import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { applyLayoutPatch, emptyLayout, type BoardPatch } from './model'
import { BoardSaveQueue } from './saveQueue'

const SAVE_DELAY = 350
const KEEPALIVE_LIMIT = 60000

export function useWorkBoard(kind: string, id: string) {
  return useCanvasBoard('work:' + kind + ':' + id)
}

export function useCanvasBoard(ident: string) {
  const path = `/canvas/${encodeURIComponent(ident)}`
  const queue = useMemo(() => new BoardSaveQueue((patch) => api(path, 'PATCH', patch)), [path])
  const [state, setState] = useState(() => ({
    path,
    layout: emptyLayout(),
    loaded: false,
  }))
  const [status, setStatus] = useState('')
  const [failed, setFailed] = useState(false)
  const current = useRef(emptyLayout())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const active = useRef<BoardSaveQueue | null>(null)

  const flush = useCallback(async () => {
    const saved = await queue.flush()
    if (active.current === queue) {
      setFailed(!saved)
      setStatus(
        saved
          ? 'Đã lưu'
          : 'Chưa lưu: ' + (queue.error instanceof Error ? queue.error.message : 'Hãy thử lại'),
      )
    }
    return saved
  }, [queue])

  const change = useCallback(
    (patch: BoardPatch) => {
      current.current = applyLayoutPatch(current.current, patch)
      setState((old) => ({ ...old, layout: current.current }))
      queue.enqueue(patch)
      setStatus('Đang lưu…')
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flush, SAVE_DELAY)
    },
    [queue, flush],
  )

  useEffect(() => {
    active.current = queue
    current.current = emptyLayout()
    setState({ path, layout: current.current, loaded: false })
    setStatus('')
    setFailed(false)
    const controller = new AbortController()
    api(path, 'GET', undefined, { signal: controller.signal })
      .then((value) => {
        if (controller.signal.aborted) return
        current.current = { ...emptyLayout(), ...value }
        setState({ path, layout: current.current, loaded: true })
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        setStatus(error.message)
        setFailed(true)
      })
    const leave = () => {
      const patch = queue.snapshot()
      if (!Object.keys(patch).length) return
      const body = JSON.stringify(patch)
      if (new Blob([body]).size < KEEPALIVE_LIMIT) {
        void fetch('/api/v1' + path, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        }).catch(() => {})
      }
    }
    addEventListener('pagehide', leave)
    return () => {
      controller.abort()
      active.current = null
      if (timer.current) clearTimeout(timer.current)
      removeEventListener('pagehide', leave)
      void queue.flush()
    }
  }, [path, queue])

  return {
    layout: state.path === path ? state.layout : emptyLayout(),
    loaded: state.path === path && state.loaded,
    change,
    status,
    failed,
    retry: flush,
    flush,
  }
}

export type BoardState = ReturnType<typeof useWorkBoard>
