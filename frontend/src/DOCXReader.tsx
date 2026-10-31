import { Download, Eye, Pencil, RotateCw, Save } from 'lucide-react'
import { DOCXPreview } from './documents/DOCXPreview'
import { useDocxEditor } from './documents/useDocxEditor'
import './docx-reader.css'

export function DOCXReader({
  id,
  title,
  url,
  boardZoom = 1,
}: {
  id: string
  title: string
  url: string
  boardZoom?: number
}) {
  const zoom = Math.max(0.1, boardZoom)
  const {
    mode,
    mountedFrame,
    frameEpoch,
    phase,
    ready,
    dirty,
    busy,
    saving,
    error,
    conflict,
    session,
    frame,
    save,
    switchMode,
    download,
    discard,
    retry,
  } = useDocxEditor(id, title, zoom)
  return (
    <div
      className="docx-reader"
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault()
          event.stopPropagation()
          void save()
        }
      }}
    >
      <div className="reader-controls docx-edit-controls">
        <div className="docx-mode-switch" role="group" aria-label="Chế độ DOCX">
          <button
            aria-pressed={mode === 'preview'}
            disabled={busy}
            onClick={() => switchMode('preview')}
          >
            <Eye size={13} />
            Xem trước
          </button>
          <button aria-pressed={mode === 'edit'} disabled={busy} onClick={() => switchMode('edit')}>
            <Pencil size={13} />
            Chỉnh sửa
          </button>
        </div>
        <span className="docx-save-state" role="status">
          {phase === 'loading'
            ? 'Đang mở…'
            : saving
              ? 'Đang lưu…'
              : dirty
                ? 'Chưa lưu'
                : ready
                  ? 'Đã lưu'
                  : ''}
        </span>
        {mountedFrame && (
          <button
            className="docx-save"
            disabled={!ready || !dirty || busy || conflict}
            onClick={save}
          >
            <Save size={13} />
            Lưu
          </button>
        )}
      </div>
      {error && !conflict && (
        <div className="reader-error docx-alert" role="alert">
          <span>{error}</span>
          <button className="text-btn" disabled={busy} onClick={retry}>
            <RotateCw size={13} />
            Thử mở lại
          </button>
        </div>
      )}
      {conflict && (
        <div className="reader-error docx-alert" role="alert">
          <span>File đã thay đổi ở nơi khác. Bản đang sửa vẫn được giữ.</span>
          <button className="text-btn" onClick={download}>
            <Download size={13} />
            Tải bản đang sửa
          </button>
          <button className="text-btn" disabled={busy} onClick={discard}>
            Bỏ bản sửa, tải bản mới
          </button>
        </div>
      )}
      {!mountedFrame && phase !== 'loading' && (
        <div className="docx-mode-content">
          <DOCXPreview url={url} />
        </div>
      )}
      {mountedFrame && (
        <div className="docx-frame-surface">
          <iframe
            key={frameEpoch}
            ref={frame}
            className="docx-edit-frame"
            title="Chỉnh sửa DOCX"
            sandbox="allow-scripts allow-same-origin allow-downloads"
            src={'/docx-editor.html?session=' + session}
            style={{
              width: `${zoom * 100}%`,
              height: `${zoom * 100}%`,
              transform: `scale(${1 / zoom})`,
            }}
          />
        </div>
      )}
      {phase === 'loading' && (
        <p className="reader-status" role="status">
          Đang mở trình chỉnh sửa DOCX…
        </p>
      )}
    </div>
  )
}
