import { useEffect, useState } from 'react'
import {
  CalendarDays,
  Palette,
  Link2,
  FolderSearch,
  Sparkles,
  Download,
  Plus,
  X,
  RefreshCw,
  Upload,
  Trash2,
  FileText,
  UserRound,
} from 'lucide-react'
import { api } from './api'
import { Button, Field } from './ui'
import { ThemeOptions } from './theme'
import { GoogleSyncControls } from './GoogleSyncControls'
import { ConnectionsPage } from './connections/ConnectionsPage'

type Item = Record<string, any>
const sections = [
  ['schedule', 'Ưu tiên & nhắc việc', CalendarDays],
  ['appearance', 'Giao diện', Palette],
  ['google', 'Google Calendar', Link2],
  ['knowledge', 'Tài liệu', FolderSearch],
  ['connections', 'Tài khoản & kết nối', UserRound],
  ['backup', 'Sao lưu', Download],
] as const
const dateText = (value: string) =>
  new Date(value).toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

export function SettingsPage({ data, action, theme, embedded = false, onConnectionsChanged }: any) {
  const [section, setSection] = useState(() => {
    if (sessionStorage.getItem('pdm-open-google-settings')) {
      sessionStorage.removeItem('pdm-open-google-settings')
      return 'google'
    }
    return 'schedule'
  })
  const [settings, setSettings] = useState<Item>(data.settings)
  const [reminders, setReminders] = useState(data.settings.deadline_reminders.join(', '))
  const [path, setPath] = useState(''),
    [sourceName, setSourceName] = useState('')
  const [calendars, setCalendars] = useState<Item[]>([]),
    [calendarError, setCalendarError] = useState('')
  const [selection, setSelection] = useState<string[]>(data.google.selected_calendar_ids || [])
  const [backups, setBackups] = useState<Item[]>([])
  const update = (key: string, value: any) => setSettings({ ...settings, [key]: value })
  useEffect(() => {
    if (section === 'backup')
      api('/backups')
        .then(setBackups)
        .catch(() => {})
    if (section === 'google' && data.google.connected) {
      api('/google/calendars')
        .then((result) => {
          setCalendars(result.items || [])
          setCalendarError('')
        })
        .catch((error) => setCalendarError(error.message))
    }
  }, [section, data.google.connected])

  return (
    <>
      {!embedded && (
        <header className="page-header">
          <div>
            <h1>Cài đặt</h1>
            <p>Chọn nhóm cài đặt bạn muốn thay đổi.</p>
          </div>
        </header>
      )}
      <div className="settings-layout">
        <div
          className="settings-nav"
          role="tablist"
          aria-label="Nhóm cài đặt"
          aria-orientation="vertical"
        >
          {sections.map(([key, label, Icon]) => (
            <button
              key={key}
              role="tab"
              aria-selected={section === key}
              aria-controls={'settings-' + key}
              id={'settings-tab-' + key}
              onClick={() => setSection(key)}
            >
              <Icon size={17} />
              {label}
            </button>
          ))}
        </div>
        <div
          className="settings-content"
          role="tabpanel"
          id={'settings-' + section}
          aria-labelledby={'settings-tab-' + section}
        >
          {section === 'schedule' && (
            <section className="panel">
              <div className="section-heading">
                <div>
                  <h2>Khối lượng & nhắc việc</h2>
                  <p>Gợi ý thứ tự dựa vào hạn và khối lượng bạn có thể làm mỗi ngày.</p>
                </div>
              </div>
              <form
                className="settings-body"
                onSubmit={(event) => {
                  event.preventDefault()
                  action(async () => {
                    const minutes = reminders
                      .split(',')
                      .map((part: string) => part.trim())
                      .filter(Boolean)
                      .map(Number)
                    if (minutes.some((value: number) => !Number.isInteger(value) || value < 0))
                      throw new Error(
                        'Thời gian nhắc phải là số phút không âm, cách nhau bằng dấu phẩy.',
                      )
                    return api('/settings', 'PUT', {
                      ...settings,
                      calendar_colors: data.settings.calendar_colors || {},
                      semantic_enabled: data.settings.semantic_enabled,
                      deadline_reminders: minutes,
                    })
                  }, 'Đã lưu tùy chọn ưu tiên')
                }}
              >
                <Field label="Khối lượng có thể làm mỗi ngày (phút)">
                  <input
                    type="number"
                    required
                    min={15}
                    max={1440}
                    value={settings.daily_limit_minutes}
                    onChange={(event) => update('daily_limit_minutes', Number(event.target.value))}
                  />
                  <small>Dùng để nhận biết việc có nhiều khối lượng nhưng sắp đến hạn.</small>
                </Field>
                <details className="disclosure spaced">
                  <summary>Nhắc việc</summary>
                  <div className="form-grid disclosure-body">
                    <Field label="Nhắc trước deadline (phút)">
                      <input
                        value={reminders}
                        onChange={(event) => setReminders(event.target.value)}
                      />
                      <small>Ví dụ: 1440, 120 = trước 1 ngày và 2 giờ.</small>
                    </Field>
                  </div>
                </details>
                <div className="settings-save">
                  <Button type="submit">Lưu cài đặt</Button>
                </div>
              </form>
            </section>
          )}

          {section === 'appearance' && (
            <section className="panel">
              <div className="section-heading">
                <div>
                  <h2>Giao diện</h2>
                  <p>Thay đổi có hiệu lực ngay và được nhớ trên trình duyệt này.</p>
                </div>
              </div>
              <div className="settings-body">
                <ThemeOptions mode={theme.mode} onChange={theme.setMode} />
                <p className="hint">
                  Theo hệ thống tự chuyển sáng / tối theo cài đặt thiết bị. Bạn cũng có thể đổi
                  nhanh bằng biểu tượng mặt trăng / mặt trời ở góc Không gian.
                </p>
              </div>
            </section>
          )}

          {section === 'google' && (
            <section className="panel">
              <div className="section-heading">
                <div>
                  <h2>Google Calendar</h2>
                  <p>Đồng bộ với lịch riêng PersonalDeadlineManagement.</p>
                </div>
                <span className={'tag ' + (data.google.status === 'error' ? 'amber' : '')}>
                  {data.google.connected ? 'Đã kết nối' : 'Chưa kết nối'}
                </span>
              </div>
              <div className="settings-body">
                <GoogleSyncControls google={data.google} action={action} expanded />
                <div className="button-row">
                  <Button
                    subtle={data.google.connected}
                    disabled={!data.google.configured}
                    onClick={() =>
                      action(async () => {
                        const result = await api('/google/authorize', 'POST')
                        window.location.assign(result.url)
                      }, 'Đang mở Google')
                    }
                  >
                    {data.google.connected ? 'Đăng nhập lại' : 'Kết nối Google'}
                  </Button>
                </div>
                <details className="disclosure spaced" open={!data.google.connected}>
                  <summary>Cấu hình kết nối Google</summary>
                  <div className="disclosure-body">
                    <p>Tải file OAuth client JSON loại Desktop app, rồi nhấn Kết nối Google.</p>
                    <label className="btn subtle">
                      <Upload size={16} />
                      Chọn OAuth client JSON
                      <input
                        type="file"
                        hidden
                        accept=".json"
                        onChange={async (event) => {
                          const file = event.target.files?.[0]
                          if (file)
                            await action(
                              async () =>
                                api('/google/config', 'POST', JSON.parse(await file.text())),
                              'Đã lưu cấu hình OAuth',
                            )
                        }}
                      />
                    </label>
                    <p className="hint">
                      Nếu Google báo access_denied khi app ở chế độ Testing, thêm tài khoản của bạn
                      vào Google Auth Platform → Audience → Test users. Xem thêm trong hướng dẫn sử
                      dụng.
                    </p>
                  </div>
                </details>
                {data.google.connected && (
                  <details className="disclosure spaced">
                    <summary>Lịch khác dùng để đọc giờ bận</summary>
                    <div className="disclosure-body">
                      <p>Các lịch này chỉ được đọc. App ghi sự kiện lên lịch riêng của mình.</p>
                      {calendarError && <p className="overdue">{calendarError}</p>}
                      <div className="calendar-selections">
                        {calendars
                          .filter((calendar) => calendar.id !== data.google.calendar_id)
                          .map((calendar) => (
                            <label className="check-label" key={calendar.id}>
                              <input
                                type="checkbox"
                                checked={selection.includes(calendar.id)}
                                onChange={(event) =>
                                  setSelection(
                                    event.target.checked
                                      ? [...selection, calendar.id]
                                      : selection.filter((id) => id !== calendar.id),
                                  )
                                }
                              />
                              {calendar.summary}
                            </label>
                          ))}
                      </div>
                      <Button
                        subtle
                        onClick={() =>
                          action(() => api('/google/selection', 'PUT', { calendar_ids: selection }))
                        }
                      >
                        Lưu lịch đọc giờ bận
                      </Button>
                    </div>
                  </details>
                )}
                {data.google.conflicts?.map((conflict: Item) => (
                  <div className="risk-row spaced" key={conflict.id}>
                    <div>
                      <b>Xung đột: {conflict.title}</b>
                      <p>Chọn phiên bản bạn muốn giữ.</p>
                      <div className="button-row">
                        <Button
                          subtle
                          onClick={() =>
                            action(() =>
                              api('/google/conflicts/' + conflict.id, 'POST', { choice: 'local' }),
                            )
                          }
                        >
                          Giữ trong app
                        </Button>
                        <Button
                          subtle
                          onClick={() =>
                            action(() =>
                              api('/google/conflicts/' + conflict.id, 'POST', { choice: 'remote' }),
                            )
                          }
                        >
                          Giữ Google
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
                {data.google.connected && (
                  <div className="settings-save">
                    <button
                      className="text-btn danger-text"
                      onClick={() =>
                        action(() => api('/google/connection', 'DELETE'), 'Đã ngắt kết nối Google')
                      }
                    >
                      Ngắt kết nối
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}

          {section === 'knowledge' && (
            <section className="panel">
              <div className="section-heading">
                <div>
                  <h2>Nguồn tài liệu</h2>
                  <p>Theo dõi thư mục bạn chọn; file gốc chỉ được đọc.</p>
                </div>
              </div>
              <div className="settings-body">
                {data.sources.map((source: Item) => (
                  <div className="source-row" key={source.id}>
                    <div>
                      <b>{source.title}</b>
                      <small>{source.path}</small>
                      <small className={source.status === 'unavailable' ? 'overdue' : 'muted'}>
                        {source.error || (source.status === 'ready' ? 'Sẵn sàng' : 'Đang chờ quét')}
                      </small>
                    </div>
                    <button
                      className="icon-btn"
                      aria-label={'Gỡ nguồn ' + source.title}
                      onClick={() => action(() => api('/knowledge/sources/' + source.id, 'DELETE'))}
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                ))}
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    action(
                      () => api('/knowledge/sources', 'POST', { title: sourceName, path }),
                      'Đã thêm nguồn, đang quét',
                    ).then((result) => {
                      if (result) {
                        setPath('')
                        setSourceName('')
                      }
                    })
                  }}
                >
                  <Field label="Tên nguồn">
                    <input
                      required
                      value={sourceName}
                      onChange={(event) => setSourceName(event.target.value)}
                      placeholder="Tài liệu học kỳ"
                    />
                  </Field>
                  <Field label="Đường dẫn thư mục trên máy">
                    <input
                      required
                      value={path}
                      onChange={(event) => setPath(event.target.value)}
                      placeholder="/home/…/TaiLieu"
                    />
                  </Field>
                  <div className="button-row">
                    <Button type="submit" disabled={!path || !sourceName}>
                      <Plus size={16} />
                      Thêm nguồn
                    </Button>
                    <Button
                      subtle
                      onClick={() =>
                        action(() => api('/knowledge/scan', 'POST'), 'Đã yêu cầu quét lại')
                      }
                    >
                      <RefreshCw size={16} />
                      Quét lại
                    </Button>
                  </div>
                </form>
                <details className="disclosure spaced">
                  <summary>Tìm kiếm theo ngữ nghĩa</summary>
                  <div className="disclosure-body">
                    <p>
                      {data.knowledge.semantic_available === false
                        ? 'Bản cài hiện tại hỗ trợ tìm từ khóa. Cài thêm tính năng tìm kiếm ngữ nghĩa theo hướng dẫn để tải mô hình.'
                        : data.knowledge.model_ready
                          ? 'Mô hình đã sẵn sàng.'
                          : 'Tải mô hình một lần để tìm theo ý nghĩa; tìm từ khóa vẫn dùng được.'}
                    </p>
                    {!data.knowledge.model_ready && data.knowledge.semantic_available !== false && (
                      <Button
                        subtle
                        onClick={() =>
                          action(() => api('/knowledge/model', 'POST'), 'Đang tải mô hình tìm kiếm')
                        }
                      >
                        <Download size={16} />
                        Tải mô hình tìm kiếm
                      </Button>
                    )}
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={data.settings.semantic_enabled}
                        onChange={(event) =>
                          action(
                            () =>
                              api('/settings', 'PUT', {
                                ...data.settings,
                                semantic_enabled: event.target.checked,
                              }),
                            'Đã lưu chế độ tìm kiếm',
                          )
                        }
                      />
                      Bật tìm kiếm ngữ nghĩa
                    </label>
                    <small className="muted">
                      {data.knowledge.embedded}/{data.knowledge.chunks} đoạn đã xử lý.
                    </small>
                    {data.jobs
                      .filter((job: Item) => job.kind === 'model' || job.status === 'error')
                      .map((job: Item) => (
                        <p className="hint" key={job.id}>
                          {job.kind === 'model' ? 'Mô hình' : 'Tác vụ'}: {job.status}
                          {job.error ? ' · ' + job.error : ''}
                        </p>
                      ))}
                  </div>
                </details>
              </div>
            </section>
          )}

          {section === 'connections' && (
            <ConnectionsPage
              onChanged={onConnectionsChanged}
              onGoogleSettings={() => setSection('google')}
            />
          )}

          {section === 'backup' && (
            <section className="panel">
              <div className="section-heading">
                <div>
                  <h2>Sao lưu dữ liệu</h2>
                  <p>Tự sao lưu mỗi ngày khi dịch vụ chạy, giữ 7 bản gần nhất.</p>
                </div>
              </div>
              <div className="settings-body prose">
                <p>
                  Bản sao lưu gồm công việc, lịch và file tải lên. Tài liệu trong thư mục theo dõi
                  và thông tin đăng nhập Google cần được quản lý riêng.
                </p>
                <Button
                  onClick={() =>
                    action(async () => {
                      const result = await api('/backups', 'POST')
                      setBackups(await api('/backups'))
                      return result
                    }, 'Đã tạo bản sao lưu')
                  }
                >
                  <Download size={16} />
                  Sao lưu ngay
                </Button>
                <div className="backup-list">
                  {backups.map((backup) => (
                    <a key={backup.filename} href={'/api/v1/backups/' + backup.filename} download>
                      <FileText size={16} />
                      <span>{backup.filename.replace('workspace-', '')}</span>
                      <Download size={16} />
                    </a>
                  ))}
                </div>
                <p className="hint">
                  Tải bản sao lưu sang thiết bị khác. Các bước phục hồi được mô tả trong hướng dẫn
                  sử dụng.
                </p>
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  )
}
