import { test, expect } from './fixtures'
import { navigate, legacyPreferences } from './legacy'

test.beforeEach(async ({ page }) => {
  await legacyPreferences(page)
})

test.beforeEach(async ({ page }) => {
  await page.goto('/#space')
  await expect(page.getByRole('heading', { name: 'Các môn học', exact: true })).toBeVisible()
})

test('mobile workspace keeps actions usable and supports checklist editing, undo, logging and keyboard tabs', async ({
  page,
}) => {
  const response = await page.request.post('/api/v1/tasks', {
    data: { title: 'Hoàn thành báo cáo thực nghiệm và kiểm tra các tiêu chí của bài tập' },
  })
  const task = await response.json()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/#workspace/tasks/${task.id}`)
  const heading = page.getByRole('heading', { name: task.title, exact: true })
  await expect(heading).toBeVisible()
  const box = await heading.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(390)
  expect(box!.height).toBeLessThan(160)
  const input = page.getByLabel('Đầu việc mới', { exact: true })
  await input.fill('Đọc yêu cầu')
  await input.press('Enter')
  await expect(page.getByRole('checkbox', { name: 'Đọc yêu cầu', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Sửa đầu việc Đọc yêu cầu', exact: true }).click()
  const edit = page.getByLabel('Nội dung đầu việc', { exact: true })
  await edit.fill('Đọc yêu cầu và tiêu chí')
  await edit.press('Enter')
  const checkbox = page.getByRole('checkbox', { name: 'Đọc yêu cầu và tiêu chí', exact: true })
  await expect(checkbox).toBeEnabled()
  await checkbox.check()
  await expect(checkbox).toBeChecked()
  const remove = page.getByRole('button', {
    name: 'Xóa đầu việc Đọc yêu cầu và tiêu chí',
    exact: true,
  })
  await expect(remove).toBeEnabled()
  await remove.click()
  await expect(checkbox).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Hoàn tác', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Hoàn tác', exact: true }).click()
  await expect(checkbox).toBeChecked()
  const stepsTab = page.getByRole('tab', { name: /^Đầu việc/ })
  await stepsTab.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Tài liệu', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Gợi ý', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await page.keyboard.press('Home')
  await expect(stepsTab).toHaveAttribute('aria-selected', 'true')
  await page.getByLabel('Thao tác khác', { exact: true }).click()
  await page.getByRole('button', { name: 'Ghi thời gian', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Thêm thời gian đã làm', exact: true })
  await expect(dialog.getByRole('combobox', { name: 'Công việc', exact: true })).toHaveValue(
    task.id,
  )
  await dialog.getByLabel('Số phút đã làm').fill('17')
  await dialog.getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await page.getByRole('button', { name: 'Tập trung', exact: true }).click()
  await expect(page.locator('.focus-bar')).toContainText(task.title)
  await page.getByRole('button', { name: 'Kết thúc & ghi giờ', exact: true }).click()
  await expect(page.locator('.focus-bar')).toHaveCount(0)
  const data = await (await page.request.get('/api/v1/workspace')).json()
  expect(data.sessions.some((s: any) => s.task_id === task.id && s.minutes === 17)).toBeTruthy()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.screenshot({ path: 'test-results/minimal-workspace-mobile.png', fullPage: true })
})

test('documents accept multiple files, expose cited content with keyboard focus and reject unsupported types', async ({
  page,
}) => {
  const response = await page.request.post('/api/v1/tasks', {
    data: { title: 'Tài liệu trong workspace tối giản' },
  })
  const task = await response.json()
  await page.goto(`/#workspace/tasks/${task.id}`)
  await page.getByRole('tab', { name: 'Tài liệu', exact: true }).click()
  const files = page.getByLabel('Thêm tài liệu cho công việc', { exact: true })
  await files.setInputFiles([
    {
      name: 'De-bai-a.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('Yêu cầu riêng A: báo cáo có bảng kết quả.'),
    },
    {
      name: 'Huong-dan-b.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Hướng dẫn riêng B: kiểm tra kết luận.'),
    },
  ])
  await expect(page.getByText('De-bai-a.md', { exact: true })).toBeVisible()
  await expect(page.getByText('Huong-dan-b.txt', { exact: true })).toBeVisible()
  await expect
    .poll(
      async () => {
        const context = await (await page.request.get(`/api/v1/workspaces/tasks/${task.id}`)).json()
        return context.documents.filter((d: any) => d.work_id === task.id && d.status === 'ready')
          .length
      },
      { timeout: 25000 },
    )
    .toBe(2)
  const doc = page.locator('.work-document').filter({ hasText: 'De-bai-a.md' })
  await doc.locator('summary').click()
  const source = doc.locator('.work-source').first()
  await source.click()
  const dialog = page.getByRole('dialog', { name: 'Nguồn của gợi ý' })
  await expect(dialog).toContainText('Yêu cầu riêng A')
  const close = dialog.getByRole('button', { name: 'Đóng nguồn', exact: true })
  await expect(close).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(close).not.toBeFocused()
  await page.keyboard.press('Tab')
  await expect(close).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(source).toBeFocused()
  await files.setInputFiles({
    name: 'khong-ho-tro.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('not an accepted document'),
  })
  await expect(page.getByRole('alert')).toContainText(
    'Chọn file PDF, DOCX, XLSX, Markdown hoặc TXT.',
  )
  await page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/workspaces/tasks/${task.id}`) &&
      response.request().method() === 'GET',
  )
  await expect(page.getByRole('alert')).toContainText(
    'Chọn file PDF, DOCX, XLSX, Markdown hoặc TXT.',
  )
  await page.getByRole('button', { name: 'Đóng lỗi trong công việc' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
})
