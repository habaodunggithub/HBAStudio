import { test, expect, Page } from './fixtures'
import { navigate, legacyPreferences } from './legacy'

test.beforeEach(async ({ page }) => {
  await legacyPreferences(page)
})

async function mockChat(page: Page, options: { hold?: boolean; failFirst?: boolean } = {}) {
  const threads: Record<string, any> = {}
  let sequence = 0,
    sends = 0,
    finishAt = Infinity
  let proposal: any = null
  await page.route('**/api/v1/chat/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname.split('/').slice(4),
      method = request.method()
    if (path.length === 1) {
      if (method === 'POST') {
        const t = {
          id: 'chat-' + ++sequence,
          title: 'Cuộc trò chuyện mới',
          updated_at: new Date().toISOString(),
          status: 'idle',
          messages: [],
        }
        threads[t.id] = t
        await route.fulfill({ json: t })
        return
      }
      await route.fulfill({
        json: {
          available: true,
          threads: Object.values(threads)
            .reverse()
            .map(({ messages, ...t }: any) => t),
        },
      })
      return
    }
    const t = threads[path[1]]
    if (path[2] === 'messages') {
      sends++
      if (options.failFirst && sends === 1) {
        await route.fulfill({ status: 503, json: { detail: 'Codex tạm mất kết nối' } })
        return
      }
      const payload = request.postDataJSON()
      t.title = payload.text
      t.status = 'running'
      t.messages.push(
        { id: 'user-' + sends, role: 'user', text: payload.text, context: payload.context },
        {
          id: 'assistant-' + sends,
          role: 'assistant',
          status: 'running',
          text: '',
          proposals: [],
          sources: [],
        },
      )
      t.activity = 'Đang đọc công việc…'
      finishAt = options.hold ? Infinity : Date.now() + 1000
      if (!options.hold) {
        proposal = await (
          await page.request.post('/api/v1/proposals', {
            data: {
              title: 'Việc ôn tập từ chat',
              reason: 'Yêu cầu trong chat',
              operations: [
                {
                  kind: 'tasks',
                  action: 'create',
                  data: { title: 'Ôn tập bằng chat', estimate_minutes: 30 },
                },
              ],
            },
          })
        ).json()
      }
    } else if (path[2] === 'interrupt') {
      t.status = 'idle'
      t.activity = ''
      t.messages.at(-1).status = 'interrupted'
      await route.fulfill({ json: { ok: true } })
      return
    } else if (t?.status === 'running' && Date.now() >= finishAt) {
      t.status = 'idle'
      t.activity = ''
      Object.assign(t.messages.at(-1), {
        status: 'completed',
        text: 'Đã chuẩn bị **bản nháp**. Bạn có thể xem trước rồi áp dụng.',
        proposals: [{ id: proposal.id, title: proposal.title, count: 1, status: 'draft' }],
        sources: [{ chunk_id: 'chat-source', title: 'Đề bài ôn tập', location: 'trang 1' }],
      })
    }
    await route.fulfill({ json: t })
  })
  await page.route('**/api/v1/knowledge/excerpts/chat-source', (route) =>
    route.fulfill({
      json: {
        title: 'Đề bài ôn tập',
        text: 'Ôn lại chương 1 và chương 2.',
        location: 'trang 1',
        hash: 'fixture',
        indexed_at: new Date().toISOString(),
      },
    }),
  )
  return { sends: () => sends, threads }
}

test('chat opens and closes, keeps an unsent draft and explains disabled Codex', async ({
  page,
}) => {
  await page.goto('/#space')
  const toggle = page.getByRole('button', { name: 'Chat với Codex', exact: true })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('dialog', { name: 'Chat với Codex' })).toHaveCount(0)
  await toggle.click()
  const dialog = page.getByRole('dialog', { name: 'Chat với Codex' })
  await expect(dialog).toContainText('Kết nối Codex để trò chuyện')
  await dialog.getByLabel('Tin nhắn cho Codex').fill('Tôi cần xem deadline tuần này')
  await dialog.getByRole('button', { name: 'Đóng chat', exact: true }).click()
  await expect(toggle).toBeFocused()
  await toggle.click()
  await expect(dialog.getByLabel('Tin nhắn cho Codex')).toHaveValue('Tôi cần xem deadline tuần này')
  await page.reload()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Tin nhắn cho Codex')).toHaveValue('Tôi cần xem deadline tuần này')
  await expect(dialog.getByRole('button', { name: 'Gửi tin nhắn' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
})

test('chat continues when hidden, restores history and opens a real proposal for review', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await mockChat(page)
  await page.goto('/#space')
  await page.getByRole('button', { name: 'Chat với Codex', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Chat với Codex' })
  await dialog.getByLabel('Tin nhắn cho Codex').fill('Tạo việc ôn tập 30 phút')
  await dialog.getByLabel('Tin nhắn cho Codex').press('Enter')
  await expect(dialog.getByRole('button', { name: 'Dừng trả lời' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Đóng chat', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: 'Chat với Codex', exact: true }).click()
  const card = dialog.getByRole('button', { name: /Việc ôn tập từ chat/ })
  await expect(card).toBeVisible()
  await expect(dialog.locator('strong')).toHaveText('bản nháp')
  const data = await (await page.request.get('/api/v1/workspace')).json()
  expect(data.tasks.some((t: any) => t.title === 'Ôn tập bằng chat')).toBeFalsy()
  await dialog.getByText('1 nguồn đã tra cứu', { exact: true }).click()
  await dialog.getByRole('button', { name: 'Đề bài ôn tập · trang 1' }).click()
  await expect(page.getByRole('dialog', { name: 'Đoạn nguồn' })).toContainText('Ôn lại chương 1')
  await page.getByRole('button', { name: 'Đóng đoạn nguồn' }).click()
  await page.screenshot({ path: 'test-results/chat-desktop.png', fullPage: true })
  await card.click()
  await expect(dialog).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Việc ôn tập từ chat', exact: true, level: 2 }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Áp dụng thay đổi', exact: true }).click()
  await expect(page.getByText('Đã áp dụng đề xuất', { exact: true })).toBeVisible()
  const after = await (await page.request.get('/api/v1/workspace')).json()
  expect(after.tasks.filter((t: any) => t.title === 'Ôn tập bằng chat')).toHaveLength(1)
  await dialog.getByRole('button', { name: 'Cuộc trò chuyện mới' }).click()
  await expect(dialog.getByText('Cứ đưa việc cho Codex.')).toBeVisible()
  await dialog.getByLabel('Lịch sử trò chuyện').selectOption('chat-1')
  await expect(
    dialog
      .getByRole('article', { name: 'Bạn', exact: true })
      .getByText('Tạo việc ôn tập 30 phút', { exact: true }),
  ).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  expect(errors).toEqual([])
})

test('mobile chat preserves input on failure, attaches workspace, cancels and traps focus', async ({
  page,
}) => {
  const mock = await mockChat(page, { hold: true, failFirst: true })
  await page.goto('/#space')
  await expect(page.getByRole('heading', { name: 'Các môn học', exact: true })).toBeVisible()
  const task = await (
    await page.request.post('/api/v1/tasks', { data: { title: 'Công việc gắn với chat' } })
  ).json()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#workspace/tasks/' + task.id)
  await page.getByRole('button', { name: 'Chuyển sang giao diện tối' }).click()
  await page.getByRole('button', { name: 'Chat với Codex', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Chat với Codex' })
  await expect(dialog).toHaveAttribute('aria-modal', 'true')
  await expect(dialog).toHaveCSS('background-color', 'rgb(34, 34, 34)')
  await expect(
    dialog.getByRole('checkbox', { name: 'Đính kèm: Công việc gắn với chat' }),
  ).toBeChecked()
  const input = dialog.getByLabel('Tin nhắn cho Codex')
  await input.fill('Giúp tôi chia nhỏ việc này')
  await input.press('Shift+Enter')
  await expect(input).toHaveValue('Giúp tôi chia nhỏ việc này\n')
  await dialog.getByRole('button', { name: 'Gửi tin nhắn' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Codex tạm mất kết nối')
  await expect(input).toHaveValue('Giúp tôi chia nhỏ việc này\n')
  await dialog.getByRole('button', { name: 'Gửi tin nhắn' }).click()
  await expect(dialog.getByRole('button', { name: 'Dừng trả lời' })).toBeVisible()
  const t = Object.values(mock.threads)[0]
  expect(t.messages[0].context).toEqual({ kind: 'tasks', id: task.id })
  const stop = dialog.getByRole('button', { name: 'Dừng trả lời' })
  await stop.focus()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Cuộc trò chuyện mới' })).not.toBeFocused() // disabled during a turn
  await expect(dialog.getByRole('button', { name: 'Đóng chat', exact: true })).toBeFocused()
  await stop.click()
  await expect(dialog.getByText('Đã dừng trả lời.', { exact: true })).toBeVisible()
  expect(mock.sends()).toBe(2)
  await page.screenshot({ path: 'test-results/chat-dark-mobile.png' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await dialog.getByRole('button', { name: 'Đóng chat', exact: true }).click()
  await expect(page.getByRole('heading', { name: task.title, exact: true })).toBeVisible()
})
