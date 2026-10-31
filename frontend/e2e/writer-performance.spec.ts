import { test, expect, type Page } from './fixtures'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

async function setup(page: Page, zoom = 0.8, width = 900) {
  // Observe the real Writer viewport alongside its result; this does not
  // substitute an engine response or add a production inspection endpoint.
  await page.route('**/office/writer-worker.js', async (route) => {
    const response = await route.fetch()
    const body = (await response.text()).replace(
      "send({ cmd: 'result', request: message.request, zoom });",
      "send({ cmd: 'result', request: message.request, zoom, observedView: zeta.fromAny(controller.getViewData()) });",
    )
    await route.fulfill({ response, body })
  })
  await page.addInitScript(() => {
    localStorage.setItem('pdm-chat-open', 'false')
    localStorage.setItem('pdm-theme', 'light')
  })
  await page.goto('/#space')
  await expect(page.getByRole('heading', { name: 'Các môn học', exact: true })).toBeVisible()
  const work = await (
    await page.request.post('/api/v1/tasks', { data: { title: 'Writer multi-page checks' } })
  ).json()
  const doc = await (
    await page.request.post('/api/v1/knowledge/upload', {
      multipart: {
        work_kind: 'tasks',
        work_id: work.id,
        file: {
          name: 'writer-multipage.docx',
          mimeType: 'application/octet-stream',
          buffer: readFileSync('e2e/fixtures/writer-multipage.docx'),
        },
      },
    })
  ).json()
  await page.request.patch('/api/v1/canvas/work:tasks:' + work.id, {
    data: {
      nodes: { ['document:' + doc.id]: { x: 0, y: 0 } },
      sizes: { ['document:' + doc.id]: { width, height: 750 } },
      hidden: ['steps'],
      camera: { x: 20, y: 20, zoom },
    },
  })
  await page.goto('/#workspace/tasks/' + work.id)
  const card = page.locator('[data-board-card="document:' + doc.id + '"]')
  await card.getByRole('button', { name: 'Chỉnh sửa', exact: true }).click()
  const editor = card.frameLocator('iframe[title="Chỉnh sửa DOCX"]')
  const canvas = editor.getByRole('textbox', { name: 'Nội dung tài liệu Word' })
  await expect(editor.getByRole('button', { name: 'In đậm', exact: true })).toBeEnabled({
    timeout: 60000,
  })
  await expect(card.locator('.docx-save-state')).toHaveText('Đã lưu')
  const frame = page.frames().find((frame) => frame.url().includes('docx-editor.html'))!
  // Observe acknowledgements at the real native boundary, without adding a
  // production timing/test API or substituting fake Writer results.
  await frame.evaluate(() => {
    const probe = { sent: 0, completed: 0, view: '' }
    ;(window as any).__writerInput = probe
    const original = MessagePort.prototype.postMessage
    const ports = new WeakSet<MessagePort>(),
      pending = new Map<string, number>()
    MessagePort.prototype.postMessage = function (message: any, ...args: any[]) {
      if (['keys', 'viewport'].includes(message?.cmd)) {
        const count = message.cmd === 'keys' ? message.events.length : 0
        probe.sent += count
        pending.set(message.request, count)
        if (!ports.has(this)) {
          ports.add(this)
          this.addEventListener('message', (event) => {
            const count = pending.get(event.data?.request)
            if (count !== undefined) {
              probe.completed += count
              pending.delete(event.data.request)
              if (event.data.observedView) probe.view = event.data.observedView
            }
          })
        }
      }
      return (original as any).call(this, message, ...args)
    }
  })
  let expected = 0
  const settled = async (count: number, timeout = 1500) => {
    expected += count
    await expect
      .poll(() => frame.evaluate(() => (window as any).__writerInput.completed), {
        timeout,
        intervals: [20, 40, 80],
      })
      .toBe(expected)
  }
  return { card, editor, canvas, frame, doc, settled }
}
function textOf(bytes: Buffer) {
  return execFileSync(
    'python3',
    [
      '-c',
      `import sys,io,zipfile
from xml.etree import ElementTree as E
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:
 r=E.fromstring(z.read('word/document.xml'))
 print(''.join(t.text or '' for t in r.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t')))`,
    ],
    { input: bytes },
  ).toString()
}

test('multi-page Writer keeps typing bursts, Backspace and Delete responsive and correctly ordered', async ({
  page,
}) => {
  test.setTimeout(120000)
  const { card, canvas, doc, settled } = await setup(page)
  await canvas.focus()
  await page.keyboard.press('Control+Home')
  await settled(1)
  const token = 'abcdefghijklmnopqrstuvwxyz0123456789'
  await page.keyboard.type(token)
  await settled(token.length)
  // A second burst must append at a collapsed caret, keeping the first burst.
  await page.keyboard.type('-continued-')
  await settled(11)
  for (let n = 0; n < 11; n++) await page.keyboard.press('Backspace')
  await settled(11)
  await page.keyboard.press('Control+Home')
  await settled(1)
  for (let n = 0; n < 5; n++) await page.keyboard.press('Delete')
  await settled(5)
  await card.getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(card.locator('.docx-save-state')).toHaveText('Đã lưu', { timeout: 45000 })
  const bytes = await (
    await page.request.get('/api/v1/knowledge/documents/' + doc.id + '/file')
  ).body()
  const text = textOf(bytes).toLowerCase()
  expect(text.startsWith(token.slice(5))).toBeTruthy()
  expect(text).not.toContain('-continued-')
  expect(text).toContain('page 8: editing on the board')
  expect(text).toContain('original cell')
  await expect(card.getByRole('alert')).toHaveCount(0)
})

test('narrow zoomed-out cards keep a single toolbar row, accessible tools and proportional paper', async ({
  page,
}) => {
  test.setTimeout(120000)
  const { card, editor, canvas } = await setup(page, 0.4, 650)
  const toolbar = editor.getByRole('toolbar')
  await expect
    .poll(() => toolbar.evaluate((element) => parseFloat(getComputedStyle(element).height)))
    .toBeCloseTo(42, 1)
  expect((await toolbar.boundingBox())!.height).toBeCloseTo(42 * 0.4, 1)
  const geometry = await toolbar.evaluate((element) => ({
    width: element.clientWidth,
    content: element.scrollWidth,
    tops: [...element.querySelectorAll('button,select')].map(
      (control) => control.getBoundingClientRect().top,
    ),
  }))
  expect(geometry.content).toBeGreaterThan(geometry.width)
  expect(Math.max(...geometry.tops) - Math.min(...geometry.tops)).toBeLessThan(1)
  const world = await page.locator('.wb-world').getAttribute('style')
  await toolbar.hover()
  await page.mouse.wheel(0, 400)
  await expect.poll(() => toolbar.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
  expect(await page.locator('.wb-world').getAttribute('style')).toBe(world)
  await expect(card.locator('.docx-save-state')).toHaveText('Đã lưu')
  await editor.getByRole('button', { name: 'Vừa chiều rộng thẻ', exact: true }).click()
  await expect(card.locator('.docx-save-state')).toHaveText('Đã lưu')
  const zoom = Number(await canvas.getAttribute('data-document-zoom'))
  await page.screenshot({ path: 'test-results/writer-narrow-40.png' })
  await page.getByRole('button', { name: 'Thu nhỏ board', exact: true }).click()
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-document-zoom')) / zoom)
    .toBeCloseTo(1 / 1.2, 1)
  await expect
    .poll(() => toolbar.evaluate((element) => parseFloat(getComputedStyle(element).height)))
    .toBeCloseTo(42, 1)
  expect((await toolbar.boundingBox())!.height).toBeCloseTo((42 * 0.4) / 1.2, 1)
  await expect(card.locator('.docx-save-state')).toHaveText('Đã lưu')
  await page.screenshot({ path: 'test-results/writer-narrow-33.png' })
})

for (const dpr of [1, 2])
  test.describe('Writer DPR ' + dpr, () => {
    test.use({ deviceScaleFactor: dpr })
    test('renders at screen resolution through board zoom without replacing its iframe', async ({
      page,
    }) => {
      test.setTimeout(120000)
      await page.setViewportSize({ width: 1798, height: 1025 })
      const { card, editor, canvas, frame, settled } = await setup(page)
      await canvas.evaluate((element) => element.setAttribute('data-editor-session', 'kept'))
      const density = async () => {
        const width = (await card.locator('iframe').boundingBox())!.width
        return frame.evaluate(
          (width) => document.querySelector<HTMLCanvasElement>('#qtcanvas')!.width / width,
          width,
        )
      }
      await expect.poll(density).toBeCloseTo(dpr, 1)
      await canvas.focus()
      for (let n = 0; n < 4; n++) await page.keyboard.press('PageDown')
      await settled(4)
      const originalZoom = Number(await canvas.getAttribute('data-document-zoom'))
      const originalView = await frame.evaluate(() =>
        (window as any).__writerInput.view.split(';').map(Number),
      )
      expect(originalView[4]).toBeGreaterThan(0)
      const toolbar = editor.getByRole('toolbar'),
        undo = editor.getByRole('button', { name: 'Hoàn tác', exact: true })
      const cardWidth = (await card.boundingBox())!.width
      const toolbarHeight = (await toolbar.boundingBox())!.height
      const buttonHeight = (await undo.boundingBox())!.height
      expect(toolbarHeight).toBeCloseTo(42 * 0.8, 1)
      await page.screenshot({ path: 'test-results/writer-density-' + dpr + '-80.png' })
      const board = (await page.locator('.work-board').boundingBox())!
      await page.mouse.move(board.x + 5, board.y + 5)
      await page.mouse.wheel(0, -300)
      await expect(page.locator('.wb-world')).not.toHaveCSS('transform', /matrix\(0\.8,/)
      await expect.poll(density).toBeCloseTo(dpr, 1)
      const scale = await page
        .locator('.wb-world')
        .evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).a)
      await expect
        .poll(async () => Number(await canvas.getAttribute('data-document-zoom')) / originalZoom)
        .toBeCloseTo(scale / 0.8, 1)
      await expect
        .poll(() => toolbar.evaluate((element) => parseFloat(getComputedStyle(element).height)))
        .toBeCloseTo(42, 1)
      const nextCardWidth = (await card.boundingBox())!.width
      expect((await toolbar.boundingBox())!.height / nextCardWidth).toBeCloseTo(
        toolbarHeight / cardWidth,
        4,
      )
      expect((await undo.boundingBox())!.height / nextCardWidth).toBeCloseTo(
        buttonHeight / cardWidth,
        4,
      )
      const zoomedView = await frame.evaluate(() =>
        (window as any).__writerInput.view.split(';').map(Number),
      )
      expect(Math.abs(zoomedView[4] - originalView[4])).toBeLessThan(240)
      writeFileSync(
        'test-results/writer-viewport-' + dpr + '.json',
        JSON.stringify(
          {
            dpr,
            initialBoardScale: 0.8,
            nextBoardScale: scale,
            initialDocumentZoom: originalZoom,
            nextDocumentZoom: Number(await canvas.getAttribute('data-document-zoom')),
            initialViewTop: originalView[4],
            nextViewTop: zoomedView[4],
            toolbarHeight,
            nextToolbarHeight: (await toolbar.boundingBox())!.height,
            buttonHeight,
            nextButtonHeight: (await undo.boundingBox())!.height,
            cardWidth,
            nextCardWidth,
          },
          null,
          2,
        ),
      )
      await expect(canvas).toHaveAttribute('data-editor-session', 'kept')
      // A proportional resize also must repaint at the actual new pixel size.
      const handle = card.getByRole('button', {
        name: 'Đổi kích thước thẻ writer-multipage.docx',
        exact: true,
      })
      const width = await card.evaluate((element) => (element as HTMLElement).offsetWidth)
      await handle.focus()
      await page.keyboard.press('Shift+ArrowRight')
      await page.keyboard.press('Shift+ArrowDown')
      await expect
        .poll(() => card.evaluate((element) => (element as HTMLElement).offsetWidth))
        .toBe(width + 40)
      await expect.poll(density).toBeCloseTo(dpr, 1)
      await expect(canvas).toHaveAttribute('data-editor-session', 'kept')
      await page.screenshot({ path: 'test-results/writer-density-' + dpr + '-zoomed.png' })
    })
  })
