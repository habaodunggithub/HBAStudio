import { test, expect, Page } from './fixtures'

async function create(page: Page, kind: string, data: any) {
  const response = await page.request.post('/api/v1/' + kind, { data })
  expect(response.ok()).toBeTruthy()
  return response.json()
}
async function boot(page: Page, chat = false) {
  await page.addInitScript((value) => {
    localStorage.setItem('pdm-chat-open', String(value))
    localStorage.setItem('pdm-theme', 'light')
  }, chat)
  await page.request.get('/api/v1/bootstrap')
}
async function findCourse(page: Page, title: string) {
  await page.getByRole('button', { name: 'Tìm trong không gian', exact: true }).click()
  await page.getByLabel('Tìm môn học hoặc deadline').fill(title)
  await page.getByRole('button', { name: 'Vừa không gian', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Mở ' + title, exact: true })).toBeVisible()
}

test('selected canvas visual has the four course objects and an integrated chat', async ({
  page,
}) => {
  await boot(page, true)
  await page.setViewportSize({ width: 1628, height: 966 })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const names = ['Hệ điều hành', 'Nhập môn CNPM', 'Trí tuệ nhân tạo', 'PP nghiên cứu khoa học']
  const courseIds: string[] = []
  for (let index = 0; index < names.length; index++) {
    const course = await create(page, 'courses', { title: names[index] })
    courseIds.push(course.id)
    if (index < 3)
      for (let n = 0; n < (index === 0 ? 3 : 2); n++)
        await create(page, 'deadlines', {
          title: [
            ['Lab 3', 'Lab 4', 'Báo cáo thực hành'],
            ['Báo cáo', 'Đồ án nhóm'],
            ['Bloxorz', 'Báo cáo AI'],
          ][index][n],
          course_id: course.id,
          due_at: `2026-10-${[25, 27, 29][index] + n}`,
        })
    else await create(page, 'tasks', { title: 'Đề cương nghiên cứu', course_id: course.id })
  }
  await page.route('**/api/v1/workspace', async (route) => {
    const response = await route.fetch(),
      data = await response.json()
    data.courses = data.courses.filter((c: any) => courseIds.includes(c.id))
    for (const kind of ['deadlines', 'tasks', 'projects', 'notes'])
      data[kind] = data[kind].filter((item: any) => courseIds.includes(item.course_id))
    await route.fulfill({ json: data })
  })
  const messages = [
    { id: 'u1', role: 'user', text: 'Tuần này tôi nên làm gì trước?' },
    {
      id: 'a1',
      role: 'assistant',
      status: 'completed',
      text: 'Ưu tiên Lab 3 môn Hệ điều hành: hạn 25/10, còn 2 ngày. Sau đó là báo cáo CNPM ngày 27/10.\n\nBạn có thể gửi tài liệu hoặc dán tin nhắn giảng viên để mình tổng hợp deadline.',
      proposals: [],
      sources: [],
    },
  ]
  const thread = {
    id: 'visual-fixture',
    title: 'Việc cần làm tuần này',
    status: 'idle',
    updated_at: '2026-10-23T03:14:00Z',
    messages,
  }
  await page.route('**/api/v1/chat/threads', (route) =>
    route.fulfill({ json: { available: true, threads: [thread] } }),
  )
  await page.route('**/api/v1/chat/threads/visual-fixture', (route) =>
    route.fulfill({ json: thread }),
  )
  await page.goto('/#space')
  await expect(page.locator('.space-node')).toHaveCount(4)
  await expect(page.getByRole('dialog', { name: 'Chat với Codex' })).toBeVisible()
  await expect(page.locator('.chat-message')).toHaveCount(2)
  await page.getByRole('button', { name: 'Vừa không gian', exact: true }).click()
  await expect(page.locator('.space-saved')).toContainText('Đã lưu vị trí')
  await page.evaluate(() => {
    ;(document.activeElement as HTMLElement)?.blur()
  })
  await page.getByRole('button', { name: 'Mở Hệ điều hành', exact: true }).hover()
  await page.screenshot({ path: 'test-results/canvas-desktop.png' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  expect(errors).toEqual([])
  await page.getByRole('button', { name: 'Mở Hệ điều hành', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Hệ điều hành', exact: true })).toBeVisible()
  await expect(page.locator('.space-node')).toHaveCount(3)
  await expect(page.locator('.chat-scope')).toContainText('Hệ điều hành')
  await page.screenshot({ path: 'test-results/canvas-course.png' })
  await page.getByRole('button', { name: 'Mở Lab 3', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Lab 3', exact: true })).toBeVisible()
  await expect(page.locator('.chat-scope')).toContainText('Lab 3')
  await page.getByRole('button', { name: 'Quay lại Hệ điều hành', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Hệ điều hành', exact: true })).toBeVisible()
})

test('drag, keyboard movement, pan and zoom persist per board without changing deadlines', async ({
  page,
}) => {
  await boot(page)
  const course = await create(page, 'courses', { title: 'Môn kiểm chứng không gian' })
  const deadlineTitle =
    'Deadline không gian với tên bài tập rất dài để kiểm chứng ngày nộp luôn hiển thị'
  await create(page, 'deadlines', {
    title: deadlineTitle,
    course_id: course.id,
    due_at: '2026-10-27',
  })
  await page.goto('/#space')
  await findCourse(page, course.title)
  const summary = page.getByRole('button', { name: 'Mở ' + course.title, exact: true })
  await expect(summary.locator('time')).toHaveText('· 27/10')
  expect(
    await summary.evaluate((el) => {
      const title = el.querySelector('.space-next-title') as HTMLElement,
        date = el.querySelector('time')!
      return (
        title.scrollWidth > title.clientWidth &&
        date.getBoundingClientRect().right <= el.getBoundingClientRect().right
      )
    }),
  ).toBeTruthy()
  const revision = (await (await page.request.get('/api/v1/workspace')).json()).revision
  const grip = page.getByRole('button', { name: 'Di chuyển ' + course.title, exact: true }),
    box = (await grip.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 110, box.y + 80, { steps: 12 })
  await page.mouse.up()
  const key = 'courses:' + course.id
  await expect
    .poll(async () => !!(await (await page.request.get('/api/v1/canvas/home')).json()).nodes[key])
    .toBeTruthy()
  const before = (await (await page.request.get('/api/v1/canvas/home')).json()).nodes[key]
  await grip.focus()
  await page.keyboard.press('ArrowRight')
  await expect
    .poll(async () => (await (await page.request.get('/api/v1/canvas/home')).json()).nodes[key].x)
    .toBe(before.x + 20)
  await page.getByRole('button', { name: 'Phóng to không gian', exact: true }).click()
  const percent = await page.getByRole('button', { name: 'Đặt thu phóng 100%' }).textContent()
  await expect
    .poll(
      async () =>
        Math.round(
          (await (await page.request.get('/api/v1/canvas/home')).json()).camera.zoom * 100,
        ) + '%',
    )
    .toBe(percent)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Đặt thu phóng 100%' })).toHaveText(percent!)
  expect((await (await page.request.get('/api/v1/workspace')).json()).revision).toBe(revision)
  await findCourse(page, course.title)
  await page.getByRole('button', { name: 'Mở ' + course.title, exact: true }).click()
  await expect(page.getByRole('button', { name: 'Mở ' + deadlineTitle, exact: true })).toBeVisible()
  const old = (await (await page.request.get('/api/v1/canvas/course:' + course.id)).json()).camera
  const viewport = await page.locator('.space-viewport').boundingBox()
  await page.mouse.move(viewport!.x + 25, viewport!.y + 300)
  await page.mouse.down()
  await page.mouse.move(viewport!.x + 65, viewport!.y + 340, { steps: 10 })
  await page.mouse.up()
  await expect
    .poll(
      async () =>
        (await (await page.request.get('/api/v1/canvas/course:' + course.id)).json()).camera?.x,
    )
    .not.toBe(old?.x)
  expect((await (await page.request.get('/api/v1/canvas/home')).json()).nodes[key].x).toBe(
    before.x + 20,
  )
})

test('source box saves pasted teacher messages in the current course', async ({ page }) => {
  await boot(page)
  const course = await create(page, 'courses', { title: 'Môn nguồn tài liệu' })
  await page.goto('/#space/' + course.id)
  await page.getByRole('button', { name: 'Thêm tài liệu', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Thêm nguồn cho Codex' })
  await dialog
    .getByLabel('Tin nhắn hoặc yêu cầu của giảng viên')
    .fill('Nộp báo cáo môn học ngày 27/10/2026 lúc 23:59. Cần có mã nguồn và kết quả kiểm thử.')
  await expect(dialog.getByLabel('Môn học của nguồn')).toHaveValue(course.id)
  await dialog.getByRole('checkbox', { name: 'Nhờ Codex tổng hợp và cập nhật deadline' }).uncheck()
  await dialog.getByRole('button', { name: 'Thêm nguồn', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect
    .poll(async () =>
      (await (await page.request.get('/api/v1/workspace')).json()).documents.some(
        (d: any) => d.course_id === course.id && d.title === 'Tin nhắn giảng viên.md',
      ),
    )
    .toBeTruthy()
})

test('chat sends course context and auto mode, reflects applied data and can undo', async ({
  page,
}) => {
  await boot(page, true)
  const course = await create(page, 'courses', { title: 'Môn AI quản lý' })
  let thread: any = null,
    payload: any = null
  await page.route('**/api/v1/chat/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname,
      method = request.method()
    if (path.endsWith('/threads') && method === 'GET') {
      await route.fulfill({ json: { available: true, threads: thread ? [thread] : [] } })
      return
    }
    if (path.endsWith('/threads') && method === 'POST') {
      thread = {
        id: 'auto-fixture',
        title: 'Quản lý bằng AI',
        status: 'idle',
        messages: [],
        updated_at: new Date().toISOString(),
      }
      await route.fulfill({ json: thread })
      return
    }
    if (path.endsWith('/messages')) {
      payload = request.postDataJSON()
      const proposal = await create(page, 'proposals', {
        title: 'Thêm deadline từ chat',
        reason: 'Yêu cầu trực tiếp',
        operations: [
          {
            kind: 'deadlines',
            action: 'create',
            data: { title: 'Deadline AI đã tạo', course_id: course.id, due_at: '2026-10-29' },
          },
        ],
      })
      const applied = await (
        await page.request.post('/api/v1/proposals/' + proposal.id + '/apply')
      ).json()
      thread = {
        ...thread,
        status: 'idle',
        messages: [
          { id: 'u', role: 'user', text: payload.text },
          {
            id: 'a',
            role: 'assistant',
            status: 'completed',
            text: 'Đã thêm deadline vào môn học.',
            proposals: [
              {
                id: proposal.id,
                title: proposal.title,
                count: 1,
                status: 'applied',
                revision_id: applied.revision_id,
              },
            ],
            sources: [],
          },
        ],
      }
    }
    await route.fulfill({ json: thread })
  })
  await page.goto('/#space/' + course.id)
  await expect(page.getByRole('dialog', { name: 'Chat với Codex' })).toBeVisible()
  await page.getByRole('button', { name: 'Thêm nguồn', exact: true }).click()
  const intake = page.getByRole('dialog', { name: 'Thêm nguồn cho Codex' })
  await intake
    .getByLabel('Tin nhắn hoặc yêu cầu của giảng viên')
    .fill('Môn AI quản lý: nộp Deadline AI đã tạo vào ngày 29/10/2026 lúc 23:59.')
  await intake.getByRole('button', { name: 'Thêm và tổng hợp', exact: true }).click()
  await expect(page.locator('.chat-change')).toContainText('Đã áp dụng', { timeout: 25000 })
  expect(payload.context).toEqual({ kind: 'courses', id: course.id })
  expect(payload.auto_apply).toBe(true)
  expect(payload.document_ids).toHaveLength(1)
  // The mocked provider still writes via the real proposal/domain endpoints.
  await expect(
    page.getByRole('button', { name: 'Mở Deadline AI đã tạo', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Hoàn tác', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Mở Deadline AI đã tạo', exact: true }),
  ).toHaveCount(0)
})

test('mobile keeps canvas controls visible and chat preserves its draft', async ({ page }) => {
  await boot(page)
  await page.setViewportSize({ width: 390, height: 844 })
  const course = await create(page, 'courses', { title: 'Môn kiểm tra điện thoại' })
  await page.goto('/#space/' + course.id)
  await expect(page.getByRole('button', { name: 'Thêm deadline', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Vừa không gian', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.screenshot({ path: 'test-results/canvas-mobile.png' })
  await page.getByRole('button', { name: 'Chat với Codex', exact: true }).click()
  await page.getByLabel('Tin nhắn cho Codex').fill('Nhắc tôi đọc yêu cầu trước')
  await page.getByRole('button', { name: 'Đóng chat', exact: true }).click()
  await page.getByRole('button', { name: 'Chat với Codex', exact: true }).click()
  await expect(page.getByLabel('Tin nhắn cho Codex')).toHaveValue('Nhắc tôi đọc yêu cầu trước')
  await page.screenshot({ path: 'test-results/canvas-chat-mobile.png' })
})

test('editing deadline information preserves the exact teacher due time', async ({ page }) => {
  await boot(page)
  const course = await create(page, 'courses', { title: 'Môn có giờ nộp cụ thể' })
  const deadline = await create(page, 'deadlines', {
    title: 'Báo cáo nộp 17h30',
    course_id: course.id,
    due_at: '2026-10-29T17:30:00+07:00',
  })
  await page.goto('/#space/' + course.id)
  await page.getByRole('button', { name: 'Sửa Báo cáo nộp 17h30', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Sửa deadline' })
  await dialog.getByLabel('Mô tả / ghi chú').fill('Theo thông báo giảng viên.')
  await dialog.getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const saved = (await (await page.request.get('/api/v1/deadlines')).json()).find(
    (d: any) => d.id === deadline.id,
  )
  expect(saved.due_at).toBe('2026-10-29T17:30:00+07:00')
  await page.getByRole('button', { name: 'Mở Báo cáo nộp 17h30', exact: true }).click()
  await page.getByLabel('Thao tác khác', { exact: true }).click()
  await page.getByRole('button', { name: 'Thông tin công việc', exact: true }).click()
  await expect(page.locator('.work-info-panel')).toContainText('17:30')
  await expect(page.getByText('Theo thông báo giảng viên.', { exact: true })).toBeVisible()
})

test('mobile restores readable cards from offscreen or clipped desktop cameras', async ({
  page,
}) => {
  await boot(page)
  const course = await create(page, 'courses', { title: 'Môn chuyển màn hình' })
  await create(page, 'deadlines', {
    title: 'Bài tập cần đọc trên điện thoại',
    course_id: course.id,
    due_at: '2026-11-01',
  })
  await page.goto('/#space/' + course.id)
  const card = page.getByRole('button', { name: 'Mở Bài tập cần đọc trên điện thoại', exact: true })
  await expect(card).toBeVisible()
  await expect(page.locator('.space-saved')).toContainText('Đã lưu vị trí')
  const revision = (await (await page.request.get('/api/v1/workspace')).json()).revision
  for (const x of [500, 168]) {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.request.patch('/api/v1/canvas/course:' + course.id, {
      data: { camera: { x, y: 90, zoom: 1 } },
    })
    await page.reload()
    await expect(card).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect
      .poll(async () => {
        const box = await card.boundingBox()
        return !!box && box.x >= 64 && box.x + box.width <= 390 && box.width >= 250
      })
      .toBeTruthy()
    await expect
      .poll(
        async () =>
          (await (await page.request.get('/api/v1/canvas/course:' + course.id)).json()).camera.zoom,
      )
      .toBeLessThan(1)
  }
  expect((await (await page.request.get('/api/v1/workspace')).json()).revision).toBe(revision)
})
