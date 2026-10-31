import { ArrowUpRight } from 'lucide-react'
type Item = Record<string, any>
const dateText = (value: string) =>
  new Date(value).toLocaleDateString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
function linkLabel(value: string) {
  try {
    const url = new URL(value)
    if (url.hostname.includes('google.com') && url.pathname.includes('calendar'))
      return 'Google Calendar'
    if (url.hostname === 'drive.google.com') return 'Tài liệu trên Drive'
    if (url.hostname === 'docs.google.com') return 'Tài liệu Google'
    return url.hostname.replace(/^www\./, '')
  } catch {
    return value
  }
}
export function WorkText({ value }: { value: string }) {
  return (
    <div className="work-text">
      {(value || '').split(/(https?:\/\/[^\s<>"\)]+)/g).map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} title={part} target="_blank" rel="noreferrer">
            {linkLabel(part)}
            <ArrowUpRight size={12} />
          </a>
        ) : (
          part
        ),
      )}
    </div>
  )
}
export function PriorityList({
  items,
  open,
  limit,
}: {
  items: Item[]
  open: (kind: string, id: string) => void
  limit?: number
}) {
  return (
    <div className="priority-list">
      {items.slice(0, limit).map((item) => (
        <button
          className="priority-card"
          key={item.kind + item.id}
          onClick={() => open(item.kind, item.id)}
        >
          <span className="priority-rank">{item.rank}</span>
          <div>
            <b>{item.title}</b>
            <p>{item.reason}</p>
            <small>
              {item.due_at ? 'Hạn ' + dateText(item.due_at) : 'Chưa có hạn'}
              {item.remaining_minutes > 0 ? ` · Khoảng ${item.remaining_minutes} phút còn lại` : ''}
            </small>
          </div>
          <ArrowUpRight size={16} />
        </button>
      ))}
      {!items.length && (
        <p className="muted pad">Chưa có việc đang chờ. Thêm một công việc để bắt đầu.</p>
      )}
    </div>
  )
}
