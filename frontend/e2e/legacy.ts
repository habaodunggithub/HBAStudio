import { Page } from '@playwright/test'

export async function legacyPreferences(page: Page) {
  await page.addInitScript(() => {
    if (localStorage.getItem('hba-work-view') === null)
      localStorage.setItem('hba-work-view', 'list')
    if (localStorage.getItem('pdm-chat-open') === null)
      localStorage.setItem('pdm-chat-open', 'false')
    if (localStorage.getItem('pdm-chat-auto-apply') === null)
      localStorage.setItem('pdm-chat-auto-apply', 'false')
  })
}

export async function navigate(page: Page, label: string) {
  const labels: Record<string, string> = {
    'Thư viện': 'Tài liệu trong không gian',
    'Đề xuất': 'Thay đổi trong không gian',
    'Cài đặt': 'Tùy chọn không gian',
    'Công việc': 'Xem tất cả công việc',
    'Học tập': 'Không gian',
  }
  await page.getByRole('button', { name: labels[label] || label, exact: true }).click()
}
