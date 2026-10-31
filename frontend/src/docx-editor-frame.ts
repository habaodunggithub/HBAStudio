import './docx-editor-frame.css'

// Writer owns the model, layout, selection, undo and DOCX serializer. This bridge
// owns only app controls and the ordered transport to that native document.
type Message = {
  cmd: string
  request?: string
  loadId?: string
  version?: number
  [key: string]: any
}
type OfficeModule = {
  canvas: HTMLCanvasElement
  uno_main?: Promise<MessagePort>
  [key: string]: any
}
const runtime = window as typeof window & {
  Module: OfficeModule
  FS: {
    mkdirTree(path: string): void
    writeFile(path: string, data: Uint8Array): void
    readFile(path: string): Uint8Array
  }
}
const session = new URLSearchParams(location.search).get('session')
const canvas = document.querySelector<HTMLCanvasElement>('#qtcanvas')!
// A canvas has no editable text/surrounding-text context, even when marked
// contenteditable. Give the OS IME a real text control; Writer remains the model.
const textInput = document.createElement('textarea')
textInput.id = 'writer-input'
textInput.setAttribute('aria-label', 'Nhập văn bản tài liệu Word')
textInput.setAttribute('autocomplete', 'off')
textInput.setAttribute('autocorrect', 'off')
textInput.setAttribute('autocapitalize', 'off')
textInput.spellcheck = false
textInput.maxLength = 2 * 1024 * 1024
textInput.lang = 'vi'
canvas.after(textInput)
const toolbar = document.querySelector<HTMLElement>('#toolbar')!
const surface = document.querySelector<HTMLElement>('#surface')!
const loading = document.querySelector<HTMLElement>('#loading')!
let loadId = '',
  mode = 'edit',
  version = 0,
  ready = false,
  composing = false
let boardScale = 1,
  viewportVersion = 0,
  viewportQueued = false
function setBoardScale(value: unknown) {
  boardScale = Math.max(0.1, Number(value) || 1)
  // The iframe cancels world scaling for a sharp native canvas. Apply that
  // scale to the toolbar's layout as well, keeping its size relative to its card.
  document.documentElement.style.setProperty('--board-scale', String(boardScale))
}
let snapshotTimer: ReturnType<typeof setTimeout> | undefined
const SNAPSHOT_IDLE = 3000
let lastInputAt = 0
let port: MessagePort,
  boot: Promise<void> | undefined,
  queue = Promise.resolve()
type KeyInput = {
  key: string
  code: string
  shift: boolean
  ctrl: boolean
  alt: boolean
  text?: string
  removeText?: string
  composing?: boolean
  composition?: 'start' | 'end'
}
let committedInput = ''
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
function commitText() {
  if (!ready || mode !== 'edit') return
  const next = textInput.value
  if (next === committedInput) return
  const before = [...graphemes.segment(committedInput)].map((part) => part.segment)
  const after = [...graphemes.segment(next)].map((part) => part.segment)
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix])
    prefix++
  input({
    key: '',
    code: '',
    shift: false,
    ctrl: false,
    alt: false,
    removeText: before.slice(prefix).join(''),
    text: after.slice(prefix).join(''),
    composing,
  })
  committedInput = next
  // Keep a bounded surrounding-text context for replacement-based Vietnamese
  // keyboards. Never rewrite the browser's active composition range.
  if (!composing && after.length > 512) {
    textInput.value = committedInput = after.slice(-512).join('')
    textInput.setSelectionRange(textInput.value.length, textInput.value.length)
  }
}
function resetText() {
  commitText()
  endComposition()
  textInput.value = committedInput = ''
}
function endComposition() {
  if (!composing) return
  composing = false
  if (ready && mode === 'edit')
    input({ key: '', code: '', shift: false, ctrl: false, alt: false, composition: 'end' })
}
function focusText() {
  textInput.focus({ preventScroll: true })
}
let inputBatch: { generation: string; events: KeyInput[] } | undefined
const requests = new Map<
  string,
  { resolve(data: Message): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
>()
function post(type: string, data: Record<string, unknown> = {}) {
  const message = { session, loadId, type, ...data },
    bytes = data.bytes
  parent.postMessage(message, location.origin, bytes instanceof ArrayBuffer ? [bytes] : [])
}
function request(cmd: string, data: Record<string, unknown> = {}): Promise<Message> {
  return new Promise((resolve, reject) => {
    const request = crypto.randomUUID()
    const timer = setTimeout(() => {
      requests.delete(request)
      reject(new Error('Writer chưa phản hồi. Bản gốc vẫn được giữ.'))
    }, 45000)
    requests.set(request, { resolve, reject, timer })
    port.postMessage({ cmd, request, loadId, ...data })
  })
}
function enqueue(task: () => Promise<void>) {
  queue = queue.then(task).catch((error) =>
    post('error', {
      message: error instanceof Error ? error.message : 'Chưa xử lý được tài liệu Word.',
    }),
  )
}
function ordered(task: () => Promise<void>) {
  // Seal the preceding input segment before a toolbar/export/mode barrier.
  inputBatch = undefined
  enqueue(task)
}
function input(event: KeyInput) {
  lastInputAt = performance.now()
  if (inputBatch?.generation === loadId && inputBatch.events.length < 256) {
    inputBatch.events.push(event)
    return
  }
  const batch = { generation: loadId, events: [event] }
  inputBatch = batch
  enqueue(async () => {
    if (inputBatch === batch) inputBatch = undefined
    if (batch.generation === loadId && ready) await request('keys', { events: batch.events })
  })
}
function buttonsEnabled(enabled: boolean) {
  toolbar
    .querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button, select')
    .forEach((element) => (element.disabled = !enabled))
}
function scheduleSnapshot() {
  clearTimeout(snapshotTimer)
  const generation = loadId
  snapshotTimer = setTimeout(
    () =>
      ordered(async () => {
        if (generation !== loadId || !ready) return
        // Export is a synchronous native filter. Reserve it for an actual pause;
        // explicit Save and navigation checkpoints still flush immediately.
        if (performance.now() - lastInputAt < SNAPSHOT_IDLE) {
          scheduleSnapshot()
          return
        }
        try {
          await exportBytes('snapshot', undefined, generation)
        } catch {
          if (generation === loadId) post('draft-error')
        }
      }),
    SNAPSHOT_IDLE,
  )
}
async function exportBytes(type: string, parentRequest?: string, generation = loadId) {
  const result = await request('export')
  if (generation !== loadId) return
  // Copy away from the engine's shared WASM heap before transferring ownership.
  const bytes = Uint8Array.from(runtime.FS.readFile('/tmp/hba-output.docx')).buffer
  post(type, { request: parentRequest, version: result.version, bytes })
}
async function start() {
  if (boot) return boot
  boot = (async () => {
    if (!crossOriginIsolated)
      throw new Error('Trình soạn thảo cần tải lại app để bật môi trường Writer.')
    const response = await fetch('/api/v1/office/runtime', { credentials: 'same-origin' })
    if (!response.ok) throw new Error('Chưa kiểm tra được bộ Writer trên máy.')
    const state = await response.json()
    if (!state.available) throw new Error('Bộ LibreOffice Writer chưa sẵn sàng trên máy này.')
    const base = '/office-runtime/',
      suffix = '?v=' + encodeURIComponent(state.runtime_id)
    runtime.Module = {
      canvas,
      preRun: [
        () => {
          // LCD subpixel antialiasing assumes a physical RGB panel. A canvas
          // embedded in a transformed board has no fixed subpixel alignment.
          runtime.FS.mkdirTree('/instdir/share/fontconfig/conf.d')
          runtime.FS.writeFile(
            '/instdir/share/fontconfig/conf.d/99-hba-rendering.conf',
            new TextEncoder().encode(
              '<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig>' +
                '<match target="font"><edit name="rgba" mode="assign"><const>none</const></edit>' +
                '<edit name="antialias" mode="assign"><bool>true</bool></edit></match></fontconfig>',
            ),
          )
        },
      ],
      uno_scripts: [base + 'zeta.js' + suffix, '/office/writer-worker.js'],
      locateFile: (path: string) => base + path + suffix,
      printErr: (message: string) => {
        // The upstream Qt build emits platform diagnostics on stderr even
        // during successful startup. Keep these distinct from app failures.
        if (
          /^(QRect\(|QObject::connect\(|warning: unsupported syscall: __syscall_mprotect)/.test(
            message,
          )
        )
          console.debug('[Writer]', message)
        else console.warn('[Writer]', message)
      },
      onAbort: () => {
        ready = false
        buttonsEnabled(false)
        post('error', {
          fatal: true,
          message: 'Writer đã dừng. Hãy thử mở lại tài liệu; bản gốc vẫn được giữ.',
        })
      },
    }
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = base + 'soffice.js' + suffix
      script.onload = () => resolve()
      script.onerror = () => reject(new Error('Chưa tải được bộ LibreOffice Writer.'))
      document.body.append(script)
    })
    port = await runtime.Module.uno_main!
    await new Promise<void>((resolve) => {
      port.onmessage = (event: MessageEvent<Message>) => {
        const data = event.data
        if (data.cmd === 'runtime-ready') {
          resolve()
          return
        }
        if (data.cmd === 'change' && data.loadId === loadId && ready) {
          version = Math.max(version, data.version || 0)
          post('change', { version })
          scheduleSnapshot()
        } else if (data.cmd === 'format' && data.loadId === loadId) {
          const control = toolbar.querySelector<HTMLButtonElement>(
            '[data-command="' + data.name + '"]',
          )
          if (control) control.setAttribute('aria-pressed', String(data.value === true))
          const label = (
            {
              CharFontName: 'Phông chữ',
              FontHeight: 'Cỡ chữ',
              ParaStyle: 'Kiểu đoạn văn',
            } as Record<string, string>
          )[String(data.name)]
          const select =
            label && toolbar.querySelector<HTMLSelectElement>('[aria-label="' + label + '"]')
          if (select && data.value !== undefined) {
            const value = String(data.value)
            if (![...select.options].some((option) => option.value === value))
              select.add(new Option(value, value))
            select.value = value
          }
        } else if (data.request) {
          const pending = requests.get(data.request)
          if (!pending) return
          clearTimeout(pending.timer)
          requests.delete(data.request)
          if (data.cmd === 'error')
            pending.reject(new Error(String(data.message || 'Writer chưa xử lý được tài liệu.')))
          else pending.resolve(data)
        }
      }
    })
  })()
  return boot
}
async function setMode(value: string) {
  const generation = loadId
  await request('mode', { value })
  if (generation !== loadId) return
  mode = value
  toolbar.hidden = mode === 'preview'
  textInput.readOnly = mode === 'preview'
  canvas.setAttribute('aria-readonly', String(mode === 'preview'))
  window.dispatchEvent(new Event('resize'))
}
async function syncViewport(fit = false) {
  const result = await request('viewport', { scale: boardScale, width: surface.clientWidth, fit })
  canvas.dataset.documentZoom = String(result.zoom)
}
function queueViewport() {
  viewportVersion++
  if (!ready || viewportQueued) return
  viewportQueued = true
  const generation = loadId
  ordered(async () => {
    try {
      while (ready && generation === loadId) {
        const revision = viewportVersion
        await syncViewport()
        if (revision === viewportVersion) break
      }
    } finally {
      viewportQueued = false
    }
  })
}
new ResizeObserver(queueViewport).observe(surface)
addEventListener('message', (event) => {
  if (
    event.source !== parent ||
    event.origin !== location.origin ||
    event.data?.session !== session
  )
    return
  const message = event.data
  if (message.type === 'theme') {
    document.documentElement.dataset.theme = message.theme === 'dark' ? 'dark' : 'light'
    return
  }
  if (message.type === 'load') {
    loadId = message.loadId
    ready = false
    version = 0
    composing = false
    clearTimeout(snapshotTimer)
    textInput.value = committedInput = ''
    buttonsEnabled(false)
    loading.hidden = false
    setBoardScale(message.boardScale)
    document.documentElement.dataset.theme = message.theme === 'dark' ? 'dark' : 'light'
    const generation = loadId
    ordered(async () => {
      await start()
      if (generation !== loadId) return
      if (!(message.bytes instanceof ArrayBuffer)) throw new Error('Chưa nhận được nội dung DOCX.')
      runtime.FS.writeFile('/tmp/hba-input.docx', new Uint8Array(message.bytes))
      await request('load')
      if (generation !== loadId) return
      await setMode(message.mode || 'edit')
      window.dispatchEvent(new Event('resize'))
      await new Promise((resolve) => setTimeout(resolve, 300))
      if (generation !== loadId) return
      await syncViewport(true)
      loading.hidden = true
      ready = true
      buttonsEnabled(true)
      post('ready')
    })
  } else if (message.loadId === loadId) {
    const generation = loadId
    if (message.type === 'viewport') {
      setBoardScale(message.boardScale)
      queueViewport()
    } else if (message.type === 'export') {
      commitText()
      ordered(async () => {
        if (generation !== loadId) return
        try {
          if (!ready) throw new Error('Bộ soạn thảo chưa sẵn sàng.')
          if (Number.isFinite(message.afterVersion)) {
            const checkpoint = await request('checkpoint')
            if (generation !== loadId) return
            if ((checkpoint.version || 0) <= message.afterVersion) {
              post('exported', {
                request: message.request,
                version: checkpoint.version,
                bytes: new ArrayBuffer(0),
              })
              return
            }
          }
          await exportBytes('exported', message.request, generation)
        } catch (error) {
          if (generation === loadId)
            post('error', {
              request: message.request,
              message: error instanceof Error ? error.message : 'Chưa xuất được DOCX.',
            })
        }
      })
    } else if (message.type === 'mode') {
      resetText()
      ordered(async () => {
        if (generation === loadId && ready) await setMode(message.value)
      })
    }
  }
})
function command(name: string, args: Record<string, unknown> = {}) {
  if (!ready || mode !== 'edit') return
  resetText()
  lastInputAt = performance.now()
  const generation = loadId
  ordered(async () => {
    if (generation !== loadId) return
    await request('command', { name, args })
    focusText()
  })
}
// Browser text events are authoritative for printable input. Cancelling their
// keydown/keypress prevents UniKey/TSF from composing or replacing a vowel.
// Capture them before Qt's separate physical-key bridge to avoid double input.
textInput.addEventListener(
  'compositionstart',
  (event) => {
    composing = true
    lastInputAt = performance.now()
    event.stopImmediatePropagation()
    if (ready && mode === 'edit')
      input({ key: '', code: '', shift: false, ctrl: false, alt: false, composition: 'start' })
  },
  true,
)
textInput.addEventListener('compositionupdate', (event) => event.stopImmediatePropagation(), true)
textInput.addEventListener(
  'compositionend',
  (event) => {
    event.stopImmediatePropagation()
    commitText()
    endComposition()
  },
  true,
)
textInput.addEventListener(
  'beforeinput',
  (event) => {
    event.stopImmediatePropagation()
    if (!ready || mode !== 'edit') {
      event.preventDefault()
      return
    }
    lastInputAt = performance.now()
    // With no local context, deletion belongs to the native document selection.
    if (!composing && !textInput.value && /^delete/.test(event.inputType)) {
      event.preventDefault()
      input({
        key: event.inputType.includes('Forward') ? 'Delete' : 'Backspace',
        code: '',
        shift: false,
        ctrl: false,
        alt: false,
      })
    }
  },
  true,
)
textInput.addEventListener(
  'input',
  (event) => {
    event.stopImmediatePropagation()
    lastInputAt = performance.now()
    commitText()
  },
  true,
)
textInput.addEventListener('blur', (event) => {
  if (event.relatedTarget !== canvas) resetText()
})
// Qt calls canvas.focus() after native updates. Keep that focus in the real
// input context, otherwise the very next syllable loses IME support again.
canvas.focus = focusText
canvas.addEventListener('focus', () => {
  if (ready) queueMicrotask(focusText)
})
addEventListener(
  'keydown',
  (event) => {
    if (event.target !== textInput && event.target !== canvas) return
    event.stopImmediatePropagation()
    const altGraph = event.getModifierState('AltGraph')
    const shortcut = !altGraph && (event.ctrlKey || event.metaKey)
    if (shortcut && event.key.toLowerCase() === 's') {
      event.preventDefault()
      commitText()
      post('save-request')
      return
    }
    if (composing || event.isComposing || event.keyCode === 229) return
    if (['Shift', 'Control', 'Alt', 'Meta', 'Dead'].includes(event.key)) return
    if (!ready || mode === 'preview') {
      const navigation = [
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'Home',
        'End',
        'PageUp',
        'PageDown',
        'Escape',
      ]
      if (
        !navigation.includes(event.key) &&
        !(shortcut && ['a', 'c'].includes(event.key.toLowerCase()))
      ) {
        event.preventDefault()
        return
      }
    } else {
      // Let the real text control receive characters, AltGr, paste, and backward
      // deletion of its surrounding text. UniKey can then replace previous input.
      const printable = event.key && [...graphemes.segment(event.key)].length === 1
      if (
        (!shortcut && (!event.altKey || altGraph) && printable) ||
        (!shortcut && !event.altKey && event.key === 'Backspace' && textInput.value) ||
        (shortcut && event.key.toLowerCase() === 'v')
      )
        return
    }
    event.preventDefault()
    resetText()
    input({
      key: event.key,
      code: event.code,
      shift: event.shiftKey,
      ctrl: shortcut,
      alt: !altGraph && event.altKey,
    })
  },
  true,
)
for (const type of ['keypress', 'keyup'])
  addEventListener(
    type,
    (event) => {
      if (event.target === textInput || event.target === canvas) event.stopImmediatePropagation()
    },
    true,
  )
// Paste also uses the text control, so it shares input/composition ordering.
textInput.addEventListener(
  'paste',
  (event) => {
    event.stopImmediatePropagation()
    if (!ready || mode !== 'edit') event.preventDefault()
  },
  true,
)
canvas.addEventListener(
  'drop',
  (event) => {
    if (mode === 'preview') {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  },
  true,
)
canvas.addEventListener(
  'cut',
  (event) => {
    if (mode === 'preview') {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  },
  true,
)
canvas.addEventListener('wheel', (event) => event.preventDefault(), { passive: false })
canvas.addEventListener('contextmenu', (event) => event.preventDefault())
canvas.addEventListener(
  'pointerdown',
  (event) => {
    resetText()
    const bounds = surface.getBoundingClientRect()
    // Keep the IME candidate window inside the document near the click, rather
    // than at an offscreen/hidden control. Pointer selection still belongs to Qt.
    textInput.style.left =
      Math.max(0, Math.min(bounds.width - 2, event.clientX - bounds.left)) + 'px'
    textInput.style.top =
      Math.max(0, Math.min(bounds.height - 24, event.clientY - bounds.top)) + 'px'
    if (ready) port.postMessage({ cmd: 'interaction', loadId })
  },
  true,
)
canvas.addEventListener('pointerup', () => {
  if (ready) queueMicrotask(focusText)
})
function button(label: string, text: string, name: string) {
  const element = document.createElement('button')
  element.type = 'button'
  element.title = label
  element.setAttribute('aria-label', label)
  element.textContent = text
  element.dataset.command = name
  element.disabled = true
  if (['Bold', 'Italic', 'Underline', 'DefaultBullet', 'DefaultNumbering'].includes(name))
    element.setAttribute('aria-pressed', 'false')
  element.addEventListener('click', () => command(name))
  toolbar.append(element)
}
function select(label: string, options: [string, string][], name: string, key: string) {
  const element = document.createElement('select')
  element.setAttribute('aria-label', label)
  for (const [value, text] of options) element.add(new Option(text, value))
  element.disabled = true
  element.addEventListener('change', () => command(name, { [key]: element.value }))
  toolbar.append(element)
}
button('Hoàn tác', '↶', 'Undo')
button('Làm lại', '↷', 'Redo')
select(
  'Kiểu đoạn văn',
  [
    ['Text body', 'Văn bản'],
    ['Heading 1', 'Tiêu đề 1'],
    ['Heading 2', 'Tiêu đề 2'],
    ['Heading 3', 'Tiêu đề 3'],
  ],
  'StyleApply',
  'style',
)
select(
  'Phông chữ',
  ['Liberation Serif', 'Liberation Sans', 'Liberation Mono', 'DejaVu Sans'].map((font) => [
    font,
    font,
  ]),
  'CharFontName',
  'font',
)
select(
  'Cỡ chữ',
  ['10', '11', '12', '14', '16', '18', '20', '24', '28', '32'].map((size) => [size, size]),
  'FontHeight',
  'size',
)
toolbar.querySelector<HTMLSelectElement>('[aria-label="Cỡ chữ"]')!.value = '12'
button('In đậm', 'B', 'Bold')
button('In nghiêng', 'I', 'Italic')
button('Gạch chân', 'U', 'Underline')
button('Danh sách dấu đầu dòng', '• ≡', 'DefaultBullet')
button('Danh sách đánh số', '1. ≡', 'DefaultNumbering')
button('Căn trái', '≡', 'LeftPara')
button('Căn giữa', '☰', 'CenterPara')
button('Căn phải', '≡', 'RightPara')
button('Chèn bảng 3 × 3', '▦', 'InsertTable')
const fit = document.createElement('button')
fit.type = 'button'
fit.textContent = 'Vừa trang'
fit.setAttribute('aria-label', 'Vừa chiều rộng thẻ')
fit.disabled = true
fit.addEventListener('click', () =>
  ordered(async () => {
    if (ready) await syncViewport(true)
    focusText()
  }),
)
toolbar.append(fit)
toolbar.addEventListener(
  'wheel',
  (event) => {
    if (!event.ctrlKey && toolbar.scrollWidth > toolbar.clientWidth) {
      toolbar.scrollLeft += event.deltaX || event.deltaY
      event.preventDefault()
    }
  },
  { passive: false },
)
post('booted')
addEventListener('beforeunload', () => {
  clearTimeout(snapshotTimer)
  for (const request of requests.values()) clearTimeout(request.timer)
})
