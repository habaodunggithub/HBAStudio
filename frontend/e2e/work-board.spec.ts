import { test, expect, type Page } from './fixtures'
import { readFileSync } from 'node:fs'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pdm-chat-open', 'false')
    localStorage.setItem('pdm-theme', 'light')
  })
  await page.goto('/#space')
  await expect(page.getByRole('heading', { name: 'Các môn học', exact: true })).toBeVisible()
})
async function task(page: Page, title: string) {
  return (
    await page.request.post('/api/v1/tasks', {
      data: { title, description: 'Thông tin nằm trong menu ba chấm.' },
    })
  ).json()
}
async function drag(page: Page, locator: any, dx: number, dy: number) {
  const box = await locator.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 })
  await page.mouse.up()
}

test('default work board saves notes, card drag/resize and connections; AI is opt-in', async ({
  page,
}) => {
  const work = await task(page, 'Board cá nhân')
  const path = '/api/v1/canvas/work:tasks:' + work.id
  let analysisCalls = 0
  await page.route('**/workspaces/tasks/' + work.id + '/analyze', async (route) => {
    analysisCalls++
    await route.fulfill({ json: { status: 'queued' } })
  })
  await page.goto('/#workspace/tasks/' + work.id)
  await expect(page.getByRole('button', { name: 'Board', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.locator('.work-board')).toBeVisible()
  expect(analysisCalls).toBe(0)
  await expect(page.locator('.wb-suggestions')).toHaveCount(0)
  await page.getByLabel('Đầu việc mới', { exact: true }).fill('Đọc đề bài')
  await page.getByLabel('Đầu việc mới', { exact: true }).press('Enter')
  await expect(page.getByRole('checkbox', { name: 'Đọc đề bài' })).toBeVisible()
  // Wheel zooms about the pointer without requiring Ctrl; dragging still pans.
  const board = page.locator('.work-board'),
    box = (await board.boundingBox())!,
    point = { x: box.width - 80, y: box.height - 120 }
  const camera = () =>
    page.locator('.wb-world').evaluate((el) => {
      const m = new DOMMatrix(getComputedStyle(el).transform)
      return { zoom: m.a, x: m.e, y: m.f }
    })
  const beforeZoom = await camera(),
    anchor = {
      x: (point.x - beforeZoom.x) / beforeZoom.zoom,
      y: (point.y - beforeZoom.y) / beforeZoom.zoom,
    }
  await page.mouse.move(box.x + point.x, box.y + point.y)
  await page.mouse.wheel(0, 150)
  await expect.poll(async () => (await camera()).zoom).toBeLessThan(beforeZoom.zoom)
  const zoomed = await camera()
  expect((point.x - zoomed.x) / zoomed.zoom).toBeCloseTo(anchor.x, 2)
  expect((point.y - zoomed.y) / zoomed.zoom).toBeCloseTo(anchor.y, 2)
  await expect
    .poll(async () => (await (await page.request.get(path)).json()).camera?.zoom)
    .toBeCloseTo(zoomed.zoom, 4)
  await page.mouse.wheel(0, -150)
  await expect.poll(async () => (await camera()).zoom).toBeCloseTo(beforeZoom.zoom, 4)
  const revision = (await (await page.request.get('/api/v1/workspace')).json()).revision
  await drag(
    page,
    page.getByRole('button', { name: 'Di chuyển thẻ Đầu việc', exact: true }),
    90,
    30,
  )
  await drag(
    page,
    page.getByRole('button', { name: 'Đổi kích thước thẻ Đầu việc', exact: true }),
    60,
    40,
  )
  await page.getByRole('button', { name: 'Ghi chú', exact: true }).click()
  await page.getByLabel('Tên ghi chú', { exact: true }).fill('Ý tưởng')
  await page.getByLabel('Nội dung ghi chú', { exact: true }).fill('Bắt đầu từ một bước nhỏ.')
  await page.getByRole('button', { name: 'Mũi tên', exact: true }).click()
  await page.getByRole('button', { name: 'Nối thẻ Đầu việc', exact: true }).click()
  await page.getByRole('button', { name: 'Nối thẻ Ý tưởng', exact: true }).click()
  await expect
    .poll(async () => Object.keys((await (await page.request.get(path)).json()).edges || {}).length)
    .toBe(1)
  let saved = await (await page.request.get(path)).json()
  expect(saved.nodes.steps.x).toBeCloseTo(90)
  expect(saved.sizes.steps.width).toBeCloseTo(400)
  expect(Object.values(saved.cards)[0]).toMatchObject({ text: 'Bắt đầu từ một bước nhỏ.' })
  expect((await (await page.request.get('/api/v1/workspace')).json()).revision).toBe(revision)
  await page.reload()
  await expect(page.getByLabel('Nội dung ghi chú')).toHaveValue('Bắt đầu từ một bước nhỏ.')
  await expect(page.locator('.wb-connections g')).toHaveCount(1)
  await page.locator('.wb-edge-hit').focus()
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Xóa đường nối', exact: true }).click()
  await expect
    .poll(async () => Object.keys((await (await page.request.get(path)).json()).edges || {}).length)
    .toBe(0)
  await page.getByRole('button', { name: 'Ẩn thẻ Ý tưởng', exact: true }).click()
  await expect(page.getByLabel('Nội dung ghi chú')).toHaveCount(0)
  await page.getByRole('button', { name: /Hiện thẻ đã ẩn/ }).click()
  await expect(page.getByLabel('Nội dung ghi chú')).toHaveValue('Bắt đầu từ một bước nhỏ.')
  await page.getByLabel('Thao tác khác', { exact: true }).click()
  await page.getByRole('button', { name: 'Thông tin công việc', exact: true }).click()
  await page.getByText('Mô tả & liên kết', { exact: true }).click()
  await expect(page.getByText('Thông tin nằm trong menu ba chấm.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Đóng thông tin công việc' }).click()
  expect(analysisCalls).toBe(0)
  await page.getByRole('button', { name: 'Gợi ý Codex', exact: true }).click()
  await expect.poll(() => analysisCalls).toBe(1)
  await expect(page.locator('.wb-suggestions')).toHaveCount(1)
  await page.getByRole('button', { name: 'Danh sách', exact: true }).click()
  await expect(page.getByRole('tab', { name: /^Đầu việc/ })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Danh sách', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(analysisCalls).toBe(1)
})

test('PDF pages, DOCX scroll and XLSX sheets work independently inside movable reader cards', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1798, height: 1025 })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const work = await task(page, 'Đọc tài liệu trên board')
  const docs: any[] = []
  for (const extension of ['pdf', 'docx', 'xlsx']) {
    const response = await page.request.post('/api/v1/knowledge/upload', {
      multipart: {
        work_kind: 'tasks',
        work_id: work.id,
        file: {
          name: 'board-reader.' + extension,
          mimeType: 'application/octet-stream',
          buffer: readFileSync('e2e/fixtures/board-reader.' + extension),
        },
      },
    })
    expect(response.ok()).toBeTruthy()
    docs.push(await response.json())
  }
  const nodes: any = { steps: { x: 0, y: 0 } },
    sizes: any = {}
  docs.forEach((d, i) => {
    nodes['document:' + d.id] = { x: 370 + i * 380, y: 0 }
    sizes['document:' + d.id] = { width: 365, height: 540 }
  })
  const path = '/api/v1/canvas/work:tasks:' + work.id
  await page.request.patch(path, { data: { nodes, sizes, camera: { x: 20, y: 20, zoom: 1 } } })
  await page.goto('/#workspace/tasks/' + work.id)
  const pdf = page.locator('[data-board-card="document:' + docs[0].id + '"]'),
    docx = page.locator('[data-board-card="document:' + docs[1].id + '"]'),
    xlsx = page.locator('[data-board-card="document:' + docs[2].id + '"]')
  await expect(pdf.locator('[data-ready=true]')).toBeVisible()
  await pdf.getByRole('button', { name: 'Trang tiếp', exact: true }).click()
  await expect(pdf.getByLabel('Số trang')).toHaveValue('2')
  await expect(pdf.locator('[data-pdf-page="2"]')).toHaveAttribute('data-rendered', 'true')
  const transform = await page.locator('.wb-world').getAttribute('style')
  await pdf.locator('.reader-scroll').hover()
  await page.mouse.wheel(0, 180)
  await expect
    .poll(() => pdf.locator('.reader-scroll').evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0)
  expect(await page.locator('.wb-world').getAttribute('style')).toBe(transform)
  await expect(
    docx.frameLocator('iframe').getByText('Document board fixture', { exact: true }),
  ).toBeVisible()
  await docx.getByRole('button', { name: 'Trang tiếp', exact: true }).click()
  await expect(docx.getByLabel('Số trang')).toHaveValue('2')
  await expect(
    docx.frameLocator('iframe').getByText('Second DOCX page', { exact: true }),
  ).toBeVisible()
  await xlsx.getByLabel('Chọn sheet').selectOption('1')
  await expect(xlsx.getByRole('cell', { name: 'Total', exact: true })).toBeVisible()
  await xlsx.getByLabel('Chọn sheet').selectOption('0')
  await xlsx.getByRole('button', { name: '100 hàng tiếp', exact: true }).click()
  await expect(xlsx.getByRole('cell', { name: 'Row 101', exact: true })).toBeVisible()
  await xlsx.getByRole('button', { name: '40 cột tiếp', exact: true }).click()
  await expect(xlsx.getByRole('cell', { name: 'Column AP row 101', exact: true })).toBeVisible()
  await drag(page, pdf.getByRole('button', { name: /Di chuyển thẻ/ }), 0, 45)
  await drag(page, pdf.getByRole('button', { name: /Đổi kích thước/ }), 0, 35)
  await expect(pdf.getByLabel('Số trang')).toHaveValue('2')
  await expect(docx.getByLabel('Số trang')).toHaveValue('2')
  await expect(xlsx.getByLabel('Chọn sheet')).toHaveValue('0')
  await pdf.getByLabel('Tùy chọn tài liệu board-reader.pdf', { exact: true }).click()
  await expect(
    pdf.getByRole('link', { name: 'Mở file gốc board-reader.pdf', exact: true }),
  ).toHaveAttribute('href', /\/file$/)
  await page.keyboard.press('Escape')
  await expect(page.locator('.work-board')).toBeVisible()
  await pdf.getByLabel('Tùy chọn tài liệu board-reader.pdf', { exact: true }).click()
  await pdf.getByRole('button', { name: 'Tải lại tài liệu', exact: true }).click()
  await expect(pdf.getByLabel('Số trang')).toHaveValue('1')
  await expect(pdf.locator('[data-ready=true]')).toBeVisible()
  await pdf.locator('.reader-scroll').evaluate((el) => (el.scrollTop = 0))
  await page.screenshot({ path: 'test-results/work-board-readers.png' })
  expect(errors).toEqual([])
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await expect(page.locator('.work-board')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.getByRole('button', { name: 'Chuyển sang giao diện tối' }).click()
  await page.screenshot({ path: 'test-results/work-board-mobile.png' })
  expect(errors).toEqual([])
})

test('failed board saves retain the latest text for retry and flush when changing views', async ({
  page,
}) => {
  const work = await task(page, 'Board lưu an toàn'),
    path = '/api/v1/canvas/work:tasks:' + work.id
  await page.goto('/#workspace/tasks/' + work.id)
  await expect(page.locator('.work-board')).toBeVisible()
  await page.getByRole('button', { name: 'Thẻ công việc', exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'Thêm công việc', exact: true })
  await editor.getByLabel('Tên', { exact: true }).fill('Công việc con trên board')
  await editor.getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Di chuyển thẻ Công việc con trên board', exact: true }),
  ).toBeVisible()
  await expect
    .poll(async () => {
      const data = await (await page.request.get('/api/v1/workspace')).json()
      return data.tasks.find((t: any) => t.title === 'Công việc con trên board')?.parent_id
    })
    .toBe(work.id)
  let fail = true
  await page.route(
    '**/api/v1/canvas/' + encodeURIComponent('work:tasks:' + work.id),
    async (route) => {
      if (route.request().method() === 'PATCH' && fail) {
        await route.fulfill({ status: 503, json: { detail: 'Thử lại khi kết nối ổn định' } })
        return
      }
      await route.continue()
    },
  )
  await page.getByRole('button', { name: 'Ghi chú', exact: true }).click()
  await page.getByLabel('Nội dung ghi chú').fill('Phiên bản thứ nhất')
  await expect(page.locator('.wb-bottom [role=alert]')).toContainText('Chưa lưu')
  await page.getByLabel('Nội dung ghi chú').fill('Phiên bản mới nhất')
  fail = false
  await page.getByRole('button', { name: 'Thử lưu lại', exact: true }).click()
  await expect
    .poll(async () => {
      const layout = await (await page.request.get(path)).json()
      return Object.values(layout.cards || {}).map((n: any) => n.text)
    })
    .toContain('Phiên bản mới nhất')
  await page.getByLabel('Nội dung ghi chú').fill('Giữ lại khi đổi chế độ')
  await page.getByRole('button', { name: 'Danh sách', exact: true }).click()
  await expect(page.getByRole('tab', { name: /^Đầu việc/ })).toBeVisible()
  await expect
    .poll(async () => {
      const layout = await (await page.request.get(path)).json()
      return Object.values(layout.cards || {}).map((n: any) => n.text)
    })
    .toContain('Giữ lại khi đổi chế độ')
  await page.getByRole('button', { name: 'Board', exact: true }).click()
  await expect(page.getByLabel('Nội dung ghi chú')).toHaveValue('Giữ lại khi đổi chế độ')
})
