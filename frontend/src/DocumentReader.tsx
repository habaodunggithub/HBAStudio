import { lazy, memo, Suspense, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, MoreHorizontal, RotateCw } from 'lucide-react'
import { api } from './api'
import { documentFileUrl, readBytes } from './documents/files'

// Load document engines only when a card of that type is opened.
const PDFReader = lazy(() =>
  import('./PDFReader').then((module) => ({ default: module.PDFReader })),
)
const DOCXReader = lazy(() =>
  import('./DOCXReader').then((module) => ({ default: module.DOCXReader })),
)
const MarkdownReader = lazy(() =>
  import('./MarkdownReader').then((module) => ({ default: module.MarkdownReader })),
)

type Item = Record<string, any>

function SheetReader({ id }: { id: string }) {
  const [sheet, setSheet] = useState(0),
    [row, setRow] = useState(0),
    [column, setColumn] = useState(0),
    [data, setData] = useState<Item | null>(null),
    [error, setError] = useState('')
  useEffect(() => {
    let dead = false
    setError('')
    setData(null)
    api(
      `/knowledge/documents/${encodeURIComponent(id)}/spreadsheet?sheet=${sheet}&row=${row}&column=${column}`,
    )
      .then((value) => {
        if (!dead) setData(value)
      })
      .catch((e) => {
        if (!dead) setError(e.message)
      })
    return () => {
      dead = true
    }
  }, [id, sheet, row, column])
  return (
    <>
      {error ? (
        <p role="alert" className="reader-error">
          {error}
        </p>
      ) : !data ? (
        <p role="status">Đang đọc bảng tính…</p>
      ) : (
        <>
          <div className="reader-controls">
            <label>
              Sheet{' '}
              <select
                aria-label="Chọn sheet"
                value={sheet}
                onChange={(e) => {
                  setSheet(Number(e.target.value))
                  setRow(0)
                  setColumn(0)
                }}
              >
                {data.sheets.map((name: string, i: number) => (
                  <option key={i} value={i}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <span>
              {data.rows} hàng · {data.columns} cột
            </span>
          </div>
          <div className="reader-scroll">
            <table className="reader-sheet">
              <thead>
                <tr>
                  <th />{' '}
                  {data.headers.map((name: string) => (
                    <th key={name}>{name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.values.map((cells: string[], i: number) => (
                  <tr key={i}>
                    <th>{row + i + 1}</th>
                    {cells.map((value, j) => (
                      <td key={j}>{value}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="reader-controls">
            <button
              className="icon-btn"
              aria-label="100 hàng trước"
              disabled={!row}
              onClick={() => setRow(Math.max(0, row - 100))}
            >
              <ChevronLeft size={15} />
            </button>
            <span>
              Hàng {row + 1}–{Math.min(row + 100, data.rows)}
            </span>
            <button
              className="icon-btn"
              aria-label="100 hàng tiếp"
              disabled={row + 100 >= data.rows}
              onClick={() => setRow(row + 100)}
            >
              <ChevronRight size={15} />
            </button>
            <button
              className="icon-btn"
              aria-label="40 cột trước"
              disabled={!column}
              onClick={() => setColumn(Math.max(0, column - 40))}
            >
              <ChevronLeft size={15} />
            </button>
            <span>
              Cột {data.headers[0]}–{data.headers.at(-1)}
            </span>
            <button
              className="icon-btn"
              aria-label="40 cột tiếp"
              disabled={column + 40 >= data.columns}
              onClick={() => setColumn(column + 40)}
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </>
      )}
    </>
  )
}
function TextReader({ url, image }: { url: string; image: boolean }) {
  const [text, setText] = useState(''),
    [error, setError] = useState('')
  useEffect(() => {
    if (image) return
    const controller = new AbortController()
    readBytes(url, controller.signal)
      .then((data) => setText(new TextDecoder().decode(data)))
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message)
      })
    return () => controller.abort()
  }, [url, image])
  return (
    <div className="reader-scroll">
      {error ? (
        <p role="alert">{error}</p>
      ) : image ? (
        <img className="reader-image" src={url} alt="Nội dung tài liệu" />
      ) : (
        <pre className="reader-text">{text}</pre>
      )}
    </div>
  )
}
export function DocumentMenu({ doc, reload }: { doc: Item; reload: () => void }) {
  const menu = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false
    }
    addEventListener('pointerdown', outside)
    return () => removeEventListener('pointerdown', outside)
  }, [])
  function close() {
    if (menu.current) menu.current.open = false
  }
  return (
    <details
      className="reader-menu"
      ref={menu}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          close()
          menu.current?.querySelector<HTMLElement>('summary')?.focus()
        }
      }}
    >
      <summary
        className="icon-btn"
        aria-label={'Tùy chọn tài liệu ' + doc.title}
        title="Tùy chọn tài liệu"
      >
        <MoreHorizontal size={16} />
      </summary>
      <div className="reader-menu-items">
        <a
          href={documentFileUrl(doc.id)}
          target="_blank"
          rel="noreferrer"
          aria-label={'Mở file gốc ' + doc.title}
          onClick={close}
        >
          <Download size={14} />
          Mở file gốc
        </a>
        <button
          onClick={() => {
            close()
            reload()
          }}
        >
          <RotateCw size={14} />
          Tải lại tài liệu
        </button>
      </div>
    </details>
  )
}
// Compare scalar document props, rather than fresh objects from workspace polling.
const ReaderContent = memo(function ReaderContent({
  id,
  title,
  url,
  extension,
  boardZoom,
}: {
  id: string
  title: string
  url: string
  extension: string
  boardZoom: number
}) {
  return (
    <div className="reader-content">
      {extension === 'pdf' ? (
        <PDFReader url={url} boardZoom={boardZoom} />
      ) : extension === 'docx' ? (
        <DOCXReader id={id} title={title} url={url} boardZoom={boardZoom} />
      ) : extension === 'xlsx' ? (
        <SheetReader id={id} />
      ) : ['md', 'markdown'].includes(extension) ? (
        <MarkdownReader id={id} title={title} />
      ) : (
        <TextReader url={url} image={['png', 'jpg', 'jpeg', 'webp'].includes(extension)} />
      )}
    </div>
  )
})
export function DocumentReader({ doc, boardZoom = 1 }: { doc: Item; boardZoom?: number }) {
  const extension = (doc.path || doc.title).split('.').at(-1).toLowerCase()
  return (
    <div
      className="document-reader"
      onWheel={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Suspense
        fallback={
          <p className="reader-status" role="status">
            Đang mở tài liệu…
          </p>
        }
      >
        <ReaderContent
          id={doc.id}
          title={doc.title}
          url={documentFileUrl(doc.id)}
          extension={extension}
          boardZoom={['pdf', 'docx'].includes(extension) ? boardZoom : 1}
        />
      </Suspense>
    </div>
  )
}
