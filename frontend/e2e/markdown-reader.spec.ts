import { test, expect, type Page } from './fixtures'
const original =
  '# Kế hoạch học tập\n\n**Ưu tiên** một việc nhỏ.\n\n- [x] Đọc đề bài\n- [ ] Viết báo cáo\n\n| Việc | Hạn |\n| --- | --- |\n| Báo cáo | Thứ sáu |\n\n```js\nconst ready = true;\n```\n\n[Tham khảo](https://example.com)\n\n<script>window.markdownExecuted=true</script>\n\n[Đường dẫn bị chặn](javascript:alert(1))'
async function setup(page: Page, name = 'plan.md') {
  await page.addInitScript(() => {
    localStorage.setItem('pdm-chat-open', 'false')
    if (!localStorage.getItem('pdm-theme')) localStorage.setItem('pdm-theme', 'light')
  })
  await page.goto('/#space')
  await expect(page.getByRole('heading', { name: 'Các môn học', exact: true })).toBeVisible()
  const work = await (
      await page.request.post('/api/v1/tasks', { data: { title: 'Markdown trong không gian' } })
    ).json(),
    result = await page.request.post('/api/v1/knowledge/upload', {
      multipart: {
        work_kind: 'tasks',
        work_id: work.id,
        file: { name, mimeType: 'text/markdown', buffer: Buffer.from(original) },
      },
    }),
    doc = await result.json()
  expect(result.ok()).toBe(true)
  await page.request.patch('/api/v1/canvas/work:tasks:' + work.id, {
    data: {
      nodes: { ['document:' + doc.id]: { x: 0, y: 0 } },
      sizes: { ['document:' + doc.id]: { width: 560, height: 700 } },
      hidden: ['steps'],
      camera: { x: 20, y: 20, zoom: 1 },
    },
  })
  await page.goto('/#workspace/tasks/' + work.id)
  const card = page.locator('[data-board-card="document:' + doc.id + '"]')
  await expect(card.getByRole('heading', { name: 'Kế hoạch học tập', exact: true })).toBeVisible()
  return { card, url: '/api/v1/knowledge/documents/' + doc.id, doc, work }
}

test('Markdown previews formatting safely, edits in the card, resizes and saves the original file', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const { card, url } = await setup(page)
  await expect(card.getByRole('table')).toBeVisible()
  await expect(card.getByRole('checkbox')).toHaveCount(2)
  await expect(card.locator('pre code')).toHaveText('const ready = true;\n')
  await expect(card.getByRole('link', { name: 'Tham khảo', exact: true })).toHaveAttribute(
    'target',
    '_blank',
  )
  expect(await page.evaluate(() => (window as any).markdownExecuted)).toBeUndefined()
  expect(
    await card.getByRole('link', { name: 'Đường dẫn bị chặn' }).getAttribute('href'),
  ).not.toMatch(/^javascript:/)
  await page.screenshot({ path: 'test-results/markdown-formatting-light.png' })
  await card.getByRole('button', { name: 'Chỉnh sửa', exact: true }).click()
  const editor = card.getByRole('textbox', { name: 'Nội dung Markdown plan.md', exact: true }),
    updated = '# Báo cáo mới\n\n- [x] markdownuniquerevision\n\n**Nội dung đã sửa.**'
  await expect(editor).toHaveValue(original)
  await editor.fill(updated)
  await card.getByRole('button', { name: 'Xem trước', exact: true }).click()
  await expect(card.getByRole('heading', { name: 'Báo cáo mới', exact: true })).toBeVisible()
  await expect(card.getByRole('status')).toHaveText('Chưa lưu')
  expect(await (await page.request.get(url + '/file')).text()).toBe(original)
  const grip = card.getByRole('button', { name: 'Đổi kích thước thẻ plan.md', exact: true }),
    box = (await grip.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 - 70, { steps: 8 })
  await page.mouse.up()
  await expect(card).toHaveCSS('width', '650px')
  await card.getByRole('button', { name: 'Chỉnh sửa', exact: true }).click()
  await expect(editor).toHaveValue(updated)
  await editor.press('Control+s')
  await expect(card.getByRole('status')).toHaveText('Đã lưu')
  expect(await (await page.request.get(url + '/file')).text()).toBe(updated)
  await expect
    .poll(async () =>
      JSON.stringify(
        await (await page.request.get('/api/v1/knowledge/search?q=markdownuniquerevision')).json(),
      ),
    )
    .toContain('markdownuniquerevision')
  await page.reload()
  await expect(card.getByRole('heading', { name: 'Báo cáo mới', exact: true })).toBeVisible()
  await expect(card.getByRole('status')).toHaveText('Đã lưu')
  await page.screenshot({ path: 'test-results/markdown-preview-light.png' })
  await card.getByRole('button', { name: 'Chỉnh sửa', exact: true }).click()
  await expect(editor).toHaveValue(updated)
  await page.screenshot({ path: 'test-results/markdown-edit-light.png' })
  expect(errors).toEqual([])
})

test('Markdown keeps unsaved drafts across reloads and retries failed saves in dark theme', async ({
  page,
}) => {
  const { card, url, doc, work } = await setup(page, 'reading.markdown')
  await page.getByRole('button', { name: 'Chuyển sang giao diện tối', exact: true }).click()
  await card.getByRole('button', { name: 'Chỉnh sửa', exact: true }).click()
  const editor = card.getByRole('textbox', {
    name: 'Nội dung Markdown reading.markdown',
    exact: true,
  })
  await editor.fill('# Bản nháp chưa lưu\n\nGiữ lại khi tải lại thẻ.')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(card.getByRole('heading', { name: 'Bản nháp chưa lưu', exact: true })).toBeVisible()
  await expect(card.getByRole('status')).toHaveText('Chưa lưu')
  expect(await (await page.request.get(url + '/file')).text()).toBe(original)
  await card.getByLabel('Tùy chọn tài liệu reading.markdown', { exact: true }).click()
  await card.getByRole('button', { name: 'Tải lại tài liệu', exact: true }).click()
  await expect(card.getByRole('heading', { name: 'Bản nháp chưa lưu', exact: true })).toBeVisible()
  let fail = true
  await page.route('**/api/v1/knowledge/documents/' + doc.id + '/content', (route) =>
    route.request().method() === 'PUT' && fail
      ? route.fulfill({ status: 503, json: { detail: 'Chưa lưu được, hãy thử lại.' } })
      : route.continue(),
  )
  await card.getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(card.getByRole('alert')).toContainText('Chưa lưu được')
  await card.getByRole('button', { name: 'Chỉnh sửa', exact: true }).click()
  await expect(editor).toHaveValue('# Bản nháp chưa lưu\n\nGiữ lại khi tải lại thẻ.')
  await page.screenshot({ path: 'test-results/markdown-edit-dark.png' })
  fail = false
  await card.getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(card.getByRole('status')).toHaveText('Đã lưu')
  await expect(card.getByRole('alert')).toHaveCount(0)
  await page.request.patch('/api/v1/canvas/work:tasks:' + work.id, {
    data: { sizes: { ['document:' + doc.id]: { width: 260, height: 580 } } },
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await expect(card.getByRole('heading', { name: 'Bản nháp chưa lưu', exact: true })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/markdown-mobile-dark.png' })
})

test('Markdown blocks stale saves, keeps the draft and lets the reader load the newer file', async ({
  page,
}) => {
  const { card, url } = await setup(page)
  await card.getByRole('button', { name: 'Chỉnh sửa', exact: true }).click()
  const editor = card.getByRole('textbox', { name: 'Nội dung Markdown plan.md', exact: true })
  await editor.fill('# Nội dung đang soạn')
  const latest = await (await page.request.get(url + '/content')).json()
  expect(
    (
      await page.request.put(url + '/content', {
        data: { content: '# Bản từ cửa sổ khác', revision: latest.revision },
      })
    ).ok(),
  ).toBe(true)
  await card.getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(card.getByRole('alert')).toContainText('File đã thay đổi ở nơi khác')
  await expect(editor).toHaveValue('# Nội dung đang soạn')
  expect(await (await page.request.get(url + '/file')).text()).toBe('# Bản từ cửa sổ khác')
  await page.reload()
  await expect(card.getByRole('heading', { name: 'Nội dung đang soạn', exact: true })).toBeVisible()
  await expect(card.getByRole('alert')).toContainText('File đã thay đổi ở nơi khác')
  const download = page.waitForEvent('download')
  await card.getByRole('button', { name: 'Tải bản đang sửa', exact: true }).click()
  expect((await download).suggestedFilename()).toBe('plan.md')
  await card.getByRole('button', { name: 'Bỏ bản sửa, tải bản mới', exact: true }).click()
  await expect(card.getByRole('heading', { name: 'Bản từ cửa sổ khác', exact: true })).toBeVisible()
  await expect(card.getByRole('alert')).toHaveCount(0)
  await card.getByRole('button', { name: 'Chỉnh sửa', exact: true }).click()
  await editor.fill('')
  await card.getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(card.getByRole('status')).toHaveText('Đã lưu')
  await card.getByRole('button', { name: 'Xem trước', exact: true }).click()
  await expect(card.getByText('File Markdown chưa có nội dung.', { exact: true })).toBeVisible()
})
