import { test, expect, Page } from './fixtures'
import { navigate, legacyPreferences } from './legacy'

test.beforeEach(async ({ page }) => {
  await legacyPreferences(page)
})
const day = '2026-11-02'
async function boot(page: Page) {
  await page.clock.setFixedTime(new Date(day + 'T02:00:00Z'))
  await page.goto('/#space')
  await expect(page.getByRole('heading', { name: 'Các môn học', exact: true })).toBeVisible()
}
async function createEvent(
  page: Page,
  title: string,
  start = '09:00',
  end = '10:00',
  extra: any = {},
) {
  const result = await page.request.post('/api/v1/events', {
    data: {
      title,
      start: day + 'T' + start + ':00+07:00',
      end: day + 'T' + end + ':00+07:00',
      ...extra,
    },
  })
  expect(result.ok()).toBeTruthy()
  return result.json()
}
async function drag(page: Page, id: string, dx: number, dy: number, resize = false) {
  const el = page.locator(`[data-calendar-id="${id}"]`).first()
  await el.scrollIntoViewIfNeeded()
  const box = (await el.boundingBox())!
  const x = box.x + box.width / 2,
    y = resize ? box.y + box.height - 2 : box.y + Math.min(20, box.height / 2)
  const response = page.waitForResponse((r) => r.url().endsWith('/move'))
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: 15 })
  await page.mouse.up()
  return response
}
async function event(page: Page, id: string) {
  return (await (await page.request.get('/api/v1/events')).json()).find((e: any) => e.id === id)
}

test('actual drag and resize save times and undo; rejected moves revert on the calendar', async ({
  page,
}) => {
  await boot(page)
  const item = await createEvent(page, 'Sự kiện kéo thả thật')
  await page.getByRole('button', { name: 'Lịch của tôi', exact: true }).click()
  const el = page.locator(`[data-calendar-id="${item.id}"]`).first()
  await expect(el).toBeVisible()
  expect((await drag(page, item.id, 0, 50)).ok()).toBeTruthy()
  await expect.poll(async () => (await event(page, item.id)).start).toBe(day + 'T10:00:00+07:00')
  await expect(page.getByRole('button', { name: 'Hoàn tác thay đổi gần nhất' })).toBeEnabled()
  expect((await drag(page, item.id, 0, 50, true)).ok()).toBeTruthy()
  await expect.poll(async () => (await event(page, item.id)).end).toBe(day + 'T12:00:00+07:00')
  await page.getByRole('button', { name: 'Hoàn tác thay đổi gần nhất' }).click()
  await expect.poll(async () => (await event(page, item.id)).end).toBe(day + 'T11:00:00+07:00')
  await page.route('**/api/v1/calendar/events/*/move', (route) =>
    route.fulfill({
      status: 409,
      json: { detail: 'Sự kiện vừa thay đổi. Hãy tải lại lịch rồi thử lại.' },
    }),
  )
  expect((await drag(page, item.id, 0, 50)).status()).toBe(409)
  await expect(page.getByRole('alert')).toContainText('Sự kiện vừa thay đổi')
  await expect.poll(async () => (await event(page, item.id)).start).toBe(day + 'T10:00:00+07:00')
  await el.click()
  const dialog = page.getByRole('dialog', { name: 'Chi tiết sự kiện' })
  await expect(dialog.getByLabel('Bắt đầu', { exact: true })).toHaveValue(day + 'T10:00')
})

test('month drag moves deadline as an all-day date and a recurring session changes independently', async ({
  page,
}) => {
  await boot(page)
  const deadline = await (
    await page.request.post('/api/v1/deadlines', {
      data: { title: 'Deadline kéo thả', due_at: day },
    })
  ).json()
  const recurring = await createEvent(page, 'Buổi học lặp', '14:00', '15:00', {
    recurrence: ['RRULE:FREQ=WEEKLY;COUNT=4'],
  })
  await page.getByRole('button', { name: 'Lịch của tôi', exact: true }).click()
  await page.getByRole('button', { name: 'Tháng', exact: true }).click()
  const item = page.locator(`[data-calendar-id="${deadline.id}"]`).first()
  await expect(item).toBeVisible()
  const box = (await item.boundingBox())!
  expect((await drag(page, deadline.id, box.width + 4, 0)).ok()).toBeTruthy()
  await expect
    .poll(
      async () =>
        (await (await page.request.get('/api/v1/deadlines')).json()).find(
          (d: any) => d.id === deadline.id,
        ).due_at,
    )
    .toBe('2026-11-03T23:59:00+07:00')
  await page.getByRole('button', { name: 'Tuần', exact: true }).click()
  await page.locator(`[data-calendar-id="${recurring.id}"]`).first().click()
  const dialog = page.getByRole('dialog', { name: 'Chi tiết sự kiện' })
  await expect(dialog).toContainText('chỉ áp dụng cho buổi đang chọn')
  await dialog.getByLabel('Bắt đầu', { exact: true }).fill(day + 'T15:00')
  await dialog.getByLabel('Kết thúc', { exact: true }).fill(day + 'T16:15')
  await dialog.getByRole('button', { name: 'Lưu thời gian' }).click()
  await expect(dialog).toHaveCount(0)
  const current = await event(page, recurring.id)
  expect(current.start).toBe(day + 'T14:00:00+07:00')
  expect(current.exceptions[day + 'T14:00:00+07:00']).toEqual({
    start: day + 'T15:00:00+07:00',
    end: day + 'T16:15:00+07:00',
  })
  await page.screenshot({ path: 'test-results/calendar-rebuilt-desktop.png', fullPage: true })
})

test('Google sync settings persist, coalesce manual clicks, and readonly events expose their source', async ({
  page,
}) => {
  let g: any = {
    connected: true,
    configured: true,
    status: 'ready',
    auto_sync: true,
    interval_minutes: 15,
    last_sync: '2026-11-02T02:00:00Z',
    quota: { day_used: 14, day_limit: 5000, minute_limit: 30 },
    conflicts: [],
  }
  let manual = 0
  await page.route('**/api/v1/workspace', async (route) => {
    const response = await route.fetch()
    const data = await response.json()
    data.google = g
    await route.fulfill({ json: data })
  })
  await page.route('**/api/v1/google/sync-options', async (route) => {
    g = { ...g, ...route.request().postDataJSON() }
    await route.fulfill({ json: { ok: true } })
  })
  await page.route('**/api/v1/google/sync', async (route) => {
    manual++
    g = { ...g, pending_changes: true, last_manual_at: day + 'T02:00:00Z' }
    await route.fulfill({ json: { status: 'pending' } })
  })
  await boot(page)
  const readonly = await createEvent(page, 'Cuộc hẹn Google chỉ đọc', '11:00', '12:00', {
    readonly: true,
    origin: 'google',
    google_event_url: 'https://calendar.google.com/calendar/event?eid=fixture',
  })
  await page.getByRole('button', { name: 'Lịch của tôi', exact: true }).click()
  await page.getByText('Tùy chọn đồng bộ', { exact: true }).click()
  await expect(
    page.getByText('Hôm nay HBA Studio đã gọi 14/5000 lượt.', { exact: false }),
  ).toBeVisible()
  await page.getByLabel('Chu kỳ đồng bộ Google').selectOption('30')
  await expect(page.locator('.alert.success')).toContainText('Đã lưu tùy chọn đồng bộ')
  await page.getByRole('checkbox', { name: 'Tự động đồng bộ khi ứng dụng đang chạy' }).uncheck()
  await page.reload()
  await page.getByText('Tùy chọn đồng bộ', { exact: true }).click()
  await expect(page.getByLabel('Chu kỳ đồng bộ Google')).toHaveValue('30')
  await expect(
    page.getByRole('checkbox', { name: 'Tự động đồng bộ khi ứng dụng đang chạy' }),
  ).not.toBeChecked()
  await page.getByRole('button', { name: 'Đồng bộ ngay', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Đồng bộ ngay', exact: true })).toBeDisabled()
  expect(manual).toBe(1)
  await page.locator(`[data-calendar-id="${readonly.id}"]`).click()
  const dialog = page.getByRole('dialog', { name: 'Chi tiết sự kiện' })
  await expect(dialog).toContainText('Google · Chỉ đọc')
  await expect(dialog.getByLabel('Bắt đầu', { exact: true })).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'Lưu thời gian' })).toHaveCount(0)
  await expect(dialog.getByRole('link', { name: 'Mở Google Calendar' })).toHaveAttribute(
    'href',
    readonly.google_event_url,
  )
})

test('mobile calendar defaults to day, supports keyboard time editing and a quiet dark theme', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await boot(page)
  const item = await createEvent(page, 'Lịch gọn trên điện thoại', '10:00', '11:00')
  await page.getByRole('button', { name: 'Chuyển sang giao diện tối' }).click()
  await page.getByRole('button', { name: 'Lịch của tôi', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Ngày', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.locator(`[data-calendar-id="${item.id}"]`).click()
  const dialog = page.getByRole('dialog', { name: 'Chi tiết sự kiện' })
  await expect(dialog.getByRole('button', { name: 'Đóng chi tiết sự kiện' })).toBeFocused()
  await dialog.getByLabel('Bắt đầu', { exact: true }).fill(day + 'T11:00')
  await dialog.getByLabel('Kết thúc', { exact: true }).fill(day + 'T12:00')
  await dialog.getByRole('button', { name: 'Lưu thời gian' }).click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(async () => (await event(page, item.id)).start).toBe(day + 'T11:00:00+07:00')
  await page.getByRole('button', { name: 'Tháng', exact: true }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.screenshot({ path: 'test-results/calendar-rebuilt-dark-mobile.png', fullPage: true })
})
