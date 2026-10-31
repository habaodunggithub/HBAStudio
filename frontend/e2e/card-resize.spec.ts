import { test, expect, type Page, type Locator } from './fixtures'

async function drag(page: Page, handle: Locator, dx: number, dy: number, cancel = false) {
  const box = (await handle.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 })
  if (cancel) await handle.dispatchEvent('pointercancel', { pointerId: 1 })
  await page.mouse.up()
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pdm-chat-open', 'false')
    localStorage.setItem('pdm-theme', 'light')
  })
  await page.goto('/#space')
  await expect(page.getByRole('heading', { name: 'Các môn học', exact: true })).toBeVisible()
})

test('course and deadline cards resize at different zoom levels and keep independent saved sizes', async ({
  page,
}) => {
  const course = await (
      await page.request.post('/api/v1/courses', { data: { title: 'Môn chỉnh kích thước' } })
    ).json(),
    deadline = await (
      await page.request.post('/api/v1/deadlines', {
        data: { title: 'Báo cáo trên không gian', course_id: course.id, due_at: '2026-11-01' },
      })
    ).json(),
    key = 'courses:' + course.id,
    deadlineKey = 'deadlines:' + deadline.id
  await page.request.patch('/api/v1/canvas/home', {
    data: { nodes: { [key]: { x: 0, y: 0 } }, camera: { x: 40, y: 160, zoom: 1 } },
  })
  await page.reload()
  const card = page.locator('[data-canvas-node="' + key + '"]'),
    corner = card.getByRole('button', { name: 'Đổi kích thước thẻ ' + course.title, exact: true })
  const height = await card.evaluate((el) => (el as HTMLElement).offsetHeight),
    revision = (await (await page.request.get('/api/v1/workspace')).json()).revision
  await drag(page, corner, 100, 70)
  await expect
    .poll(async () => (await (await page.request.get('/api/v1/canvas/home')).json()).sizes?.[key])
    .toEqual({ width: 420, height: height + 70 })
  await expect(page.getByRole('heading', { name: 'Các môn học', exact: true })).toBeVisible()
  await page.reload()
  await expect(card).toHaveCSS('width', '420px')
  await card
    .getByRole('button', { name: 'Đổi chiều rộng thẻ ' + course.title, exact: true })
    .focus()
  await page.keyboard.press('Shift+ArrowLeft')
  await expect(card).toHaveCSS('width', '380px')
  await expect(card).toHaveCSS('height', height + 70 + 'px')
  await expect
    .poll(
      async () => (await (await page.request.get('/api/v1/canvas/home')).json()).sizes[key].width,
    )
    .toBe(380)
  await page.request.patch('/api/v1/canvas/course:' + course.id, {
    data: { nodes: { [deadlineKey]: { x: 0, y: 0 } }, camera: { x: 30, y: 150, zoom: 0.5 } },
  })
  await page.goto('/#space/' + course.id)
  const task = page.locator('[data-canvas-node="' + deadlineKey + '"]'),
    oldHeight = await task.evaluate((el) => (el as HTMLElement).offsetHeight)
  await drag(
    page,
    task.getByRole('button', { name: 'Đổi kích thước thẻ ' + deadline.title, exact: true }),
    40,
    30,
  )
  await expect
    .poll(
      async () =>
        (await (await page.request.get('/api/v1/canvas/course:' + course.id)).json()).sizes?.[
          deadlineKey
        ],
    )
    .toEqual({ width: 400, height: oldHeight + 60 })
  await page.reload()
  await expect(task).toHaveCSS('width', '400px')
  await page.getByRole('button', { name: 'Vừa không gian', exact: true }).click()
  const box = (await task.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(64)
  expect(box.x + box.width).toBeLessThanOrEqual(1440)
  expect((await (await page.request.get('/api/v1/canvas/home')).json()).sizes[key].width).toBe(380)
  expect((await (await page.request.get('/api/v1/workspace')).json()).revision).toBe(revision)
  await page.screenshot({ path: 'test-results/card-resize-course.png' })
})

test('work cards have separate width and height handles; cancellation restores size without saving', async ({
  page,
}) => {
  const work = await (
      await page.request.post('/api/v1/tasks', { data: { title: 'Board thay đổi kích thước' } })
    ).json(),
    path = '/api/v1/canvas/work:tasks:' + work.id
  await page.request.patch(path, {
    data: { nodes: { steps: { x: 0, y: 0 } }, camera: { x: 25, y: 25, zoom: 2 } },
  })
  await page.goto('/#workspace/tasks/' + work.id)
  const card = page.locator('[data-board-card="steps"]')
  await expect(card).toHaveCSS('width', '340px')
  await drag(
    page,
    card.getByRole('button', { name: 'Đổi chiều rộng thẻ Đầu việc', exact: true }),
    80,
    0,
  )
  await expect(card).toHaveCSS('width', '380px')
  await expect(card).toHaveCSS('height', '380px')
  await drag(
    page,
    card.getByRole('button', { name: 'Đổi chiều cao thẻ Đầu việc', exact: true }),
    0,
    -80,
  )
  await expect(card).toHaveCSS('height', '340px')
  await expect
    .poll(async () => (await (await page.request.get(path)).json()).sizes?.steps)
    .toEqual({ width: 380, height: 340 })
  await drag(
    page,
    card.getByRole('button', { name: 'Đổi kích thước thẻ Đầu việc', exact: true }),
    50,
    50,
    true,
  )
  await expect(card).toHaveCSS('width', '380px')
  await expect(card).toHaveCSS('height', '340px')
  await page.reload()
  await expect(card).toHaveCSS('width', '380px')
  await expect(card).toHaveCSS('height', '340px')
  await card.getByRole('button', { name: 'Đổi kích thước thẻ Đầu việc', exact: true }).focus()
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowLeft')
  await expect(card).toHaveCSS('width', '260px')
  await page.getByRole('button', { name: 'Ghi chú', exact: true }).click()
  await expect(page.locator('.wb-note .card-resize')).toHaveCount(3)
  await page.screenshot({ path: 'test-results/card-resize-work.png' })
})
