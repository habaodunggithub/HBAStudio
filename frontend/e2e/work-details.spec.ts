import { test, expect } from './fixtures'
import { navigate, legacyPreferences } from './legacy'

test.beforeEach(async ({ page }) => {
  await legacyPreferences(page)
})

test.beforeEach(async ({ page }) => {
  await page.goto('/#space')
  await expect(page.getByRole('heading', { name: 'Các môn học', exact: true })).toBeVisible()
})

test('workspace requests a cited brief only when chosen and keeps suggestions separate from tasks', async ({
  page,
}) => {
  const result = await page.request.post('/api/v1/tasks', {
    data: { title: 'Báo cáo agent có nguồn', description: 'Đọc đề bài để chuẩn bị báo cáo.' },
  })
  const task = await result.json()
  const upload = await page.request.post('/api/v1/knowledge/upload', {
    multipart: {
      work_kind: 'tasks',
      work_id: task.id,
      file: {
        name: 'De-bao-cao.md',
        mimeType: 'text/markdown',
        buffer: Buffer.from('Báo cáo phải có 3 thí nghiệm, bảng kết quả và kết luận.', 'utf8'),
      },
    },
  })
  expect(upload.ok()).toBeTruthy()
  const detailPath = `/api/v1/workspaces/tasks/${task.id}`
  await expect
    .poll(
      async () => {
        const detail = await (await page.request.get(detailPath)).json()
        return detail.documents[0]?.status
      },
      { timeout: 25000 },
    )
    .toBe('ready')
  let requested = 0,
    ready = false
  await page.route(`**${detailPath}/analyze`, async (route) => {
    requested++
    setTimeout(() => {
      ready = true
    }, 1200)
    await route.fulfill({ json: { status: 'queued' } })
  })
  await page.route(`**${detailPath}`, async (route) => {
    const response = await route.fetch()
    const detail = await response.json()
    detail.analysis = ready
      ? {
          status: 'ready',
          stale: false,
          brief: {
            summary: 'Báo cáo gồm 3 thí nghiệm và kết luận.',
            steps: [
              {
                title: 'Lập bảng kết quả thí nghiệm',
                detail: 'Đề bài yêu cầu có bảng kết quả.',
                source_ids: [detail.sources[0].id],
              },
            ],
            warnings: [],
            priority_reason: 'Hoàn thành bước thực nghiệm trước khi viết kết luận.',
          },
        }
      : { status: requested ? 'running' : 'idle', stale: !requested }
    await route.fulfill({ json: detail })
  })
  const before = await (await page.request.get('/api/v1/workspace')).json()
  await page.goto(`/#workspace/tasks/${task.id}`)
  await expect(page.getByRole('heading', { name: task.title, exact: true })).toBeVisible()
  expect(requested).toBe(0)
  await page.getByRole('tab', { name: 'Gợi ý', exact: true }).click()
  await expect(
    page.getByText('Báo cáo gồm 3 thí nghiệm và kết luận.', { exact: true }),
  ).toBeVisible()
  expect(requested).toBe(1)
  await page.locator('.suggested-step > summary').first().click()
  await page
    .locator('.source-tags')
    .getByRole('button', { name: /De-bao-cao/ })
    .click()
  await expect(page.getByRole('dialog', { name: 'Nguồn của gợi ý' })).toContainText('3 thí nghiệm')
  await page.getByRole('button', { name: 'Đóng nguồn', exact: true }).click()
  await page.getByRole('button', { name: 'Thêm vào đầu việc', exact: true }).click()
  await page.getByRole('tab', { name: /^Đầu việc/ }).click()
  await expect(
    page.getByRole('checkbox', { name: 'Lập bảng kết quả thí nghiệm', exact: true }),
  ).toBeVisible()
  const after = await (await page.request.get('/api/v1/workspace')).json()
  expect(after.tasks.length).toBe(before.tasks.length)
  expect(after.blocks.length).toBe(before.blocks.length)
  await page.evaluate(() => scrollTo(0, 0))
  await page.screenshot({ path: 'test-results/workspace-cited-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Chuyển sang giao diện tối' }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.screenshot({ path: 'test-results/workspace-cited-dark-mobile.png', fullPage: true })
})

test('calendar puts date-only events and deadlines in all-day cells and remembers custom colors', async ({
  page,
}) => {
  const today = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 10)
  const tomorrow = new Date(Date.now() + 86400000)
    .toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' })
    .slice(0, 10)
  const deadline = await page.request.post('/api/v1/deadlines', {
    data: { title: 'Mốc deadline cả ngày', due_at: today },
  })
  const dayEvent = await page.request.post('/api/v1/events', {
    data: {
      title: 'Google cả ngày minh họa',
      start: today,
      end: tomorrow,
      origin: 'google',
      readonly: true,
    },
  })
  expect(deadline.ok() && dayEvent.ok()).toBeTruthy()
  await page.reload()
  await page.getByRole('button', { name: 'Lịch của tôi', exact: true }).click()
  const calendar = page.locator('.calendar-panel')
  await expect(calendar.getByText('Cả ngày', { exact: true }).first()).toBeVisible()
  await expect(calendar.getByRole('button', { name: /Mốc deadline cả ngày/ }).first()).toBeVisible()
  await expect(
    calendar.getByRole('button', { name: /Google cả ngày minh họa/ }).first(),
  ).toBeVisible()
  const events = await (
    await page.request.get('/api/v1/calendar', {
      params: { start: today + 'T00:00:00+07:00', end: tomorrow + 'T00:00:00+07:00' },
    })
  ).json()
  expect(
    events
      .filter((e: any) => ['Google cả ngày minh họa', '⏳ Mốc deadline cả ngày'].includes(e.title))
      .every((e: any) => e.allDay),
  ).toBeTruthy()
  await page.getByRole('button', { name: 'Màu lịch', exact: true }).click()
  const color = page.getByLabel('Màu Mốc deadline cả ngày', { exact: true })
  await color.fill('#8e24aa')
  await expect(page.locator('.alert.success')).toContainText('Đã đổi màu lịch')
  await page.reload()
  await page.getByRole('button', { name: 'Màu lịch', exact: true }).click()
  await expect(page.getByLabel('Màu Mốc deadline cả ngày', { exact: true })).toHaveValue('#8e24aa')
  await expect(calendar.getByRole('button', { name: /Mốc deadline cả ngày/ }).first()).toHaveCSS(
    'background-color',
    'rgb(142, 36, 170)',
  )
  await page.screenshot({ path: 'test-results/calendar-all-day-colors.png', fullPage: true })
  await calendar
    .getByRole('button', { name: /Mốc deadline cả ngày/ })
    .first()
    .click()
  await expect(
    page.getByRole('heading', { name: 'Mốc deadline cả ngày', exact: true }),
  ).toBeVisible()
  await expect(page).toHaveURL(/#workspace\/deadlines\//)
})

test('project opens over the canvas and browser back returns to Space', async ({ page }) => {
  const response = await page.request.post('/api/v1/projects', {
    data: { title: 'Bài tập có workspace', description: 'Mô tả bài tập riêng.' },
  })
  expect(response.ok()).toBeTruthy()
  await page.reload()
  await page.getByRole('button', { name: 'Tài liệu trong không gian', exact: true }).click()
  await page.locator('.space-resource-group > summary').filter({ hasText: 'Đồ án' }).click()
  await page.locator('.space-resource-row').filter({ hasText: 'Bài tập có workspace' }).click()
  await expect(
    page.getByRole('heading', { name: 'Bài tập có workspace', exact: true }),
  ).toBeVisible()
  await page.getByLabel('Thao tác khác', { exact: true }).click()
  await page.getByRole('button', { name: 'Thông tin công việc', exact: true }).click()
  await page.getByText('Mô tả & liên kết', { exact: true }).click()
  await expect(page.getByText('Mô tả bài tập riêng.', { exact: true })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Các môn học', exact: true })).toBeVisible()
})
