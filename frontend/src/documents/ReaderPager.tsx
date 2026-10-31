import { ChevronLeft, ChevronRight } from 'lucide-react'

export function ReaderPager({
  page,
  total,
  change,
}: {
  page: number
  total: number
  change: (page: number) => void
}) {
  return (
    <>
      <button
        className="icon-btn"
        aria-label="Trang trước"
        disabled={page <= 1}
        onClick={() => change(page - 1)}
      >
        <ChevronLeft size={15} />
      </button>
      <label className="reader-page">
        <input
          aria-label="Số trang"
          type="number"
          min={1}
          max={total || 1}
          value={page}
          onChange={(event) =>
            change(Math.min(total || 1, Math.max(1, Number(event.target.value) || 1)))
          }
        />{' '}
        / {total || '…'}
      </label>
      <button
        className="icon-btn"
        aria-label="Trang tiếp"
        disabled={!total || page >= total}
        onClick={() => change(page + 1)}
      >
        <ChevronRight size={15} />
      </button>
    </>
  )
}
