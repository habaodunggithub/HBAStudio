import { useEffect, useState } from 'react'
import { Cloud, CloudOff, RefreshCw, Settings2 } from 'lucide-react'
import { api } from './api'
import { Button } from './ui'

const dateText = (value: string) =>
  new Date(value).toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

export function GoogleSyncControls({ google: g, action, expanded = false }: any) {
  const [busy, setBusy] = useState(false)
  const [auto, setAuto] = useState(g.auto_sync ?? true),
    [interval, setIntervalMinutes] = useState(g.interval_minutes || 15)
  useEffect(() => setAuto(g.auto_sync ?? true), [g.auto_sync])
  useEffect(() => setIntervalMinutes(g.interval_minutes || 15), [g.interval_minutes])
  const retry = g.retry_at && new Date(g.retry_at).getTime() > Date.now()
  const state = !g.connected
    ? 'Chưa kết nối'
    : g.conflicts?.length
      ? `Có ${g.conflicts.length} xung đột`
      : retry
        ? 'Đang chờ thử lại'
        : g.status === 'syncing'
          ? 'Đang đồng bộ'
          : g.auto_sync === false
            ? 'Đã tạm dừng'
            : g.pending_changes
              ? 'Đang chờ gửi thay đổi'
              : g.last_sync
                ? 'Đã đồng bộ'
                : 'Sẵn sàng đồng bộ'
  async function update(patch: any) {
    const before = { auto, interval }
    setBusy(true)
    if ('auto_sync' in patch) setAuto(patch.auto_sync)
    if ('interval_minutes' in patch) setIntervalMinutes(patch.interval_minutes)
    try {
      const result = await action(
        () =>
          api('/google/sync-options', 'PUT', {
            auto_sync: auto,
            interval_minutes: interval,
            ...patch,
          }),
        'Đã lưu tùy chọn đồng bộ',
      )
      if (!result) {
        setAuto(before.auto)
        setIntervalMinutes(before.interval)
      }
    } finally {
      setBusy(false)
    }
  }
  async function sync() {
    setBusy(true)
    try {
      await action(() => api('/google/sync', 'POST'), 'Đã xếp lượt đồng bộ')
    } finally {
      setBusy(false)
    }
  }
  function settings() {
    sessionStorage.setItem('pdm-open-google-settings', '1')
    location.hash = 'settings'
  }
  return (
    <div className="google-sync-controls">
      <div className="calendar-sync-line">
        <div>
          {g.connected ? <Cloud size={16} /> : <CloudOff size={16} />}
          <span>{state}</span>
          {g.conflicts?.length > 0 && (
            <button className="text-btn" onClick={settings}>
              Xử lý
            </button>
          )}
          {g.connected && g.last_sync && <small>Lần cuối {dateText(g.last_sync)}</small>}
        </div>
        <div>
          {g.connected ? (
            <Button
              subtle
              disabled={
                busy ||
                g.status === 'syncing' ||
                !!retry ||
                !!(g.last_manual_at && Date.now() - new Date(g.last_manual_at).getTime() < 60000)
              }
              onClick={sync}
            >
              <RefreshCw size={14} className={g.status === 'syncing' ? 'spin' : ''} />
              Đồng bộ ngay
            </Button>
          ) : (
            !expanded && (
              <Button subtle onClick={settings}>
                Kết nối Google
              </Button>
            )
          )}
        </div>
      </div>
      {g.connected && (
        <details className="sync-options" open={expanded || undefined}>
          <summary>
            <Settings2 size={13} />
            Tùy chọn đồng bộ
          </summary>
          <div className="sync-options-body">
            <label className="check-label">
              <input
                type="checkbox"
                checked={auto}
                disabled={busy}
                onChange={(e) => update({ auto_sync: e.target.checked })}
              />
              Tự động đồng bộ khi ứng dụng đang chạy
            </label>
            <label className="sync-interval">
              Lấy thay đổi từ Google mỗi{' '}
              <select
                aria-label="Chu kỳ đồng bộ Google"
                value={interval}
                disabled={busy}
                onChange={(e) => update({ interval_minutes: Number(e.target.value) })}
              >
                {[5, 15, 30, 60, 120].map((n) => (
                  <option key={n} value={n}>
                    {n} phút
                  </option>
                ))}
              </select>
            </label>
            <p>
              Chỉnh sửa trong HBA Studio được gộp và gửi sau khoảng 10 giây. Chỉ dữ liệu thay đổi
              được trao đổi.
            </p>
            <p>
              HBA Studio tự giới hạn {g.quota?.minute_limit || 30} lượt/phút và{' '}
              {g.quota?.day_limit || 5000} lượt/ngày; tự giãn khi gặp giới hạn Google.
            </p>
            <small>
              Hôm nay HBA Studio đã gọi {g.quota?.day_used || 0}/{g.quota?.day_limit || 5000} lượt.
              Bộ đếm này chỉ tính lượt gọi từ HBA Studio.
            </small>
            {g.next_pull_at && !retry && g.auto_sync && (
              <small>Lượt lấy thay đổi tiếp theo: {dateText(g.next_pull_at)}</small>
            )}
            {retry && (
              <small>
                Thử lại sau {dateText(g.retry_at)}. Đồng bộ thủ công vẫn giữ thời gian chờ và hạn
                mức.
              </small>
            )}
            {g.conflicts?.length > 0 && (
              <Button subtle onClick={settings}>
                Xử lý {g.conflicts.length} xung đột
              </Button>
            )}
          </div>
        </details>
      )}
      {g.connected && g.error && <p className="sync-error">{g.error}</p>}
    </div>
  )
}
