import { test, expect, type Page, type Locator } from './fixtures'

async function mockChat(page: Page, failFirst = false) {
  let thread: any = null
  const payloads: any[] = []
  await page.route('**/api/v1/chat/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()).pathname,
      method = request.method()
    if (url.endsWith('/threads') && method === 'GET') {
      await route.fulfill({ json: { available: true, threads: thread ? [thread] : [] } })
      return
    }
    if (url.endsWith('/threads') && method === 'POST') {
      thread = {
        id: 'tag-fixture',
        title: 'Các thẻ đã chọn',
        status: 'idle',
        updated_at: new Date().toISOString(),
        messages: [],
      }
      await route.fulfill({ json: thread })
      return
    }
    if (url.endsWith('/messages')) {
      const payload = request.postDataJSON()
      payloads.push(payload)
      if (failFirst && payloads.length === 1) {
        await route.fulfill({ status: 503, json: { detail: 'Thử gửi lại khi kết nối ổn định' } })
        return
      }
      thread = {
        ...thread,
        messages: [
          ...thread.messages,
          {
            id: 'user-' + payloads.length,
            role: 'user',
            text: payload.text,
            context: payload.context,
            card_references: payload.card_references,
            attached_cards: payload.card_references.map((card: any) => ({
              ...card,
              title: card.card_key === 'steps' ? 'Đầu việc' : 'Ý tưởng',
              work_title: 'Đồ án',
            })),
          },
          {
            id: 'answer-' + payloads.length,
            role: 'assistant',
            text: 'Đã nhận các thẻ bạn chọn.',
            status: 'completed',
            sources: [],
            proposals: [],
          },
        ],
      }
    }
    await route.fulfill({ json: thread })
  })
  return payloads
}
async function setup(page: Page, failFirst = false) {
  await page.addInitScript(() => {
    localStorage.setItem('pdm-chat-open', 'false')
    if (!localStorage.getItem('pdm-theme')) localStorage.setItem('pdm-theme', 'light')
  })
  await page.goto('/#space')
  await expect(page.getByRole('heading', { name: 'Các môn học', exact: true })).toBeVisible()
  const work = await (
      await page.request.post('/api/v1/projects', { data: { title: 'Đồ án được gắn thẻ' } })
    ).json(),
    path = '/api/v1/canvas/work:projects:' + work.id
  await page.request.patch(path, {
    data: {
      cards: { 'note:tag': { title: 'Ý tưởng', text: 'Bắt đầu từ bản phân tích.' } },
      nodes: { steps: { x: 0, y: 360 }, 'note:tag': { x: 0, y: 0 } },
      sizes: { steps: { width: 340, height: 300 }, 'note:tag': { width: 340, height: 300 } },
      camera: { x: 20, y: 20, zoom: 1 },
    },
  })
  const payloads = await mockChat(page, failFirst)
  await page.goto('/#workspace/projects/' + work.id)
  await expect(page.locator('.wb-note')).toBeVisible()
  return {
    work,
    path,
    payloads,
    note: page.locator('[data-board-card="note:tag"]'),
    chat: page.getByRole('dialog', { name: 'Chat với Codex' }),
  }
}
async function startDrag(page: Page, handle: Locator) {
  const box = (await handle.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 22, box.y + box.height / 2 + 12, { steps: 4 })
}

test('card tags click and keyboard attach, save pending notes, deduplicate, persist and send only chosen references', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const { work, path, payloads, note, chat } = await setup(page)
  await note.getByLabel('Nội dung ghi chú', { exact: true }).fill('Bản mới nhất trước khi gắn thẻ')
  const handle = note.getByRole('button', { name: 'Gắn thẻ Ý tưởng vào Codex', exact: true })
  await handle.click()
  await expect(chat.getByRole('list', { name: 'Thẻ đính kèm Codex' }).locator('li')).toHaveCount(1)
  expect((await (await page.request.get(path)).json()).cards['note:tag'].text).toBe(
    'Bản mới nhất trước khi gắn thẻ',
  )
  await expect(handle).toHaveAttribute('aria-pressed', 'true')
  expect(payloads).toHaveLength(0)
  await chat.getByLabel('Tin nhắn cho Codex').fill('Hãy đọc thẻ này')
  await handle.click()
  await expect(chat.getByRole('list', { name: 'Thẻ đính kèm Codex' }).locator('li')).toHaveCount(1)
  await expect(chat.getByLabel('Tin nhắn cho Codex')).toHaveValue('Hãy đọc thẻ này')
  const steps = page.getByRole('button', { name: 'Gắn thẻ Đầu việc vào Codex', exact: true })
  await steps.focus()
  await page.keyboard.press('Enter')
  await expect(chat.getByRole('list', { name: 'Thẻ đính kèm Codex' }).locator('li')).toHaveCount(2)
  await chat
    .getByRole('button', { name: 'Bỏ thẻ Đầu việc (' + work.title + ')', exact: true })
    .click()
  await chat.getByRole('button', { name: 'Đóng chat', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: 'Chat với Codex', exact: true }).click()
  await expect(chat.getByRole('list', { name: 'Thẻ đính kèm Codex' }).locator('li')).toHaveCount(1)
  await expect(chat.getByLabel('Tin nhắn cho Codex')).toHaveValue('Hãy đọc thẻ này')
  await page.screenshot({ path: 'test-results/card-tags-light.png' })
  await chat.getByRole('button', { name: 'Gửi tin nhắn', exact: true }).click()
  await expect.poll(() => payloads.length).toBe(1)
  expect(payloads[0].card_references).toEqual([
    { kind: 'projects', id: work.id, card_key: 'note:tag' },
  ])
  expect(payloads[0].context).toEqual({ kind: 'projects', id: work.id })
  await expect(chat.getByRole('list', { name: 'Thẻ đính kèm Codex' })).toHaveCount(0)
  await expect(chat.getByRole('list', { name: 'Thẻ đã gửi' })).toContainText('Ý tưởng')
  expect(errors).toEqual([])
})

test('dragging the dot opens chat and attaches on drop; outside drops and Escape cancel without moving the card', async ({
  page,
}) => {
  const { path, payloads, note, chat } = await setup(page)
  const handle = note.getByRole('button', { name: 'Gắn thẻ Ý tưởng vào Codex', exact: true }),
    before = (await (await page.request.get(path)).json()).nodes['note:tag']
  await startDrag(page, handle)
  await expect(chat).toBeVisible()
  const target = (await chat.locator('.chat-compose').boundingBox())!
  await page.mouse.move(target.x + target.width / 2, target.y + 45, { steps: 12 })
  await expect(chat).toHaveClass(/is-card-drop-over/)
  await page.screenshot({ path: 'test-results/card-tags-drag.png' })
  await page.mouse.up()
  await expect(chat.getByRole('list', { name: 'Thẻ đính kèm Codex' }).locator('li')).toHaveCount(1)
  expect((await (await page.request.get(path)).json()).nodes['note:tag']).toEqual(before)
  expect(payloads).toHaveLength(0)
  await chat.getByRole('button', { name: /Bỏ thẻ Ý tưởng/ }).click()
  await chat.getByRole('button', { name: 'Đóng chat', exact: true }).click()
  await startDrag(page, handle)
  await expect(chat).toBeVisible()
  const board = (await page.locator('.work-board').boundingBox())!
  await page.mouse.move(board.x + 80, board.y + 40, { steps: 5 })
  await page.mouse.up()
  await expect(chat.getByRole('list', { name: 'Thẻ đính kèm Codex' })).toHaveCount(0)
  await startDrag(page, handle)
  await expect(page.locator('.card-tag-ghost')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(page.locator('.card-tag-ghost')).toHaveCount(0)
  await expect(chat).toBeVisible()
  await expect(page.locator('.work-board')).toBeVisible()
  await expect(chat.getByRole('list', { name: 'Thẻ đính kèm Codex' })).toHaveCount(0)
  await handle.focus()
  await page.keyboard.press('Enter')
  await expect(chat.getByRole('list', { name: 'Thẻ đính kèm Codex' }).locator('li')).toHaveCount(1)
})

test('tags stay across workspaces and failed sends; removing a tag excludes it from retry', async ({
  page,
}) => {
  const { work, payloads, note, chat } = await setup(page, true)
  await note.getByRole('button', { name: 'Gắn thẻ Ý tưởng vào Codex', exact: true }).click()
  const other = await (
    await page.request.post('/api/v1/tasks', { data: { title: 'Công việc thứ hai' } })
  ).json()
  await page.goto('/#workspace/tasks/' + other.id)
  await page.getByRole('button', { name: 'Gắn thẻ Đầu việc vào Codex', exact: true }).click()
  await expect(chat.getByRole('list', { name: 'Thẻ đính kèm Codex' }).locator('li')).toHaveCount(2)
  await chat.getByLabel('Tin nhắn cho Codex').fill('So sánh hai thẻ')
  await chat.getByRole('button', { name: 'Gửi tin nhắn', exact: true }).click()
  await expect(chat.getByRole('alert')).toContainText('Thử gửi lại')
  await expect(chat.getByLabel('Tin nhắn cho Codex')).toHaveValue('So sánh hai thẻ')
  expect(payloads[0].card_references).toEqual([
    { kind: 'projects', id: work.id, card_key: 'note:tag' },
    { kind: 'tasks', id: other.id, card_key: 'steps' },
  ])
  await chat.getByRole('button', { name: /Bỏ thẻ Ý tưởng/ }).click()
  await chat.getByRole('button', { name: 'Gửi tin nhắn', exact: true }).click()
  await expect.poll(() => payloads.length).toBe(2)
  expect(payloads[1].card_references).toEqual([{ kind: 'tasks', id: other.id, card_key: 'steps' }])
})

test('mobile can tap the card dot to attach and remove a tag in dark chat', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const { chat } = await setup(page)
  await page.getByRole('button', { name: 'Chuyển sang giao diện tối', exact: true }).click()
  await page.getByRole('button', { name: 'Gắn thẻ Đầu việc vào Codex', exact: true }).click()
  await expect(chat).toBeVisible()
  await expect(chat.getByRole('list', { name: 'Thẻ đính kèm Codex' }).locator('li')).toHaveCount(1)
  await page.screenshot({ path: 'test-results/card-tags-mobile-dark.png' })
  await chat.getByRole('button', { name: /Bỏ thẻ Đầu việc/ }).click()
  await expect(chat.getByRole('list', { name: 'Thẻ đính kèm Codex' })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('tagging waits for an in-flight save and the newer queued note text', async ({ page }) => {
  const { path, note, chat } = await setup(page)
  let release!: () => void,
    started = false
  const gate = new Promise<void>((resolve) => (release = resolve))
  await page.route(
    '**/api/v1/canvas/' + encodeURIComponent('work:projects:' + path.split(':').at(-1)),
    async (route) => {
      if (
        route.request().method() === 'PATCH' &&
        route.request().postDataJSON().cards &&
        !started
      ) {
        started = true
        await gate
      }
      await route.continue()
    },
  )
  await note.getByLabel('Nội dung ghi chú', { exact: true }).fill('Lần lưu đầu đang chờ')
  await expect.poll(() => started).toBe(true)
  await note.getByLabel('Nội dung ghi chú', { exact: true }).fill('Nội dung mới trong hàng chờ')
  await note.getByRole('button', { name: 'Gắn thẻ Ý tưởng vào Codex', exact: true }).click()
  await expect(chat).toHaveCount(0)
  release()
  await expect(chat.getByRole('list', { name: 'Thẻ đính kèm Codex' }).locator('li')).toHaveCount(1)
  expect((await (await page.request.get(path)).json()).cards['note:tag'].text).toBe(
    'Nội dung mới trong hàng chờ',
  )
})
