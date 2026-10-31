import { test, expect, Page } from './fixtures'
import { legacyPreferences } from './legacy'

test.beforeEach(async ({ page }) => {
  await legacyPreferences(page)
  await page.goto('/#space')
  await expect(page.getByRole('heading', { name: 'Các môn học', exact: true })).toBeVisible()
})
async function find(page: Page, title: string) {
  const input = page.getByLabel('Tìm môn học hoặc deadline')
  if (!(await input.isVisible()))
    await page.getByRole('button', { name: 'Tìm trong không gian', exact: true }).click()
  await input.fill(title)
  await page.getByRole('button', { name: 'Vừa không gian', exact: true }).click()
}

test('course → project → deadline → task → complete entirely inside Space', async ({ page }) => {
  await page.getByRole('button', { name: 'Thêm môn', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: 'Thêm môn học', exact: true })
  await dialog.getByLabel('Tên', { exact: true }).fill('Hệ điều hành · kiểm thử nghiệp vụ')
  await dialog.getByLabel('Học kỳ').fill('Học kỳ 1 · 2026')
  await dialog.getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await find(page, 'Hệ điều hành · kiểm thử nghiệp vụ')
  await page
    .getByRole('button', { name: 'Mở Hệ điều hành · kiểm thử nghiệp vụ', exact: true })
    .click()
  await page.getByRole('button', { name: 'Tài liệu trong không gian', exact: true }).click()
  const resources = page.getByRole('dialog', { name: 'Tài liệu', exact: true })
  await resources.locator('summary').filter({ hasText: 'Đồ án' }).click()
  await resources.getByRole('button', { name: 'Thêm đồ án', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Thêm đồ án', exact: true })
  await dialog.getByLabel('Tên', { exact: true }).fill('Đồ án lập lịch')
  await expect(dialog.getByLabel('Môn học')).not.toHaveValue('')
  await dialog.getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await resources.getByRole('button', { name: 'Đóng tài liệu', exact: true }).click()
  await page.getByRole('button', { name: 'Thêm deadline', exact: true }).first().click()
  dialog = page.getByRole('dialog', { name: 'Thêm deadline', exact: true })
  await dialog.getByLabel('Tên', { exact: true }).fill('Nộp đồ án')
  const due = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 10)
  await dialog.getByLabel('Hạn hoàn thành').fill(due)
  await dialog.getByLabel('Đồ án / bài tập').selectOption({ label: 'Đồ án lập lịch' })
  await dialog.getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await page.getByRole('button', { name: 'Thêm công việc', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Thêm công việc', exact: true })
  await dialog.getByLabel('Tên', { exact: true }).fill('Đọc yêu cầu đồ án')
  await dialog.getByText('Thông tin thêm', { exact: true }).click()
  await dialog.getByLabel('Thời lượng dự kiến (phút)').fill('45')
  await dialog.getByLabel('Mốc deadline').selectOption({ label: 'Nộp đồ án' })
  await dialog.getByLabel('Đồ án / bài tập').selectOption({ label: 'Đồ án lập lịch' })
  await dialog.getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await find(page, 'Nộp đồ án')
  await page.getByRole('button', { name: 'Mở Nộp đồ án', exact: true }).click()
  await page.locator('.work-related').filter({ hasText: 'Đọc yêu cầu đồ án' }).click()
  await expect(page.getByRole('heading', { name: 'Đọc yêu cầu đồ án', exact: true })).toBeVisible()
  await expect(
    page.getByRole('dialog', { name: 'Chi tiết trong Không gian', exact: true }),
  ).toBeVisible()
  await page.getByLabel('Đầu việc mới', { exact: true }).fill('Đọc rubric')
  await page.getByRole('button', { name: 'Thêm', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Đọc rubric', exact: true }).check()
  await page.reload()
  await expect(page.getByRole('checkbox', { name: 'Đọc rubric', exact: true })).toBeChecked()
  await page.getByRole('button', { name: 'Đánh dấu hoàn thành', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Mở lại công việc', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Lịch của tôi', exact: true }).click()
  await expect(page.locator('.calendar-panel').getByRole('table').first()).toBeVisible()
  await expect(
    page
      .locator('.calendar-panel')
      .getByRole('button', { name: /Nộp đồ án/ })
      .first(),
  ).toBeVisible()
  await expect(
    page.locator('.calendar-panel').getByRole('button', { name: /Đọc yêu cầu đồ án/ }),
  ).toHaveCount(0)
})

test('source intake → Vietnamese search → excerpt without leaving Space', async ({ page }) => {
  await page.getByRole('button', { name: 'Tài liệu trong không gian', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Tài liệu', exact: true })
    .getByRole('button', { name: 'Thêm tài liệu', exact: true })
    .click()
  const intake = page.getByRole('dialog', { name: 'Thêm nguồn cho Codex' })
  await intake.getByLabel('Chọn tài liệu và ảnh').setInputFiles({
    name: 'De-bai-thu-nghiem.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(
      '# Yêu cầu đồ án\nBáo cáo phân tích thuật toán lập lịch cần có thực nghiệm.',
      'utf8',
    ),
  })
  await intake.getByRole('checkbox', { name: 'Nhờ Codex tổng hợp và cập nhật deadline' }).uncheck()
  await intake.getByRole('button', { name: 'Thêm nguồn', exact: true }).click()
  await expect(intake).not.toBeVisible()
  await expect(page.getByText('De-bai-thu-nghiem.md', { exact: true })).toBeVisible()
  await expect(page.getByText('Sẵn sàng', { exact: true }).first()).toBeVisible({ timeout: 25000 })
  await page.getByLabel('Tìm tài liệu', { exact: true }).fill('thuat toan')
  await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click()
  await expect(page.locator('.search-hit').first()).toContainText('thuật toán lập lịch')
  await page.locator('.search-hit').first().click()
  await expect(page.getByRole('dialog', { name: 'Đoạn nguồn' })).toContainText(
    'Báo cáo phân tích thuật toán',
  )
  await expect(page).toHaveURL(/#space$/)
})

test('draft can be edited, applied and undone in the corner panel', async ({ page }) => {
  const r = await page.request.post('/api/v1/proposals', {
    data: {
      title: 'Đề xuất kiểm chứng Codex',
      reason: 'Đọc đề và chia việc',
      operations: [
        {
          kind: 'tasks',
          action: 'create',
          id: 'codex-browser-check',
          data: { title: 'Việc từ bản nháp Codex', estimate_minutes: 30 },
        },
      ],
    },
  })
  expect(r.ok()).toBeTruthy()
  await page.reload()
  await page.getByRole('button', { name: 'Thay đổi trong không gian', exact: true }).click()
  await page
    .getByRole('button')
    .filter({ has: page.getByRole('heading', { name: 'Đề xuất kiểm chứng Codex' }) })
    .click()
  await page.getByRole('button', { name: 'Chỉnh thay đổi này' }).click()
  const dialog = page.getByRole('dialog', { name: 'Sửa công việc', exact: true })
  await dialog.getByText('Thông tin thêm', { exact: true }).click()
  await dialog.getByLabel('Thời lượng dự kiến (phút)').fill('60')
  await dialog.getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.locator('.operation')).toContainText('1 giờ')
  expect(
    (await (await page.request.get('/api/v1/tasks')).json()).some(
      (t: any) => t.id === 'codex-browser-check',
    ),
  ).toBeFalsy()
  await page.getByRole('button', { name: 'Áp dụng thay đổi' }).click()
  await expect(page.locator('.alert.success')).toContainText('Đã áp dụng đề xuất')
  expect(
    (await (await page.request.get('/api/v1/tasks')).json()).find(
      (t: any) => t.id === 'codex-browser-check',
    )?.estimate_minutes,
  ).toBe(60)
  await page.getByRole('button', { name: 'Hoàn tác', exact: true }).click()
  await expect(page.locator('.alert.success')).toContainText('Đã hoàn tác')
  expect(
    (await (await page.request.get('/api/v1/tasks')).json()).some(
      (t: any) => t.id === 'codex-browser-check',
    ),
  ).toBeFalsy()
  await expect(page).toHaveURL(/#space$/)
})

test('mobile has a small in-canvas tool strip and no legacy navigation menu', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await expect(page.getByLabel('Các mục khác', { exact: true })).toHaveCount(0)
  await expect(page.locator('.space-rail nav button')).toHaveCount(2)
  await page.screenshot({ path: 'test-results/space-simple-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('toolbar', { name: 'Tiện ích không gian' })).toBeVisible()
  await page.getByRole('button', { name: 'Tài liệu trong không gian', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Tài liệu', exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/space-resources-mobile.png' })
  expect(errors).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
})
