import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { Minus, Plus } from 'lucide-react'
import type { PDFDocumentProxy, RenderTask, TextLayer } from 'pdfjs-dist'
import { ReaderPager } from './documents/ReaderPager'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

type PageSize = { width: number; height: number }
const MAX_PAGE_PIXELS = 16 * 1024 * 1024
function release(host: HTMLElement | null) {
  if (!host) return
  for (const canvas of host.querySelectorAll('canvas')) {
    canvas.width = 0
    canvas.height = 0
  }
  host.replaceChildren()
}
const PDFPage = memo(function PDFPage({
  pdf,
  number,
  scale,
  density,
  initialSize,
  scrollRoot,
  onRendered,
}: {
  pdf: PDFDocumentProxy
  number: number
  scale: number
  density: number
  initialSize: PageSize
  scrollRoot: RefObject<HTMLDivElement | null>
  onRendered: () => void
}) {
  const wrapper = useRef<HTMLDivElement>(null),
    raster = useRef<HTMLDivElement>(null),
    textHost = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false),
    [size, setSize] = useState(initialSize),
    [rendered, setRendered] = useState(false),
    [error, setError] = useState('')
  const [selected, setSelected] = useState(false),
    [textReady, setTextReady] = useState(false)
  const keepText = (near && rendered) || selected
  useEffect(() => {
    if (!textReady) return
    const selection = () => {
      const range = getSelection()
      setSelected(
        !!range &&
          !range.isCollapsed &&
          !!textHost.current &&
          range.containsNode(textHost.current, true),
      )
    }
    document.addEventListener('selectionchange', selection)
    return () => document.removeEventListener('selectionchange', selection)
  }, [textReady])
  useEffect(() => {
    const host = textHost.current
    if (!host) return
    if (!keepText) {
      host.replaceChildren()
      setTextReady(false)
      return
    }
    let dead = false,
      layer: TextLayer | undefined
    ;(async () => {
      const [sheet, lib] = await Promise.all([pdf.getPage(number), import('pdfjs-dist')])
      if (dead) return
      const viewport = sheet.getViewport({ scale })
      host.replaceChildren()
      host.style.setProperty('--total-scale-factor', String(viewport.scale * viewport.userUnit))
      layer = new lib.TextLayer({
        textContentSource: sheet.streamTextContent(),
        container: host,
        viewport,
      })
      await layer.render()
      if (!dead) setTextReady(true)
    })().catch((e) => {
      if (!dead && e.name !== 'AbortException')
        setError('Chưa tạo được lớp chữ để sao chép. ' + e.message)
    })
    return () => {
      dead = true
      layer?.cancel()
    }
  }, [pdf, number, scale, keepText])
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => setNear(entries[0].isIntersecting), {
      root: scrollRoot.current,
      rootMargin: '500px 300px',
    })
    if (wrapper.current) observer.observe(wrapper.current)
    return () => observer.disconnect()
  }, [scrollRoot])
  useEffect(() => {
    if (!near) {
      release(raster.current)
      setRendered(false)
      return
    }
    let cancelled = false,
      task: RenderTask | undefined,
      next: HTMLCanvasElement | undefined
    setError('')
    ;(async () => {
      const sheet = await pdf.getPage(number)
      if (cancelled) return
      const base = sheet.getViewport({ scale: 1 }),
        viewport = sheet.getViewport({ scale })
      setSize((old) =>
        old.width === base.width && old.height === base.height
          ? old
          : { width: base.width, height: base.height },
      )
      // Supersample for text clarity, including CSS board zoom, with a per-page memory limit.
      const output = Math.min(
        density,
        Math.sqrt(MAX_PAGE_PIXELS / (viewport.width * viewport.height)),
        8192 / viewport.width,
        8192 / viewport.height,
      )
      next = document.createElement('canvas')
      next.width = Math.ceil(viewport.width * output)
      next.height = Math.ceil(viewport.height * output)
      next.style.width = viewport.width + 'px'
      next.style.height = viewport.height + 'px'
      next.setAttribute('aria-label', `Trang ${number}`)
      next.dataset.pixelRatio = String(output)
      const previous = raster.current?.querySelector('canvas')
      if (previous) {
        previous.style.width = next.style.width
        previous.style.height = next.style.height
      }
      task = sheet.render({
        canvas: next,
        viewport,
        transform: [output, 0, 0, output, 0, 0],
        background: '#ffffff',
      })
      await task.promise
      if (cancelled) return
      release(raster.current)
      raster.current?.append(next)
      setRendered(true)
      onRendered()
    })()
      .catch((e) => {
        if (!cancelled && e.name !== 'RenderingCancelledException') setError(e.message)
      })
      .finally(() => {
        if (cancelled && next) {
          next.width = 0
          next.height = 0
        }
      })
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [pdf, number, scale, density, near, onRendered])
  useEffect(() => () => release(raster.current), [])
  return (
    <div
      ref={wrapper}
      className="pdf-page"
      data-pdf-page={number}
      data-rendered={rendered}
      style={{ width: size.width * scale, height: size.height * scale }}
    >
      <div ref={raster} className="pdf-page-raster" />
      <div ref={textHost} className="pdf-text-layer" data-text-ready={textReady} />
      {error ? (
        <p role="alert" className="pdf-page-error">
          {error}
        </p>
      ) : near && !rendered ? (
        <span role="status" className="pdf-page-loading">
          Đang đọc trang {number}…
        </span>
      ) : null}
    </div>
  )
})
export function PDFReader({ url, boardZoom = 1 }: { url: string; boardZoom?: number }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null),
    [initialSize, setInitialSize] = useState<PageSize>({ width: 595, height: 842 }),
    [page, setPage] = useState(1),
    [scale, setScale] = useState(1),
    [error, setError] = useState(''),
    [ready, setReady] = useState(false)
  const [dpr, setDpr] = useState(() => devicePixelRatio || 1),
    [density, setDensity] = useState(() =>
      Math.min(6, Math.max(2, Math.ceil((devicePixelRatio || 1) * Math.max(1, boardZoom) * 2))),
    )
  const host = useRef<HTMLDivElement>(null),
    scrollFrame = useRef<number | null>(null),
    zoomPosition = useRef<{ x: number; y: number } | null>(null)
  const onRendered = useCallback(() => setReady(true), [])
  useEffect(() => {
    let dead = false,
      task: any
    setError('')
    setReady(false)
    setPdf(null)
    setPage(1)
    import('pdfjs-dist')
      .then((lib) => {
        if (dead) return
        lib.GlobalWorkerOptions.workerSrc = workerUrl
        task = lib.getDocument({
          url,
          cMapUrl: '/pdf-assets/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: '/pdf-assets/standard_fonts/',
          wasmUrl: '/pdf-assets/wasm/',
        })
        task.promise
          .then(async (doc: PDFDocumentProxy) => {
            const first = await doc.getPage(1),
              viewport = first.getViewport({ scale: 1 })
            if (!dead) {
              setInitialSize({ width: viewport.width, height: viewport.height })
              setPdf(doc)
            }
          })
          .catch((e: Error) => {
            if (!dead) setError(e.message)
          })
      })
      .catch((e) => {
        if (!dead) setError(e.message)
      })
    return () => {
      dead = true
      void task?.destroy()
    }
  }, [url])
  useEffect(() => {
    let query: MediaQueryList
    const update = () => {
      const next = devicePixelRatio || 1
      setDpr(next)
      query?.removeEventListener('change', update)
      query = matchMedia(`(resolution: ${next}dppx)`)
      query.addEventListener('change', update)
    }
    update()
    addEventListener('resize', update)
    return () => {
      removeEventListener('resize', update)
      query.removeEventListener('change', update)
    }
  }, [])
  useEffect(() => {
    const timer = setTimeout(
      () => setDensity(Math.min(6, Math.max(2, Math.ceil(dpr * Math.max(1, boardZoom) * 2)))),
      120,
    )
    return () => clearTimeout(timer)
  }, [dpr, boardZoom])
  useEffect(
    () => () => {
      if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current)
    },
    [],
  )
  useLayoutEffect(() => {
    if (host.current && zoomPosition.current) {
      host.current.scrollLeft = zoomPosition.current.x
      host.current.scrollTop = zoomPosition.current.y
      zoomPosition.current = null
    }
  }, [scale])
  function scroll() {
    if (scrollFrame.current !== null) return
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null
      const root = host.current
      if (!root) return
      const anchor = root.scrollTop + Math.min(64, root.clientHeight * 0.25)
      let current = 1
      for (const element of root.querySelectorAll<HTMLElement>('[data-pdf-page]')) {
        if (element.offsetTop > anchor) break
        current = Number(element.dataset.pdfPage)
      }
      setPage(current)
    })
  }
  function go(next: number) {
    const root = host.current,
      target = root?.querySelector<HTMLElement>(`[data-pdf-page="${next}"]`)
    if (root && target) {
      root.scrollTop = target.offsetTop
      setPage(next)
    }
  }
  function zoom(next: number) {
    const root = host.current
    if (root)
      zoomPosition.current = {
        x: Math.max(
          0,
          ((root.scrollLeft + root.clientWidth / 2) * next) / scale - root.clientWidth / 2,
        ),
        y: Math.max(
          0,
          ((root.scrollTop + root.clientHeight / 2) * next) / scale - root.clientHeight / 2,
        ),
      }
    setScale(next)
  }
  return (
    <>
      <div className="reader-controls">
        <ReaderPager page={page} total={pdf?.numPages || 0} change={go} />
        <button
          className="icon-btn"
          aria-label="Thu nhỏ tài liệu"
          disabled={scale <= 0.5}
          onClick={() => zoom(Math.max(0.5, scale - 0.25))}
        >
          <Minus size={14} />
        </button>
        <span>{Math.round(scale * 100)}%</span>
        <button
          className="icon-btn"
          aria-label="Phóng to tài liệu"
          disabled={scale >= 2}
          onClick={() => zoom(Math.min(2, scale + 0.25))}
        >
          <Plus size={14} />
        </button>
      </div>
      {error ? (
        <p role="alert" className="reader-error">
          {error}
        </p>
      ) : !pdf ? (
        <p className="reader-status" role="status">
          Đang mở PDF…
        </p>
      ) : null}
      <div
        className="reader-scroll pdf-scroll pdf-continuous"
        data-ready={ready}
        ref={host}
        onScroll={scroll}
      >
        {pdf &&
          Array.from({ length: pdf.numPages }, (_, index) => (
            <PDFPage
              key={index}
              pdf={pdf}
              number={index + 1}
              scale={scale}
              density={density}
              initialSize={initialSize}
              scrollRoot={host}
              onRendered={onRendered}
            />
          ))}
      </div>
    </>
  )
}
