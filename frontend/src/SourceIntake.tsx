import { useEffect, useRef, useState } from 'react'
import { Check, FileText, LoaderCircle, Plus, Upload, X } from 'lucide-react'
import { api } from './api'

type Item = Record<string, any>
type Props = {
  context: Item | null
  initialFiles: File[]
  courses: Item[]
  close: () => void
  onChanged: () => Promise<void>
  onAnalyze: (text: string, context: Item | null, documentIds: string[]) => void
}
const valid = /\.(pdf|docx|xlsx|txt|md|markdown|png|jpe?g|webp)$/i

export function SourceIntake({
  context,
  initialFiles,
  courses,
  close,
  onChanged,
  onAnalyze,
}: Props) {
  const [files, setFiles] = useState<File[]>(initialFiles),
    [text, setText] = useState(''),
    [title, setTitle] = useState('Tin nhắn giảng viên')
  const [courseId, setCourseId] = useState(
    context?.kind === 'courses' ? context.id : context?.course_id || '',
  )
  const [analyze, setAnalyze] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [progress, setProgress] = useState('')
  const [uploaded, setUploaded] = useState<string[]>([])
  const input = useRef<HTMLInputElement>(null),
    dialog = useRef<HTMLElement>(null),
    opener = useRef(document.activeElement as HTMLElement | null)
  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('button')?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.stopImmediatePropagation()
        close()
      }
      if (e.key !== 'Tab') return
      const nodes = Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled)',
        ) || [],
      ).filter((n) => n.getClientRects().length)
      if (e.shiftKey && document.activeElement === nodes[0]) {
        e.preventDefault()
        nodes.at(-1)?.focus()
      } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
        e.preventDefault()
        nodes[0]?.focus()
      }
    }
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('keydown', key, true)
      opener.current?.focus()
    }
  }, [busy, close])
  function add(next: File[]) {
    setError('')
    if (next.some((f) => !valid.test(f.name))) {
      setError('Chọn PDF, DOCX, XLSX, TXT, Markdown hoặc ảnh PNG, JPG, WebP.')
      return
    }
    if (next.some((f) => f.size > 50 * 1024 * 1024)) {
      setError('Mỗi file cần nhỏ hơn hoặc bằng 50 MB.')
      return
    }
    setFiles((old) => [
      ...old,
      ...next.filter(
        (f) =>
          !old.some(
            (o) => o.name === f.name && o.size === f.size && o.lastModified === f.lastModified,
          ),
      ),
    ])
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy || (!files.length && !text.trim())) return
    if (files.some((f) => !valid.test(f.name) || f.size > 50 * 1024 * 1024)) {
      setError('Kiểm tra loại file và giới hạn 50 MB trước khi gửi.')
      return
    }
    setBusy(true)
    setError('')
    const sources = [...files]
    if (text.trim())
      sources.push(
        new File(
          [`# ${title.trim() || 'Tin nhắn giảng viên'}\n\n${text.trim()}`],
          (title.trim() || 'tin-nhan') + '.md',
          { type: 'text/markdown' },
        ),
      )
    const ids = [...uploaded]
    try {
      for (let index = ids.length; index < sources.length; index++) {
        setProgress(`Đang thêm nguồn ${index + 1}/${sources.length}…`)
        const form = new FormData()
        form.append('file', sources[index])
        if (courseId) form.append('course_id', courseId)
        if (context && ['tasks', 'deadlines', 'projects'].includes(context.kind)) {
          form.append('work_kind', context.kind)
          form.append('work_id', context.id)
        }
        const result = await api('/knowledge/upload', 'POST', form)
        ids.push(result.id)
        setUploaded([...ids])
      }
      await onChanged()
      if (analyze) {
        const course = courses.find((c) => c.id === courseId)
        const scope =
          context && context.kind !== 'courses'
            ? context
            : course
              ? { kind: 'courses', id: course.id, title: course.title }
              : null
        onAnalyze(
          `Đọc và tổng hợp ${ids.length} nguồn tôi vừa thêm. ${scope ? 'Ngữ cảnh: ' + scope.title + '. ' : ''}Nhận diện môn và deadline, ghi nguồn trong mô tả, thêm đầu việc cần thiết và giải thích thứ tự ưu tiên. Thêm hoặc cập nhật đúng deadline đang có, tránh trùng. Nếu hạn chưa rõ hoặc mâu thuẫn, hỏi tôi phần còn thiếu. Không tự xếp buổi học.`,
          scope,
          ids,
        )
      }
      close()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
      setProgress('')
    }
  }
  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!busy) close()
      }}
    >
      <section
        className="modal intake-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Thêm nguồn cho Codex"
        ref={dialog}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <h2>Đưa tài liệu vào, để Codex sắp xếp</h2>
            <p>
              {context
                ? 'Gắn với ' + context.title
                : 'Thêm đề bài, tài liệu hoặc tin nhắn từ giảng viên.'}
            </p>
          </div>
          <button className="icon-btn" aria-label="Đóng thêm nguồn" disabled={busy} onClick={close}>
            <X size={20} />
          </button>
        </div>
        <form onSubmit={submit}>
          <fieldset disabled={busy || uploaded.length > 0}>
            <div
              className="intake-drop"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                add(Array.from(e.dataTransfer.files))
              }}
            >
              <Upload size={24} />
              <div>
                <button type="button" className="text-btn" onClick={() => input.current?.click()}>
                  Chọn file
                </button>
                <span> hoặc kéo thả vào đây</span>
                <small>PDF, DOCX, XLSX, TXT, Markdown, PNG, JPG, WebP · Tối đa 50 MB/file</small>
              </div>
              <input
                type="file"
                ref={input}
                hidden
                multiple
                aria-label="Chọn tài liệu và ảnh"
                accept=".pdf,.docx,.xlsx,.txt,.md,.markdown,.png,.jpg,.jpeg,.webp"
                onChange={(e) => {
                  add(Array.from(e.target.files || []))
                  e.target.value = ''
                }}
              />
            </div>
            {files.length > 0 && (
              <ul className="intake-files">
                {files.map((file, index) => (
                  <li key={index}>
                    <FileText size={17} />
                    <span>{file.name}</span>
                    <small>{Math.max(1, Math.round(file.size / 1024))} KB</small>
                    {index < uploaded.length ? (
                      <Check size={17} />
                    ) : (
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={'Gỡ ' + file.name}
                        onClick={() => setFiles(files.filter((_, i) => i !== index))}
                      >
                        <X size={15} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <label className="field">
              <span>Tin nhắn hoặc yêu cầu</span>
              <textarea
                aria-label="Tin nhắn hoặc yêu cầu của giảng viên"
                placeholder="Dán nguyên tin nhắn, đề bài hoặc đường dẫn nguồn vào đây…"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={5}
                maxLength={100000}
                onPaste={(e) => {
                  if (e.clipboardData.files.length) {
                    e.preventDefault()
                    add(Array.from(e.clipboardData.files))
                  }
                }}
              />
            </label>
            <div className="intake-meta">
              <label className="field">
                <span>Tên nguồn</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={180} />
              </label>
              <label className="field">
                <span>Môn học</span>
                <select
                  aria-label="Môn học của nguồn"
                  value={courseId}
                  onChange={(e) => setCourseId(e.target.value)}
                  disabled={!!context && context.kind !== 'courses'}
                >
                  <option value="">Để Codex nhận diện</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="check-label intake-analyze">
              <input
                type="checkbox"
                checked={analyze}
                onChange={(e) => setAnalyze(e.target.checked)}
              />
              Nhờ Codex tổng hợp và cập nhật deadline
            </label>
            <p className="intake-note">
              Ảnh được đọc qua Codex. Đường dẫn được lưu làm nguồn; nội dung phía sau đường dẫn chưa
              được tải tự động.
            </p>
          </fieldset>
          {error && (
            <p role="alert" className="chat-error">
              {error}
              {uploaded.length > 0
                ? ' Các nguồn đã thêm được giữ lại; thử lại sẽ tiếp tục từ nguồn còn thiếu.'
                : ''}
            </p>
          )}
          <div className="modal-footer">
            {busy && (
              <span className="intake-progress" role="status">
                <LoaderCircle className="spin" size={16} />
                {progress}
              </span>
            )}
            <div className="spacer" />
            <button type="button" className="btn subtle" disabled={busy} onClick={close}>
              Đóng
            </button>
            <button
              className="btn"
              type="submit"
              disabled={busy || (!files.length && !text.trim())}
            >
              <Plus size={16} />
              {analyze ? 'Thêm và tổng hợp' : 'Thêm nguồn'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
