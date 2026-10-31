import { CalendarDays, Flag, Plus } from 'lucide-react'
import { Button } from './ui'

type Deadline = { id: string; title: string; due_at: string }

export function TodayHeader({
  deadline,
  busy,
  onAddTask,
  onDeadline,
}: {
  deadline?: Deadline
  busy: boolean
  onAddTask: () => void
  onDeadline: (deadline?: Deadline) => void
}) {
  const now = new Date()
  const due = deadline && new Date(deadline.due_at)
  const overdue = due && due.getTime() < now.getTime()
  return (
    <header className="today-header">
      <div className="today-intro">
        <p className="today-date">
          <CalendarDays size={16} />
          {now.toLocaleDateString('vi-VN', {
            timeZone: 'Asia/Ho_Chi_Minh',
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
        </p>
        <h1>Hôm nay</h1>
        <p className="today-description">Những việc cần làm và các mốc sắp tới.</p>
        <div className="header-actions">
          <Button onClick={onAddTask} disabled={busy}>
            <Plus size={17} />
            Thêm công việc
          </Button>
        </div>
      </div>
      <section className="deadline-note" aria-label="Deadline gần nhất">
        <div className="deadline-note-heading">
          <Flag size={18} />
          <h2>Deadline gần nhất</h2>
        </div>
        {deadline ? (
          <>
            <button className="deadline-note-title" onClick={() => onDeadline(deadline)}>
              {deadline.title}
            </button>
            <p className={overdue ? 'overdue' : 'muted'}>
              {overdue ? 'Đã quá hạn · ' : ''}
              {due!.toLocaleDateString('vi-VN', {
                timeZone: 'Asia/Ho_Chi_Minh',
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
              })}
            </p>
            <button className="text-btn" onClick={() => onDeadline(deadline)}>
              Xem chi tiết
            </button>
          </>
        ) : (
          <>
            <p className="deadline-note-empty">Chưa có mốc nào đang chờ.</p>
            <p className="muted">Thêm ngày nộp bài, ngày thi hoặc mốc công việc để bắt đầu.</p>
            <button className="text-btn" onClick={() => onDeadline()}>
              <Plus size={15} />
              Thêm deadline
            </button>
          </>
        )}
      </section>
    </header>
  )
}
