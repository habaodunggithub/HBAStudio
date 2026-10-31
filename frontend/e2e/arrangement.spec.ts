import { test, expect, type Page } from './fixtures'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pdm-chat-open', 'false')
    localStorage.setItem('pdm-theme', 'light')
  })
  await page.goto('/#space')
  await expect(page.getByRole('heading', { name: 'Các môn học', exact: true })).toBeVisible()
})
async function fixture(page: Page) {
  const work = await (
    await page.request.post('/api/v1/tasks', { data: { title: 'Sắp xếp công việc' } })
  ).json()
  const path = '/api/v1/canvas/work:tasks:' + work.id
  const layout = {
    nodes: { steps: { x: 80, y: 80 }, 'note:a': { x: 700, y: 90 }, 'note:b': { x: 450, y: 580 } },
    sizes: { steps: { width: 420, height: 440 }, 'note:a': { width: 360, height: 270 } },
    cards: {
      'note:a': { title: 'Chuẩn bị', text: 'Đọc đề rồi thực hiện.' },
      'note:b': { title: 'Nộp bài', text: 'Kiểm tra trước khi nộp.' },
    },
    edges: { manual: { source: 'steps', target: 'note:a', arrow: false } },
    camera: { x: 20, y: 20, zoom: 0.7 },
  }
  await page.request.patch(path, { data: layout })
  await page.goto('/#workspace/tasks/' + work.id)
  await expect(page.locator('[data-board-card]')).toHaveCount(3)
  return { work, path, layout }
}
const arrangeButton = (page: Page) => page.getByRole('button', { name: 'Sắp xếp', exact: true })
const card = (page: Page, key: string) => page.locator('[data-board-card="' + key + '"]')

test('preview and cancel do not save; row/column apply, undo, size preservation and reload work', async ({
  page,
}) => {
  const { path, layout } = await fixture(page)
  let aiCalls = 0
  await page.route('**/canvas/**/arrange', async (route) => {
    aiCalls++
    await route.fulfill({ status: 500, json: {} })
  })
  const revision = (await (await page.request.get('/api/v1/workspace')).json()).revision
  await arrangeButton(page).click()
  await page.getByRole('button', { name: 'Cột dọc', exact: true }).click()
  await expect(card(page, 'note:a')).toHaveCSS('left', '0px')
  expect((await (await page.request.get(path)).json()).nodes).toEqual(layout.nodes)
  await page.getByRole('button', { name: 'Hủy', exact: true }).click()
  await expect(card(page, 'note:a')).toHaveCSS('left', '700px')
  await arrangeButton(page).click()
  await page.getByRole('button', { name: 'Hàng ngang', exact: true }).click()
  await page.getByRole('button', { name: 'Áp dụng bố cục', exact: true }).click()
  await expect
    .poll(async () =>
      Object.values((await (await page.request.get(path)).json()).nodes).every(
        (p: any) => p.y === 0,
      ),
    )
    .toBe(true)
  await expect(card(page, 'steps')).toHaveCSS('width', '420px')
  await page.getByRole('button', { name: 'Hoàn tác sắp xếp', exact: true }).click()
  await expect
    .poll(async () => (await (await page.request.get(path)).json()).nodes)
    .toEqual(layout.nodes)
  await expect(card(page, 'steps')).toHaveCSS('left', '80px')
  // Move a card first: arrangement must replace its rendered drag position as well.
  const handle = card(page, 'steps').getByRole('button', {
    name: 'Di chuyển thẻ Đầu việc',
    exact: true,
  })
  await handle.focus()
  await page.keyboard.press('ArrowRight')
  await expect(card(page, 'steps')).toHaveCSS('left', '90px')
  await arrangeButton(page).click()
  await page.getByRole('button', { name: 'Cột dọc', exact: true }).click()
  await page.getByRole('button', { name: 'Áp dụng bố cục', exact: true }).click()
  await expect(card(page, 'steps')).toHaveCSS('left', '0px')
  await page.reload()
  await expect(card(page, 'steps')).toHaveCSS('left', '0px')
  const saved = await (await page.request.get(path)).json()
  expect(saved.sizes).toEqual(layout.sizes)
  expect(saved.cards).toEqual({
    'note:a': { ...layout.cards['note:a'], type: 'note' },
    'note:b': { ...layout.cards['note:b'], type: 'note' },
  })
  expect(saved.edges).toEqual(layout.edges)
  expect((await (await page.request.get('/api/v1/workspace')).json()).revision).toBe(revision)
  expect(aiCalls).toBe(0)
})

test('Codex is opt-in, explains its order and adds optional arrows; undo retains manual connections', async ({
  page,
}) => {
  const { path, layout } = await fixture(page)
  let calls = 0
  await page.route('**/canvas/**/arrange', async (route) => {
    calls++
    expect(route.request().postDataJSON()).toEqual({ keys: ['steps', 'note:a', 'note:b'] })
    await route.fulfill({
      json: {
        order: ['note:a', 'steps', 'note:b'],
        summary: 'Đọc yêu cầu, thực hiện rồi nộp bài.',
        links: [
          { source: 'note:a', target: 'steps', reason: 'Suy luận: chuẩn bị trước khi làm.' },
          { source: 'steps', target: 'note:b', reason: 'Kiểm tra sau khi hoàn tất.' },
        ],
        warnings: ['Thứ tự là đề xuất để bạn kiểm tra.'],
      },
    })
  })
  await arrangeButton(page).click()
  await page.getByRole('button', { name: 'Dùng Codex', exact: true }).click()
  expect(calls).toBe(0)
  await page.getByRole('button', { name: 'Nhờ Codex sắp xếp', exact: true }).click()
  await expect(page.getByText('Đọc yêu cầu, thực hiện rồi nộp bài.', { exact: true })).toBeVisible()
  await expect(page.locator('.wb-connections g')).toHaveCount(1)
  await page.getByRole('checkbox', { name: 'Thêm mũi tên trình tự (2)' }).check()
  await expect(page.locator('.wb-connections g')).toHaveCount(3)
  expect((await (await page.request.get(path)).json()).edges).toEqual(layout.edges)
  await page.getByRole('button', { name: 'Áp dụng bố cục', exact: true }).click()
  await expect(page.locator('.arrange-dialog')).not.toBeVisible()
  await expect
    .poll(async () => Object.keys((await (await page.request.get(path)).json()).edges).length)
    .toBe(3)
  await expect(card(page, 'note:a')).toHaveCSS('left', '0px')
  await page.screenshot({ path: 'test-results/arrangement-codex-applied.png' })
  await page.getByRole('button', { name: 'Chuyển sang giao diện tối', exact: true }).click()
  await arrangeButton(page).click()
  await page.screenshot({ path: 'test-results/arrangement-dialog-dark.png' })
  await page.keyboard.press('Escape')
  await expect(page.locator('.work-board')).toBeVisible()
  await page.getByRole('button', { name: 'Hoàn tác sắp xếp', exact: true }).click()
  await expect
    .poll(async () => (await (await page.request.get(path)).json()).edges)
    .toEqual(layout.edges)
  await expect(card(page, 'note:a')).toHaveCSS('left', '700px')
  expect(calls).toBe(1)
})

test('provider errors and cancellation never apply a late proposal', async ({ page }) => {
  const { path, layout } = await fixture(page)
  await page.route('**/canvas/**/arrange', async (route) => {
    await route.fulfill({
      status: 503,
      json: { detail: 'Codex hết hạn mức. Chọn hàng/cột để tiếp tục.' },
    })
  })
  await arrangeButton(page).click()
  await page.getByRole('button', { name: 'Dùng Codex', exact: true }).click()
  await page.getByRole('button', { name: 'Nhờ Codex sắp xếp', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Codex hết hạn mức')
  await expect(page.getByRole('button', { name: 'Áp dụng bố cục', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Hủy', exact: true }).click()
  expect((await (await page.request.get(path)).json()).nodes).toEqual(layout.nodes)
  await page.unroute('**/canvas/**/arrange')
  let release!: () => void
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/canvas/**/arrange', async (route) => {
    await waiting
    await route
      .fulfill({
        json: { order: ['note:a', 'steps', 'note:b'], summary: 'Muộn', links: [], warnings: [] },
      })
      .catch(() => {})
  })
  await arrangeButton(page).click()
  await page.getByRole('button', { name: 'Dùng Codex', exact: true }).click()
  await page.getByRole('button', { name: 'Nhờ Codex sắp xếp', exact: true }).click()
  await expect(page.getByText('Codex đang suy luận…')).toBeVisible()
  await page.getByRole('button', { name: 'Hủy', exact: true }).click()
  release()
  await expect(card(page, 'note:a')).toHaveCSS('left', '700px')
  expect((await (await page.request.get(path)).json()).nodes).toEqual(layout.nodes)
  await arrangeButton(page).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.arrange-dialog')).not.toBeVisible()
  await expect(page.locator('.work-board')).toBeVisible()
})

test('home and course spaces arrange independently; mobile dialog remains within viewport', async ({
  page,
}) => {
  const a = await (
    await page.request.post('/api/v1/courses', { data: { title: 'Môn sắp xếp A' } })
  ).json()
  const b = await (
    await page.request.post('/api/v1/courses', { data: { title: 'Môn sắp xếp B' } })
  ).json()
  const due = await (
    await page.request.post('/api/v1/deadlines', {
      data: { title: 'Bài môn A', course_id: a.id, due_at: '2026-11-02' },
    })
  ).json()
  await page.reload()
  await arrangeButton(page).click()
  await page.getByRole('button', { name: 'Cột dọc', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Cột dọc', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: 'Áp dụng bố cục', exact: true }).click()
  await expect(page.locator('.arrange-dialog')).not.toBeVisible()
  const home = (await (await page.request.get('/api/v1/canvas/home')).json()).nodes
  expect(home['courses:' + a.id].x).toBe(0)
  expect(home['courses:' + b.id].x).toBe(0)
  await page.goto('/#space/' + a.id)
  await expect(page.locator('[data-canvas-node="deadlines:' + due.id + '"]')).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await arrangeButton(page).click()
  const dialog = page.locator('.arrange-dialog'),
    box = (await dialog.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(390)
  await page.screenshot({ path: 'test-results/arrangement-mobile.png' })
  await page.getByRole('button', { name: 'Áp dụng bố cục', exact: true }).click()
  await expect(page.locator('.arrange-dialog')).not.toBeVisible()
  expect((await (await page.request.get('/api/v1/canvas/home')).json()).nodes).toEqual(home)
  expect(
    (await (await page.request.get('/api/v1/canvas/course:' + a.id)).json()).nodes[
      'deadlines:' + due.id
    ],
  ).toEqual({ x: 0, y: 0 })
})

test('course Codex arrows persist and can be selected and removed on the canvas', async ({
  page,
}) => {
  const course = await (
    await page.request.post('/api/v1/courses', { data: { title: 'Môn có trình tự' } })
  ).json()
  const first = await (
    await page.request.post('/api/v1/deadlines', {
      data: { title: 'Bản nháp', course_id: course.id, due_at: '2026-11-01' },
    })
  ).json()
  const last = await (
    await page.request.post('/api/v1/deadlines', {
      data: { title: 'Nộp báo cáo', course_id: course.id, due_at: '2026-11-02' },
    })
  ).json()
  const keys = ['deadlines:' + first.id, 'deadlines:' + last.id],
    path = '/api/v1/canvas/course:' + course.id
  await page.goto('/#space/' + course.id)
  await page.reload()
  await expect(page.locator('.space-node')).toHaveCount(2)
  await page.route('**/canvas/**/arrange', (route) =>
    route.fulfill({
      json: {
        order: keys,
        summary: 'Soạn bản nháp trước khi nộp.',
        links: [{ source: keys[0], target: keys[1], reason: 'Theo các mốc hạn hiện có.' }],
        warnings: [],
      },
    }),
  )
  await arrangeButton(page).click()
  await page.getByRole('button', { name: 'Dùng Codex', exact: true }).click()
  await page.getByRole('button', { name: 'Nhờ Codex sắp xếp', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Thêm mũi tên trình tự (1)' }).check()
  await page.getByRole('button', { name: 'Áp dụng bố cục', exact: true }).click()
  await expect(page.locator('.arrange-dialog')).not.toBeVisible()
  await page.reload()
  const arrow = page.getByRole('button', {
    name: 'Chọn đường nối Bản nháp đến Nộp báo cáo',
    exact: true,
  })
  await expect(arrow).toBeAttached()
  await arrow.focus()
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Xóa đường nối', exact: true }).click()
  await expect
    .poll(async () => Object.keys((await (await page.request.get(path)).json()).edges).length)
    .toBe(0)
})

test('changing work content during Codex reasoning prevents applying a stale layout', async ({
  page,
}) => {
  const { work } = await fixture(page)
  let release!: () => void
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/canvas/**/arrange', async (route) => {
    await waiting
    await route.fulfill({
      json: { order: ['steps', 'note:a', 'note:b'], summary: 'Bố cục cũ', links: [], warnings: [] },
    })
  })
  await arrangeButton(page).click()
  await page.getByRole('button', { name: 'Dùng Codex', exact: true }).click()
  await page.getByRole('button', { name: 'Nhờ Codex sắp xếp', exact: true }).click()
  await expect(page.getByText('Codex đang suy luận…')).toBeVisible()
  await page.request.patch('/api/v1/tasks/' + work.id, { data: { title: 'Yêu cầu đã đổi' } })
  await expect(page.getByRole('heading', { name: 'Yêu cầu đã đổi', exact: true })).toBeVisible({
    timeout: 10000,
  })
  release()
  await expect(page.getByRole('button', { name: 'Áp dụng bố cục', exact: true })).toBeDisabled()
  await expect(page.getByRole('alert').first()).toContainText('đã thay đổi')
  await page.getByRole('button', { name: 'Hủy', exact: true }).click()
})
