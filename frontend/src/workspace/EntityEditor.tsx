import { useState } from 'react'
import { X, Trash2, Play, Clock3, Check } from 'lucide-react'
import { api } from '../api'
import { Button, Field } from '../ui'

type Item = Record<string, any>
const TZ = 'Asia/Ho_Chi_Minh'
const kinds: Item = {
  tasks: 'công việc',
  courses: 'môn học',
  projects: 'đồ án',
  deadlines: 'deadline',
  events: 'lịch cố định',
  blocks: 'buổi làm',
  notes: 'ghi chú',
  sessions: 'thời gian đã làm',
}
const inputDate = (v: string) =>
  v ? new Date(v).toLocaleString('sv-SE', { timeZone: TZ }).replace(' ', 'T').slice(0, 16) : ''
const iso = (v: string) => (v ? (v.length === 10 ? v : v + ':00+07:00') : null)

export function EntityEditor({
  editor,
  error,
  saveDraft,
  data,
  close,
  busy,
  action,
  startTimer,
  recordWork,
}: any) {
  const kind = editor.kind,
    existing = !!editor.id
  const [form, setForm] = useState<Item>(() => ({
    title: '',
    description: '',
    deadline_time: editor.due_at ? inputDate(editor.due_at).slice(11, 16) : '23:59',
    priority: 2,
    status: kind === 'blocks' ? 'planned' : 'todo',
    estimate_minutes: '',
    start: inputDate(editor.start || new Date().toISOString()),
    end: inputDate(editor.end || new Date(Date.now() + 3600000).toISOString()),
    due_at: '',
    depends_on: [],
    checklist: [],
    ...editor,
    ...(editor.due_at ? { due_at: inputDate(editor.due_at) } : {}),
    ...(editor.start
      ? {
          start: editor.all_day ? editor.start.slice(0, 10) : inputDate(editor.start),
          end: editor.all_day ? editor.end.slice(0, 10) : inputDate(editor.end),
        }
      : {}),
  }))
  const [checkText, setCheckText] = useState(
      (editor.checklist || []).map((c: Item) => c.text).join('\n'),
    ),
    [onlyOccurrence, setOnlyOccurrence] = useState(
      !!editor.recurrence?.length && !!editor.occurrence,
    )
  const set = (k: string, v: any) => setForm({ ...form, [k]: v })
  const field = (label: string, k: string, type = 'text', required = false) => (
    <Field label={label}>
      <input
        required={required}
        type={type}
        value={form[k] ?? ''}
        onChange={(e) => set(k, e.target.value)}
        min={type === 'number' ? 1 : undefined}
      />
    </Field>
  )
  const relation = (label: string, k: string, source: string, filter?: (a: Item) => boolean) => (
    <Field label={label}>
      <select value={form[k] || ''} onChange={(e) => set(k, e.target.value || null)}>
        <option value="">Không chọn</option>
        {data[source].filter(filter || (() => true)).map((i: Item) => (
          <option key={i.id} value={i.id}>
            {i.title}
          </option>
        ))}
      </select>
    </Field>
  )
  async function save(e: any) {
    e.preventDefault()
    let payload: Item = { title: form.title, description: form.description || '' }
    const fields: Item = {
      courses: ['color', 'semester'],
      projects: ['course_id', 'status'],
      deadlines: ['course_id', 'project_id', 'due_at', 'done', 'color'],
      tasks: [
        'course_id',
        'project_id',
        'deadline_id',
        'parent_id',
        'status',
        'priority',
        'estimate_minutes',
        'due_at',
        'depends_on',
        'checklist',
      ],
      events: ['start', 'end', 'recurrence', 'exceptions', 'busy', 'all_day', 'color'],
      blocks: ['start', 'end', 'task_id', 'locked', 'status'],
      notes: ['course_id', 'project_id'],
      sessions: ['task_id', 'minutes', 'note'],
    }
    for (const key of fields[kind]) if (form[key] !== undefined) payload[key] = form[key]
    if (kind === 'projects' && !['active', 'done', 'archived'].includes(payload.status))
      payload.status = 'active'
    for (const key of ['start', 'end', 'due_at'])
      if (key in payload) payload[key] = iso(payload[key])
    if (kind === 'deadlines' && payload.due_at)
      payload.due_at =
        payload.due_at.slice(0, 10) + 'T' + (form.deadline_time || '23:59') + ':00+07:00'
    if (kind === 'tasks') {
      payload.estimate_minutes = payload.estimate_minutes ? Number(payload.estimate_minutes) : null
      payload.priority = Number(payload.priority)
      payload.checklist = checkText
        .split('\n')
        .filter((s: string) => s.trim())
        .map((text: string) => ({
          text: text.trim(),
          done: form.checklist?.find((c: Item) => c.text === text.trim())?.done || false,
        }))
    }
    if (kind === 'sessions') {
      payload = { task_id: form.task_id, minutes: Number(form.minutes), note: form.note || '' }
    }
    if (kind === 'events' && onlyOccurrence) {
      payload = {
        exceptions: {
          ...editor.exceptions,
          [editor.occurrence_key || editor.occurrence]: {
            start: iso(form.start),
            end: iso(form.end),
          },
        },
      }
    }
    const r = editor.draft
      ? await saveDraft(payload)
      : await action(() =>
          api('/' + kind + (existing ? '/' + editor.id : ''), existing ? 'PATCH' : 'POST', payload),
        )
    if (r) close()
  }
  async function remove() {
    let fn = () => api('/' + kind + '/' + editor.id, 'DELETE')
    if (kind === 'events' && onlyOccurrence)
      fn = () =>
        api('/events/' + editor.id, 'PATCH', {
          exceptions: { ...editor.exceptions, [editor.occurrence_key || editor.occurrence]: null },
        })
    if (await action(fn, 'Đã gỡ dữ liệu')) close()
  }
  const readOnly = editor.readonly
  return (
    <div className="modal-backdrop" onClick={close}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={(existing ? 'Sửa ' : 'Thêm ') + kinds[kind]}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">KHÔNG GIAN CỦA BẠN</span>
            <h2>
              {existing ? 'Sửa ' : 'Thêm '}
              {kinds[kind]}
            </h2>
          </div>
          <button className="icon-btn" aria-label="Đóng biểu mẫu" onClick={close}>
            <X />
          </button>
        </div>
        <form onSubmit={save}>
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          <fieldset disabled={readOnly}>
            <div className="form-grid">
              {kind !== 'sessions' && (
                <Field label="Tên" wide>
                  <input
                    autoFocus
                    required
                    value={form.title}
                    onChange={(e) => set('title', e.target.value)}
                    placeholder={'Tên ' + kinds[kind] + '…'}
                  />
                </Field>
              )}
              {['projects', 'deadlines', 'notes'].includes(kind) &&
                relation('Môn học', 'course_id', 'courses')}
              {['deadlines', 'notes'].includes(kind) &&
                relation('Đồ án / bài tập', 'project_id', 'projects')}
              {kind === 'courses' && (
                <>
                  {field('Học kỳ', 'semester')}
                  <Field label="Màu môn học">
                    <input
                      type="color"
                      value={form.color || '#476953'}
                      onChange={(e) => set('color', e.target.value)}
                    />
                  </Field>
                </>
              )}
              {kind === 'projects' && (
                <Field label="Trạng thái">
                  <select
                    value={
                      ['active', 'done', 'archived'].includes(form.status) ? form.status : 'active'
                    }
                    onChange={(e) => set('status', e.target.value)}
                  >
                    <option value="active">Đang thực hiện</option>
                    <option value="done">Hoàn thành</option>
                    <option value="archived">Lưu trữ</option>
                  </select>
                </Field>
              )}
              {kind === 'tasks' && (
                <>
                  {relation('Mốc deadline', 'deadline_id', 'deadlines')}
                  <details className="disclosure form-details wide">
                    <summary>Thông tin thêm</summary>
                    <div className="form-grid disclosure-body">
                      {field('Thời lượng dự kiến (phút)', 'estimate_minutes', 'number')}
                      <Field label="Mức quan trọng">
                        <select
                          value={form.priority}
                          onChange={(e) => set('priority', Number(e.target.value))}
                        >
                          {[4, 3, 2, 1].map((n) => (
                            <option key={n} value={n}>
                              {n === 4
                                ? 'Rất cao'
                                : n === 3
                                  ? 'Cao'
                                  : n === 2
                                    ? 'Bình thường'
                                    : 'Thấp'}
                            </option>
                          ))}
                        </select>
                      </Field>
                      {field('Hạn riêng (nếu có)', 'due_at', 'datetime-local')}
                      {relation('Môn học', 'course_id', 'courses')}
                      {relation('Đồ án / bài tập', 'project_id', 'projects')}
                      {relation(
                        'Thuộc công việc cha',
                        'parent_id',
                        'tasks',
                        (t: Item) => t.id !== editor.id,
                      )}
                      <Field label="Trạng thái">
                        <select value={form.status} onChange={(e) => set('status', e.target.value)}>
                          <option value="todo">Chưa làm</option>
                          <option value="doing">Đang làm</option>
                          <option value="done">Hoàn thành</option>
                          <option value="cancelled">Đã hủy</option>
                        </select>
                      </Field>
                      <Field label="Cần hoàn thành trước công việc này" wide>
                        <select
                          multiple
                          value={form.depends_on || []}
                          onChange={(e) =>
                            set(
                              'depends_on',
                              Array.from(e.target.selectedOptions, (o) => o.value),
                            )
                          }
                        >
                          {data.tasks
                            .filter((t: Item) => t.id !== editor.id)
                            .map((t: Item) => (
                              <option key={t.id} value={t.id}>
                                {t.title}
                              </option>
                            ))}
                        </select>
                        <small>Giữ Ctrl để chọn nhiều bước hoặc bỏ chọn.</small>
                      </Field>
                      <Field label="Checklist (mỗi dòng một mục)" wide>
                        <textarea
                          value={checkText}
                          onChange={(e) => setCheckText(e.target.value)}
                          rows={3}
                        />
                      </Field>
                    </div>
                  </details>
                </>
              )}
              {kind === 'deadlines' && (
                <>
                  <Field label="Hạn hoàn thành">
                    <input
                      type="date"
                      required
                      value={form.due_at?.slice(0, 10) || ''}
                      onChange={(e) => set('due_at', e.target.value)}
                    />
                    <small>Hiện ở hàng Cả ngày trên lịch.</small>
                  </Field>
                  <details className="disclosure form-details">
                    <summary>Giờ nộp cụ thể</summary>
                    <div className="disclosure-body">
                      <Field label="Giờ nộp">
                        <input
                          type="time"
                          value={form.deadline_time || '23:59'}
                          onChange={(e) => set('deadline_time', e.target.value)}
                        />
                        <small>Mặc định 23:59. Giữ đúng giờ nếu thông báo có nêu.</small>
                      </Field>
                    </div>
                  </details>
                </>
              )}
              {kind === 'events' && (
                <label className="check-label wide">
                  <input
                    type="checkbox"
                    checked={!!form.all_day}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        all_day: e.target.checked,
                        start: e.target.checked
                          ? form.start.slice(0, 10)
                          : form.start.slice(0, 10) + 'T09:00',
                        end: e.target.checked
                          ? form.end.slice(0, 10)
                          : form.end.slice(0, 10) + 'T10:00',
                      })
                    }
                  />
                  Cả ngày
                </label>
              )}
              {['events', 'blocks'].includes(kind) && (
                <>
                  {field('Bắt đầu', 'start', form.all_day ? 'date' : 'datetime-local', true)}
                  {field(
                    form.all_day ? 'Kết thúc (không gồm ngày này)' : 'Kết thúc',
                    'end',
                    form.all_day ? 'date' : 'datetime-local',
                    true,
                  )}
                </>
              )}
              {kind === 'events' && (
                <>
                  <Field label="Lặp lại">
                    <select
                      value={form.recurrence?.length ? 'weekly' : 'none'}
                      onChange={(e) =>
                        set('recurrence', e.target.value === 'weekly' ? ['RRULE:FREQ=WEEKLY'] : [])
                      }
                    >
                      <option value="none">Không lặp</option>
                      <option value="weekly">Hằng tuần</option>
                    </select>
                  </Field>
                  {form.recurrence?.length > 0 && (
                    <Field label="Lặp đến ngày (tùy chọn)">
                      <input
                        type="date"
                        onChange={(e) =>
                          set('recurrence', [
                            'RRULE:FREQ=WEEKLY' +
                              (e.target.value
                                ? ';UNTIL=' + e.target.value.replaceAll('-', '') + 'T165959Z'
                                : ''),
                          ])
                        }
                      />
                    </Field>
                  )}
                  {editor.recurrence?.length > 0 && editor.occurrence && (
                    <label className="check-label wide">
                      <input
                        type="checkbox"
                        checked={onlyOccurrence}
                        onChange={(e) => setOnlyOccurrence(e.target.checked)}
                      />{' '}
                      Chỉ thay đổi giờ / gỡ buổi này trong chuỗi
                    </label>
                  )}
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={form.busy !== false}
                      onChange={(e) => set('busy', e.target.checked)}
                    />{' '}
                    Chiếm giờ bận
                  </label>
                </>
              )}
              {['blocks', 'sessions'].includes(kind) &&
                relation(
                  'Công việc',
                  'task_id',
                  'tasks',
                  (t: Item) => !data.tasks.some((c: Item) => c.parent_id === t.id),
                )}
              {kind === 'blocks' && (
                <>
                  <Field label="Trạng thái buổi">
                    <select value={form.status} onChange={(e) => set('status', e.target.value)}>
                      <option value="planned">Đã lên lịch</option>
                      <option value="done">Đã xong buổi</option>
                      <option value="missed">Đã lỡ</option>
                    </select>
                  </Field>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={!!form.locked}
                      onChange={(e) => set('locked', e.target.checked)}
                    />{' '}
                    Khóa buổi, giữ giờ khi xếp lại
                  </label>
                  <p className="muted wide">Xong buổi chưa tự hoàn thành công việc.</p>
                </>
              )}
              {kind === 'sessions' && field('Số phút đã làm', 'minutes', 'number', true)}
              <Field label={kind === 'sessions' ? 'Ghi chú' : 'Mô tả / ghi chú'} wide>
                <textarea
                  rows={kind === 'notes' ? 8 : 3}
                  value={kind === 'sessions' ? form.note || '' : form.description}
                  onChange={(e) =>
                    set(kind === 'sessions' ? 'note' : 'description', e.target.value)
                  }
                />
              </Field>
            </div>
          </fieldset>
          {readOnly && (
            <p className="muted">Lịch này được đọc từ Google. Hãy sửa trong Google Calendar.</p>
          )}
          <div className="modal-footer">
            {existing && !readOnly && !editor.draft && (
              <button type="button" className="icon-btn delete" aria-label="Xóa" onClick={remove}>
                <Trash2 size={18} />
              </button>
            )}
            {kind === 'tasks' &&
              existing &&
              !readOnly &&
              !editor.draft &&
              !data.tasks.some((t: Item) => t.parent_id === editor.id) && (
                <div className="button-row">
                  <Button subtle onClick={() => startTimer(editor.id)}>
                    <Play size={15} /> Tập trung
                  </Button>
                  <Button subtle onClick={() => recordWork(editor.id)}>
                    <Clock3 size={15} /> Ghi thời gian
                  </Button>
                </div>
              )}
            <div className="spacer" />
            <Button subtle onClick={close}>
              Đóng
            </Button>
            {!readOnly && (
              <Button type="submit" disabled={busy}>
                <Check size={16} /> Lưu
              </Button>
            )}
          </div>
        </form>
      </section>
    </div>
  )
}
