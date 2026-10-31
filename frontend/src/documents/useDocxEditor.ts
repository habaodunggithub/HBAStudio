import { useEffect, useRef, useState } from 'react'
import { api, ApiError, checkedFetch } from '../api'
import { getDocxDraft, putDocxDraft, deleteDocxDraft } from '../docxDraft'
import { registerReaderDraft } from '../readerDrafts'
import { documentEndpoint, DOCX_MIME, downloadBlob } from './files'

type Mode = 'preview' | 'edit'
type Phase = 'idle' | 'loading' | 'ready' | 'error'
type Exported = { bytes: ArrayBuffer; version: number; loadId: string }
type Load = { bytes: ArrayBuffer; loadId: string; title: string; mode: Mode }
type ExportRequest = {
  loadId: string
  resolve: (data: Exported) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const READY_TIMEOUT = 60000
const EXPORT_TIMEOUT = 45000

export function useDocxEditor(id: string, title: string, boardZoom = 1) {
  const [mode, setMode] = useState<Mode>('preview')
  const [mountedFrame, setMountedFrame] = useState(false)
  const [frameEpoch, setFrameEpoch] = useState(0)
  const [phase, setPhase] = useState<Phase>('idle')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [session] = useState(() => crypto.randomUUID())
  const identity = useRef(id)
  const boardScale = useRef(boardZoom)
  boardScale.current = boardZoom
  const frame = useRef<HTMLIFrameElement>(null)
  const alive = useRef(true)
  const phaseRef = useRef<Phase>('idle')
  const modeRef = useRef<Mode>('preview')
  const savingRef = useRef(false)
  const conflictRef = useRef(false)
  const frameBooted = useRef(false)
  const revision = useRef('')
  const loadId = useRef('')
  const initial = useRef<Load | null>(null)
  const version = useRef(0)
  const versionBase = useRef(0)
  const savedVersion = useRef(0)
  const draftVersion = useRef(-1)
  const draftRevision = useRef('')
  const draftQueue = useRef<Promise<void>>(Promise.resolve())
  const saveTask = useRef<Promise<void> | null>(null)
  const readyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requests = useRef(new Map<string, ExportRequest>())

  function updatePhase(value: Phase) {
    phaseRef.current = value
    if (alive.current) setPhase(value)
  }
  function clearReadyTimer() {
    if (readyTimer.current) clearTimeout(readyTimer.current)
    readyTimer.current = null
  }
  function post(type: string, data: Record<string, unknown> = {}) {
    frame.current?.contentWindow?.postMessage({ session, type, ...data }, location.origin)
  }
  function postLoad() {
    if (initial.current)
      post('load', {
        ...initial.current,
        boardScale: boardScale.current,
        theme: document.documentElement.dataset.theme,
      })
  }
  function current(generation: string) {
    return alive.current && loadId.current === generation
  }
  function rejectExports(message: string) {
    for (const request of requests.current.values()) {
      clearTimeout(request.timer)
      request.reject(new Error(message))
    }
    requests.current.clear()
  }
  function orderedDraft(operation: () => Promise<void>) {
    const result = draftQueue.current.catch(() => {}).then(operation)
    draftQueue.current = result.catch(() => {})
    return result
  }
  function draft(data: Exported): Promise<void> {
    return orderedDraft(async () => {
      // Check inside the queue: a save or a newer snapshot may have finished
      // while this export was travelling from the frame.
      if (
        !current(data.loadId) ||
        data.version <= savedVersion.current ||
        (data.version <= draftVersion.current && draftRevision.current === revision.current)
      )
        return
      try {
        const base = revision.current
        await putDocxDraft({
          id,
          revision: base,
          blob: new Blob([data.bytes], { type: DOCX_MIME }),
        })
        if (current(data.loadId)) {
          draftVersion.current = data.version
          draftRevision.current = base
        }
      } catch {
        const message = 'Chưa giữ được bản nháp DOCX trên máy. Hãy bấm Lưu trước khi đóng.'
        if (current(data.loadId)) setError(message)
        throw new Error(message)
      }
    })
  }
  function exported(checkpoint = false): Promise<Exported> {
    if (phaseRef.current !== 'ready')
      return Promise.reject(new Error('Trình soạn thảo DOCX chưa sẵn sàng.'))
    const generation = loadId.current
    return new Promise((resolve, reject) => {
      const request = crypto.randomUUID()
      const timer = setTimeout(() => {
        requests.current.delete(request)
        reject(new Error('Xuất DOCX quá thời gian; bản đang sửa vẫn được giữ.'))
      }, EXPORT_TIMEOUT)
      requests.current.set(request, { loadId: generation, resolve, reject, timer })
      post('export', {
        loadId: generation,
        request,
        ...(checkpoint ? { afterVersion: savedVersion.current - versionBase.current } : {}),
      })
    })
  }
  async function flush() {
    // Navigation must not unmount the editor before a committing Save can
    // migrate its newer draft to the revision returned by the backend.
    if (saveTask.current) await saveTask.current
    const generation = loadId.current
    if (current(generation) && phaseRef.current === 'ready') {
      // DOM input can already be queued in Writer before its change message
      // reaches React. Always cross the native input barrier before deciding
      // that a clean-looking card is safe to unmount. A clean checkpoint has
      // empty bytes and is rejected by draft's saved-version guard.
      const data = await exported(true)
      if (!current(generation)) return
      version.current = Math.max(version.current, data.version)
      setDirty(version.current > savedVersion.current)
      await draft(data)
    }
    while (
      current(generation) &&
      phaseRef.current === 'ready' &&
      version.current > savedVersion.current &&
      (version.current > draftVersion.current || draftRevision.current !== revision.current)
    ) {
      const data = await exported(true)
      if (!current(generation)) return
      version.current = Math.max(version.current, data.version)
      setDirty(version.current > savedVersion.current)
      await draft(data)
      // Edits made during an export need their own snapshot before a card is
      // unmounted. The frame supplies the version associated with its bytes.
    }
    await draftQueue.current
  }
  async function load(discard = false) {
    if (savingRef.current) return
    const generation = crypto.randomUUID()
    loadId.current = generation
    initial.current = null
    rejectExports('Tài liệu đang được mở lại.')
    clearReadyTimer()
    updatePhase('loading')
    setError('')
    readyTimer.current = setTimeout(() => {
      if (!current(generation) || phaseRef.current !== 'loading') return
      updatePhase('error')
      setError('Mở trình soạn thảo quá thời gian. Bản nháp vẫn được giữ; hãy thử mở lại.')
    }, READY_TIMEOUT)
    try {
      // A prior draft write must settle before reading or discarding it.
      await draftQueue.current
      const response = await checkedFetch('/api/v1' + documentEndpoint(id) + '/docx')
      const bytes = await response.arrayBuffer()
      const currentRevision = response.headers.get('X-Document-Revision')
      if (!currentRevision) throw new Error('Chưa đọc được phiên bản DOCX')
      const stored = discard ? undefined : await getDocxDraft(id)
      const documentBytes = stored ? await stored.blob.arrayBuffer() : bytes
      if (!current(generation)) return
      if (discard) await orderedDraft(() => deleteDocxDraft(id))
      if (!current(generation)) return
      revision.current = stored?.revision || currentRevision
      versionBase.current = stored ? 1 : 0
      version.current = versionBase.current
      savedVersion.current = 0
      draftVersion.current = stored ? 1 : -1
      draftRevision.current = stored?.revision || ''
      setDirty(Boolean(stored))
      conflictRef.current = Boolean(stored && stored.revision !== currentRevision)
      setConflict(conflictRef.current)
      modeRef.current = 'edit'
      setMode('edit')
      initial.current = { bytes: documentBytes, loadId: generation, title, mode: 'edit' }
      setMountedFrame(true)
      if (frameBooted.current) postLoad()
    } catch (reason) {
      if (!current(generation)) return
      clearReadyTimer()
      updatePhase('error')
      setError(reason instanceof Error ? reason.message : 'Không mở được DOCX')
    }
  }
  function save(): Promise<void> {
    if (saveTask.current) return saveTask.current
    const task = performSave()
    saveTask.current = task
    void task.finally(() => {
      if (saveTask.current === task) saveTask.current = null
    })
    return task
  }
  async function performSave() {
    if (phaseRef.current !== 'ready' || savingRef.current || conflictRef.current) return
    const generation = loadId.current
    savingRef.current = true
    setSaving(true)
    setError('')
    try {
      const data = await exported()
      const form = new FormData()
      form.append('file', new Blob([data.bytes], { type: DOCX_MIME }), title)
      form.append('revision', revision.current)
      let body: { revision: string }
      try {
        body = await api(documentEndpoint(id) + '/docx', 'PUT', form)
      } catch (reason) {
        if (!current(generation)) return
        if (reason instanceof ApiError && reason.status === 409) {
          conflictRef.current = true
          setConflict(true)
        }
        await draft(data)
        throw reason
      }
      if (!current(generation)) return
      revision.current = body.revision
      savedVersion.current = data.version
      setDirty(version.current > data.version)
      // Clean up the old-base draft in order, then snapshot any edits made
      // during Save against the committed revision. Never lock the editor.
      let cleanupError: unknown
      try {
        await orderedDraft(async () => {
          if (!current(generation)) return
          await deleteDocxDraft(id)
          if (current(generation)) {
            draftVersion.current = -1
            draftRevision.current = ''
          }
        })
      } catch (reason) {
        cleanupError = reason
      }
      if (current(generation) && version.current > savedVersion.current) {
        // Overwriting the draft also repairs a failed old-draft deletion.
        await draft(await exported())
      } else if (cleanupError) throw cleanupError
    } catch (reason) {
      if (current(generation))
        setError(reason instanceof Error ? reason.message : 'Chưa lưu được DOCX')
    } finally {
      if (current(generation)) {
        savingRef.current = false
        setSaving(false)
      }
    }
  }
  async function switchMode(next: Mode) {
    if (phaseRef.current === 'loading') return
    if (!initial.current) {
      if (next === 'edit') await load()
      return
    }
    modeRef.current = next
    setMode(next)
    post('mode', { loadId: loadId.current, value: next })
  }
  async function retry() {
    try {
      if (phaseRef.current === 'ready') await flush()
      else if (phaseRef.current === 'error') {
        // A rejected WASM bootstrap or aborted engine cannot recover by
        // loading a document into the same JavaScript/runtime instance.
        frameBooted.current = false
        setFrameEpoch((value) => value + 1)
      }
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Chưa giữ được bản nháp DOCX')
    }
  }
  async function download() {
    try {
      const data = await exported()
      downloadBlob(new Blob([data.bytes], { type: DOCX_MIME }), title)
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : 'Chưa tải được DOCX')
    }
  }

  // Message listeners keep current operations without restarting the iframe.
  const actions = useRef({ save, load, flush })
  actions.current = { save, load, flush }
  useEffect(() => {
    if (mountedFrame) post('viewport', { loadId: loadId.current, boardScale: boardZoom })
  }, [boardZoom, mountedFrame, phase])
  useEffect(() => {
    alive.current = true
    if (identity.current !== id) {
      identity.current = id
      loadId.current = crypto.randomUUID()
      initial.current = null
      frameBooted.current = false
      modeRef.current = 'preview'
      phaseRef.current = 'idle'
      revision.current = ''
      version.current = 0
      versionBase.current = 0
      savedVersion.current = 0
      draftVersion.current = -1
      draftRevision.current = ''
      saveTask.current = null
      conflictRef.current = false
      savingRef.current = false
      setMountedFrame(false)
      setMode('preview')
      setPhase('idle')
      setDirty(false)
      setConflict(false)
      setSaving(false)
      setError('')
    }
    void getDocxDraft(id)
      .then((stored) => {
        if (stored && alive.current && phaseRef.current === 'idle') void actions.current.load()
      })
      .catch(() => {})
    const message = (event: MessageEvent) => {
      if (
        event.origin !== location.origin ||
        event.source !== frame.current?.contentWindow ||
        event.data?.session !== session
      )
        return
      const data = event.data
      if (data.type === 'booted') {
        frameBooted.current = true
        postLoad()
        return
      }
      if (data.loadId !== loadId.current || !alive.current) return
      if (data.type === 'ready') {
        clearReadyTimer()
        updatePhase('ready')
        // Late readiness must honor a mode chosen while the engine opened.
        post('mode', { loadId: loadId.current, value: modeRef.current })
      } else if (data.type === 'change') {
        version.current = Math.max(version.current, data.version + versionBase.current)
        setDirty(version.current > savedVersion.current)
      } else if (data.type === 'snapshot') {
        void draft({ ...data, version: data.version + versionBase.current }).catch(() => {})
      } else if (data.type === 'exported') {
        const request = requests.current.get(data.request)
        if (!request || request.loadId !== data.loadId) return
        clearTimeout(request.timer)
        requests.current.delete(data.request)
        request.resolve({ ...data, version: data.version + versionBase.current })
      } else if (data.type === 'save-request') void actions.current.save()
      else if (data.type === 'draft-error')
        setError('Chưa tạo được bản nháp DOCX. Hãy bấm Lưu trước khi đóng.')
      else if (data.type === 'error') {
        setError(data.message || 'Không mở được DOCX')
        if (data.fatal) {
          clearReadyTimer()
          updatePhase('error')
          rejectExports(data.message || 'Trình soạn thảo đã dừng.')
          return
        }
        const request = requests.current.get(data.request)
        if (request) {
          clearTimeout(request.timer)
          requests.current.delete(data.request)
          request.reject(new Error(data.message || 'Chưa xuất được DOCX'))
        } else if (phaseRef.current === 'loading') {
          clearReadyTimer()
          updatePhase('error')
        }
      }
    }
    const leave = (event: BeforeUnloadEvent) => {
      if (
        saveTask.current ||
        (version.current > savedVersion.current &&
          (version.current > draftVersion.current || draftRevision.current !== revision.current))
      ) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    const theme = new MutationObserver(() =>
      post('theme', { theme: document.documentElement.dataset.theme }),
    )
    addEventListener('message', message)
    addEventListener('beforeunload', leave)
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const unregister = registerReaderDraft(id, () => actions.current.flush())
    return () => {
      alive.current = false
      clearReadyTimer()
      rejectExports('Đã đóng trình soạn thảo')
      removeEventListener('message', message)
      removeEventListener('beforeunload', leave)
      theme.disconnect()
      unregister()
    }
  }, [id, session])

  return {
    mode,
    mountedFrame,
    frameEpoch,
    phase,
    ready: phase === 'ready',
    dirty,
    saving,
    busy: phase === 'loading' || saving,
    error,
    conflict,
    session,
    frame,
    save,
    switchMode,
    download,
    retry,
    discard: () => load(true),
  }
}
