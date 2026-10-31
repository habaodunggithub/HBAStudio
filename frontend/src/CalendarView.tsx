import { useEffect, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/react/daygrid'
import timeGridPlugin from '@fullcalendar/react/timegrid'
import interactionPlugin from '@fullcalendar/react/interaction'
import classicThemePlugin from '@fullcalendar/react/themes/classic'
import viLocale from '@fullcalendar/react/locales/vi'
import {
  Plus,
  Palette,
  ChevronLeft,
  ChevronRight,
  X,
  LockKeyhole,
  Repeat2,
  ExternalLink,
} from 'lucide-react'
import { api } from './api'
import { Button, Field } from './ui'
import { GoogleSyncControls } from './GoogleSyncControls'
import './calendar.css'
type Item = Record<string, any>
const palette = [
  '#3f51b5',
  '#007f8b',
  '#8e24aa',
  '#b15b0b',
  '#1a73e8',
  '#b24c63',
  '#527a27',
  '#795548',
  '#5e65a8',
  '#237b65',
]
const colorKey = (event: Item) => `${event.kind}:${event.title.replace(/^⏳ /, '').trim()}`
function automaticColor(event: Item) {
  if (event.color) return event.color
  if (event.kind === 'deadlines') return '#b15b0b'
  if (event.kind === 'blocks') return '#527a27'
  let hash = 0
  for (const char of event.title) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return palette[hash % palette.length]
}
const contrast = (color: string) => {
  const rgb = [1, 3, 5]
    .map((i) => parseInt(color.slice(i, i + 2), 16) / 255)
    .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4))
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 0.179 ? '#151515' : '#ffffff'
}
const inputTime = (v: string) =>
  v.length === 10
    ? v
    : new Date(v)
        .toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' })
        .replace(' ', 'T')
        .slice(0, 16)
const dayAfter = (v: string) =>
  new Date(new Date(v + 'T00:00:00+07:00').getTime() + 86400000)
    .toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' })
    .slice(0, 10)
const iso = (v: string) => (v.length === 16 ? v + ':00+07:00' : v)
const eventKey = (e: Item) => e.kind + ':' + e.id + ':' + (e.occurrence_key || e.start)

export function CalendarView({ data, edit, open, action }: any) {
  const calendar = useRef<any>(null),
    lastFocus = useRef<HTMLElement | null>(null),
    moving = useRef(false)
  const [showColors, setShowColors] = useState(false),
    [events, setEvents] = useState<Item[]>([]),
    [range, setRange] = useState<Item | null>(null),
    [error, setError] = useState('')
  const [view, setView] = useState(
    () =>
      localStorage.getItem('pdm-calendar-view') ||
      (matchMedia('(max-width:760px)').matches ? 'timeGridDay' : 'timeGridWeek'),
  )
  const [title, setTitle] = useState(''),
    [selected, setSelected] = useState<Item | null>(null),
    [saving, setSaving] = useState(false),
    [refresh, setRefresh] = useState(0)
  const [form, setForm] = useState({ start: '', end: '' }),
    [visible, setVisible] = useState({ events: true, deadlines: true, blocks: false })
  useEffect(() => {
    if (!range || moving.current) return
    let active = true
    api(
      `/calendar?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}&include_blocks=${visible.blocks}`,
    )
      .then((result) => {
        if (active) {
          setEvents(result)
          if (!selected) setError('')
        }
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
    return () => {
      active = false
    }
  }, [range, data.revision, data.google.last_sync, refresh, visible.blocks])
  useEffect(() => {
    if (!selected) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDetail()
      if (e.key === 'Tab') {
        const nodes = Array.from(
          document.querySelectorAll<HTMLElement>(
            '.calendar-detail button:not(:disabled),.calendar-detail input:not(:disabled),.calendar-detail a[href]',
          ),
        )
        if (e.shiftKey && document.activeElement === nodes[0]) {
          e.preventDefault()
          nodes.at(-1)?.focus()
        } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
          e.preventDefault()
          nodes[0]?.focus()
        }
      }
    }
    const old = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    requestAnimationFrame(() =>
      document.querySelector<HTMLButtonElement>('.calendar-detail .icon-btn')?.focus(),
    )
    addEventListener('keydown', key)
    return () => {
      removeEventListener('keydown', key)
      document.body.style.overflow = old
    }
  }, [selected])
  const colors = data.settings.calendar_colors || {}
  const color = (e: Item) => colors[colorKey(e)] || automaticColor(e)
  const groups = [...new Map(events.map((e) => [colorKey(e), e])).values()].sort((a, b) =>
    a.title.localeCompare(b.title, 'vi'),
  )
  function closeDetail() {
    setSelected(null)
    setError('')
    requestAnimationFrame(() => lastFocus.current?.isConnected && lastFocus.current.focus())
  }
  function detail(event: Item, target: HTMLElement) {
    lastFocus.current = target
    setError('')
    setSelected(event)
    setForm({ start: inputTime(event.start), end: inputTime(event.end) })
  }
  function changeView(value: string) {
    calendar.current?.getApi().changeView(value)
    setView(value)
    localStorage.setItem('pdm-calendar-view', value)
  }
  async function move(
    item: Item,
    start: string,
    end: string,
    allDay: boolean,
    revert?: () => void,
  ) {
    if (moving.current) {
      revert?.()
      return null
    }
    moving.current = true
    setSaving(true)
    setError('')
    try {
      let success = false
      const result = await action(
        async () => {
          try {
            const value = await api(`/calendar/${item.kind}/${item.id}/move`, 'POST', {
              start: iso(start),
              end: iso(end),
              all_day: allDay,
              occurrence_key: item.occurrence_key || null,
              expected_start: item.start,
              expected_end: item.end,
            })
            success = true
            return value
          } catch (e: any) {
            if (selected) setError(e.message)
            throw e
          }
        },
        item.kind === 'deadlines' ? 'Đã đổi ngày deadline' : 'Đã đổi thời gian',
      )
      if (!success) {
        revert?.()
        return null
      }
      return result
    } finally {
      moving.current = false
      setSaving(false)
      setRefresh((n) => n + 1)
    }
  }
  function moved(arg: any) {
    const item = arg.oldEvent.extendedProps.item
    if (!item) {
      arg.revert()
      return
    }
    void move(
      item,
      arg.event.startStr,
      arg.event.endStr || dayAfter(arg.event.startStr.slice(0, 10)),
      arg.event.allDay,
      arg.revert,
    )
  }
  return (
    <>
      <header className="page-header">
        <div>
          <h1>Lịch của tôi</h1>
          <p>Lịch học, công việc và các mốc cần nhớ.</p>
        </div>
        <div className="header-actions">
          <Button
            subtle
            aria-expanded={showColors}
            aria-controls="calendar-colors"
            onClick={() => setShowColors(!showColors)}
          >
            <Palette size={16} />
            Màu lịch
          </Button>
          <Button onClick={() => edit('events')}>
            <Plus size={16} />
            Thêm sự kiện
          </Button>
        </div>
      </header>
      <GoogleSyncControls google={data.google} action={action} />
      <div className="calendar-toolbar">
        <div className="calendar-navigation">
          <Button subtle aria-label="Về hôm nay" onClick={() => calendar.current?.getApi().today()}>
            Hôm nay
          </Button>
          <button
            className="icon-btn"
            aria-label="Khoảng thời gian trước"
            onClick={() => calendar.current?.getApi().prev()}
          >
            <ChevronLeft size={19} />
          </button>
          <button
            className="icon-btn"
            aria-label="Khoảng thời gian sau"
            onClick={() => calendar.current?.getApi().next()}
          >
            <ChevronRight size={19} />
          </button>
          <h2>{title}</h2>
        </div>
        <div className="calendar-views" aria-label="Chế độ xem lịch">
          {[
            ['dayGridMonth', 'Tháng'],
            ['timeGridWeek', 'Tuần'],
            ['timeGridDay', 'Ngày'],
          ].map(([key, label]) => (
            <button key={key} aria-pressed={view === key} onClick={() => changeView(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="calendar-tools">
        <div>
          {[
            ['events', 'Sự kiện'],
            ['deadlines', 'Deadline'],
            ['blocks', 'Buổi làm'],
          ].map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={visible[key as keyof typeof visible]}
                onChange={(e) => setVisible({ ...visible, [key]: e.target.checked })}
              />
              {label}
            </label>
          ))}
        </div>
        <small>Kéo để dời · Kéo mép để đổi thời lượng · Nhấn giữ trên điện thoại</small>
      </div>
      {error && !selected && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      <div className={showColors ? 'calendar-layout with-colors' : 'calendar-layout'}>
        <section className="panel calendar-panel" aria-label="Lịch cá nhân">
          <FullCalendar
            ref={calendar}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, classicThemePlugin]}
            locale={viLocale}
            initialView={view}
            firstDay={1}
            timeZone="Asia/Ho_Chi_Minh"
            height={view === 'dayGridMonth' ? 'auto' : 'max(480px, calc(100dvh - 385px))'}
            scrollTime="08:00:00"
            views={{
              timeGridWeek: { titleFormat: { day: 'numeric', month: 'short', year: 'numeric' } },
              timeGridDay: { titleFormat: { weekday: 'long', day: 'numeric', month: 'long' } },
            }}
            slotMinTime="06:00:00"
            slotMaxTime="24:00:00"
            slotDuration="00:30:00"
            snapDuration="00:15:00"
            nowIndicator
            editable={!saving}
            selectable={!saving}
            selectMirror
            allDaySlot
            allDayText="Cả ngày"
            dayMaxEvents={4}
            headerToolbar={false}
            eventResizableFromStart
            longPressDelay={350}
            eventDragMinDistance={6}
            defaultTimedEventDuration="01:00:00"
            forceEventDuration
            datesSet={(arg: any) => {
              setRange({ start: arg.startStr, end: arg.endStr })
              setTitle(arg.view.title)
            }}
            events={events
              .filter((e) => visible[e.kind as keyof typeof visible])
              .map((e) => ({
                ...e,
                id: eventKey(e),
                editable: !saving && !e.readonly,
                eventDurationEditable: !saving && !e.readonly && e.kind !== 'deadlines',
                color: color(e),
                contrastColor: contrast(color(e)),
                className: 'nhip-calendar-event' + (e.readonly ? ' calendar-readonly' : ''),
                extendedProps: { item: e },
              }))}
            eventDidMount={(arg: any) => {
              const item = arg.event.extendedProps.item
              arg.el.dataset.calendarId = item.id
              arg.el.dataset.calendarKind = item.kind
              arg.el.setAttribute(
                'title',
                item.title +
                  (item.readonly
                    ? ' · Chỉ đọc'
                    : item.recurrence?.length
                      ? ' · Kéo để dời riêng buổi này'
                      : ' · Kéo để đổi thời gian'),
              )
            }}
            select={(arg: any) =>
              edit('events', { start: arg.startStr, end: arg.endStr, all_day: arg.allDay })
            }
            eventClick={(arg: any) => {
              const e = arg.event.extendedProps.item
              if (e) {
                if (e.kind === 'deadlines') open('deadlines', e.id)
                else detail(e, arg.el)
              }
            }}
            eventAllow={(drop: any, event: any) => {
              const item = event.extendedProps.item
              return (
                !item.readonly &&
                (item.kind !== 'deadlines' || drop.allDay) &&
                (item.kind !== 'blocks' || !drop.allDay) &&
                (!item.recurrence?.length || drop.allDay === !!item.all_day)
              )
            }}
            eventDrop={moved}
            eventResize={moved}
          />
        </section>
        {showColors && (
          <aside id="calendar-colors" className="calendar-inbox calendar-colors">
            <h2>Màu trên lịch</h2>
            <p>Các buổi cùng tên dùng chung một màu.</p>
            {groups.map((event) => (
              <label className="calendar-color-row" key={colorKey(event)}>
                <input
                  aria-label={'Màu ' + event.title.replace(/^⏳ /, '')}
                  type="color"
                  value={color(event)}
                  onChange={(e) =>
                    action(
                      () => api('/calendar/colors', 'PATCH', { [colorKey(event)]: e.target.value }),
                      'Đã đổi màu lịch',
                    )
                  }
                />
                <span>
                  {event.title.replace(/^⏳ /, '')}
                  <small>
                    {event.kind === 'deadlines'
                      ? 'Deadline · Cả ngày'
                      : event.kind === 'blocks'
                        ? 'Buổi làm'
                        : event.readonly
                          ? 'Google · Chỉ đọc'
                          : event.allDay
                            ? 'Sự kiện cả ngày'
                            : 'Sự kiện'}
                  </small>
                </span>
              </label>
            ))}
            {!groups.length && (
              <p className="muted">Màu của các sự kiện sẽ hiện khi lịch có dữ liệu.</p>
            )}
          </aside>
        )}
      </div>
      <p className="calendar-footnote">
        <LockKeyhole size={12} />
        Lịch Google bên ngoài chỉ đọc. Các thay đổi được gửi lên lịch riêng của HBA Studio.
      </p>
      {selected && (
        <div className="modal-backdrop" onClick={closeDetail}>
          <section
            className="modal calendar-detail"
            role="dialog"
            aria-modal="true"
            aria-label="Chi tiết sự kiện"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <span className="calendar-detail-kind">
                  {selected.readonly
                    ? 'Google · Chỉ đọc'
                    : selected.kind === 'deadlines'
                      ? 'Deadline'
                      : selected.kind === 'blocks'
                        ? 'Buổi làm'
                        : 'Sự kiện'}
                  {selected.recurrence?.length > 0 && (
                    <>
                      <Repeat2 size={12} />
                      Lịch lặp
                    </>
                  )}
                </span>
                <h2>{selected.title.replace(/^⏳ /, '')}</h2>
              </div>
              <button className="icon-btn" aria-label="Đóng chi tiết sự kiện" onClick={closeDetail}>
                <X size={19} />
              </button>
            </div>
            {selected.description && <p className="calendar-description">{selected.description}</p>}
            <form
              onSubmit={async (e) => {
                e.preventDefault()
                const end = selected.kind === 'deadlines' ? dayAfter(form.start) : form.end
                const result = await move(selected, form.start, end, selected.allDay)
                if (result) closeDetail()
              }}
            >
              <div className="form-grid">
                <Field label={selected.allDay ? 'Ngày bắt đầu' : 'Bắt đầu'}>
                  <input
                    required
                    disabled={selected.readonly || saving}
                    type={selected.allDay ? 'date' : 'datetime-local'}
                    value={form.start}
                    onChange={(e) => setForm({ ...form, start: e.target.value })}
                  />
                </Field>
                {selected.kind !== 'deadlines' && (
                  <Field
                    label={selected.allDay ? 'Ngày kết thúc (không gồm ngày này)' : 'Kết thúc'}
                  >
                    <input
                      required
                      disabled={selected.readonly || saving}
                      type={selected.allDay ? 'date' : 'datetime-local'}
                      value={form.end}
                      onChange={(e) => setForm({ ...form, end: e.target.value })}
                    />
                  </Field>
                )}
              </div>
              {!!selected.recurrence?.length && !selected.readonly && (
                <p className="hint">Đổi thời gian ở đây chỉ áp dụng cho buổi đang chọn.</p>
              )}
              {error && (
                <p className="alert error" role="alert">
                  {error}
                </p>
              )}
              <div className="calendar-detail-actions">
                {selected.google_event_url && (
                  <a
                    className="text-btn"
                    href={selected.google_event_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={13} />
                    Mở Google Calendar
                  </a>
                )}
                {selected.kind === 'deadlines' && (
                  <Button
                    subtle
                    onClick={() => {
                      const id = selected.id
                      closeDetail()
                      open('deadlines', id)
                    }}
                  >
                    Mở deadline
                  </Button>
                )}
                {!selected.readonly && (
                  <>
                    <Button
                      subtle
                      onClick={() => {
                        const item = selected
                        closeDetail()
                        edit(item.kind, data[item.kind].find((x: Item) => x.id === item.id) || item)
                      }}
                    >
                      {selected.recurrence?.length ? 'Sửa chuỗi lịch' : 'Sửa chi tiết'}
                    </Button>
                    <Button type="submit" disabled={saving}>
                      Lưu thời gian
                    </Button>
                  </>
                )}
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  )
}
