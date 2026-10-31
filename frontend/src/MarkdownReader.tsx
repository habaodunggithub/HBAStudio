import { memo, useLayoutEffect, useRef, useState } from 'react'
import { Download, Eye, Pencil, Save } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useMarkdownDocument } from './documents/useMarkdownDocument'
import './markdown-reader.css'

// Parsing GFM is independent of save status, dragging and the board camera.
const MarkdownContent = memo(function MarkdownContent({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      components={{
        a: ({ node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
        img: ({ node, ...props }) => <img {...props} loading="lazy" referrerPolicy="no-referrer" />,
      }}
    >
      {text}
    </ReactMarkdown>
  )
})
export function MarkdownReader({ id, title }: { id: string; title: string }) {
  const {
    source,
    text,
    loading,
    saving,
    error,
    conflict,
    draftError,
    dirty,
    load,
    edit,
    save,
    download,
  } = useMarkdownDocument(id, title)
  const [mode, setMode] = useState<'preview' | 'edit'>('preview')
  const preview = useRef<HTMLDivElement>(null),
    editor = useRef<HTMLTextAreaElement>(null),
    scroll = useRef({ preview: 0, edit: 0 })
  useLayoutEffect(() => {
    const element = mode === 'preview' ? preview.current : editor.current
    if (element) element.scrollTop = scroll.current[mode]
  }, [mode])
  return (
    <div
      className="markdown-reader"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault()
          e.stopPropagation()
          void save()
        }
      }}
    >
      <div className="reader-controls markdown-controls">
        <div className="markdown-switch" role="group" aria-label="Chế độ Markdown">
          <button
            type="button"
            aria-pressed={mode === 'preview'}
            onClick={() => setMode('preview')}
          >
            <Eye size={13} />
            Xem trước
          </button>
          <button type="button" aria-pressed={mode === 'edit'} onClick={() => setMode('edit')}>
            <Pencil size={13} />
            Chỉnh sửa
          </button>
        </div>
        <span role="status" className="markdown-save-state">
          {saving ? 'Đang lưu…' : source ? (dirty ? 'Chưa lưu' : 'Đã lưu') : ''}
        </span>
        <button
          type="button"
          className="markdown-save"
          title="Lưu vào file gốc · Ctrl/Cmd+S"
          disabled={!dirty || saving || loading || conflict}
          onClick={save}
        >
          <Save size={13} />
          Lưu
        </button>
      </div>
      {(error || conflict) && (
        <div className="reader-error markdown-alert" role="alert">
          <span>
            {error ||
              (conflict ? 'File đã thay đổi ở nơi khác. Bản đang sửa của bạn vẫn được giữ.' : '')}
          </span>
          {conflict ? (
            <>
              <button className="text-btn" onClick={download}>
                <Download size={13} />
                Tải bản đang sửa
              </button>
              <button className="text-btn" disabled={loading || saving} onClick={() => load(true)}>
                Bỏ bản sửa, tải bản mới
              </button>
            </>
          ) : !source ? (
            <button className="text-btn" disabled={loading} onClick={() => load()}>
              Thử đọc lại
            </button>
          ) : null}
        </div>
      )}
      {draftError && dirty && (
        <p role="alert" className="reader-error">
          Chưa giữ được bản nháp trên máy. Hãy bấm Lưu trước khi đóng thẻ.
        </p>
      )}
      {loading && !source ? (
        <p className="reader-status" role="status">
          Đang đọc Markdown…
        </p>
      ) : source && mode === 'preview' ? (
        <div
          ref={preview}
          tabIndex={0}
          role="region"
          aria-label={'Xem trước Markdown ' + title}
          className="reader-scroll markdown-preview"
          onScroll={(e) => (scroll.current.preview = e.currentTarget.scrollTop)}
        >
          {text ? (
            <MarkdownContent text={text} />
          ) : (
            <p className="muted">File Markdown chưa có nội dung.</p>
          )}
        </div>
      ) : source ? (
        <textarea
          ref={editor}
          aria-label={'Nội dung Markdown ' + title}
          className="markdown-editor"
          value={text}
          disabled={saving || loading}
          spellCheck={false}
          maxLength={2 * 1024 * 1024}
          onChange={(e) => edit(e.target.value)}
          onScroll={(e) => (scroll.current.edit = e.currentTarget.scrollTop)}
        />
      ) : null}
    </div>
  )
}
