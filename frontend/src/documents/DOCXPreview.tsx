import { useEffect, useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { ReaderPager as Pager } from './ReaderPager'
import { readBytes } from './files'
export function DOCXPreview({ url, buffer }: { url: string; buffer?: ArrayBuffer }) {
  const [html, setHtml] = useState(''),
    [error, setError] = useState(''),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [scale, setScale] = useState(1)
  const frame = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    const controller = new AbortController()
    setHtml('')
    setError('')
    Promise.all([
      buffer ? Promise.resolve(buffer) : readBytes(url, controller.signal),
      import('docx-preview'),
    ])
      .then(async ([data, docx]) => {
        const content = document.createElement('div')
        await docx.renderAsync(data, content, undefined, {
          inWrapper: true,
          breakPages: true,
          ignoreLastRenderedPageBreak: false,
          useBase64URL: true,
        })
        if (controller.signal.aborted) return
        setTotal(content.querySelectorAll('section.docx').length || 1)
        setHtml(
          '<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; img-src data: blob:; style-src &#39;unsafe-inline&#39;; font-src data: blob:;"><style>body{margin:0;background:#e9e9e9}html{scrollbar-width:thin;scrollbar-color:#888 transparent}.docx-wrapper{padding:0!important;background:transparent!important}section.docx{box-shadow:none!important;margin-bottom:8px!important}section.docx:last-child{margin-bottom:0!important}*{box-sizing:border-box}</style></head><body>' +
            content.innerHTML +
            '</body></html>',
        )
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message)
      })
    return () => controller.abort()
  }, [url, buffer])
  function zoom(value: number) {
    setScale(value)
    if (frame.current?.contentDocument)
      frame.current.contentDocument.body.style.zoom = String(value)
  }
  function go(next: number) {
    setPage(next)
    const win = frame.current?.contentWindow,
      section = frame.current?.contentDocument?.querySelectorAll('section.docx')[next - 1]
    if (win && section)
      win.scrollTo({
        left: 0,
        top: section.getBoundingClientRect().top + win.scrollY,
      })
  }
  function ready() {
    const win = frame.current?.contentWindow,
      doc = frame.current?.contentDocument,
      section = doc?.querySelector('section.docx')
    if (!win || !section) return
    const fit = Math.max(
      0.25,
      Math.min(1, doc!.documentElement.clientWidth / section.getBoundingClientRect().width),
    )
    zoom(fit)
    win.onscroll = () => {
      const sections = Array.from(doc!.querySelectorAll('section.docx'))
      const i = sections.findIndex((el) => el.getBoundingClientRect().bottom > 30)
      if (i >= 0) setPage(i + 1)
    }
  }
  return (
    <>
      <div className="reader-controls">
        <Pager page={page} total={total} change={go} />
        <button
          className="icon-btn"
          aria-label="Thu nhỏ tài liệu"
          disabled={scale <= 0.25}
          onClick={() => zoom(Math.max(0.25, scale - 0.25))}
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
        <p className="reader-error" role="alert">
          {error}
        </p>
      ) : !html ? (
        <p role="status">Đang đọc DOCX…</p>
      ) : (
        <iframe
          ref={frame}
          sandbox="allow-same-origin"
          title="Nội dung DOCX"
          srcDoc={html}
          className="docx-frame"
          onLoad={ready}
        />
      )}
    </>
  )
}
