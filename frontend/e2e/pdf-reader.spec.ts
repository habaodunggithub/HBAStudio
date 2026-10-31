import { test, expect } from './fixtures'
import { readFileSync } from 'node:fs'

for (const dpr of [1, 2])
  test.describe('PDF at DPR ' + dpr, () => {
    test.use({ deviceScaleFactor: dpr, viewport: { width: 1440, height: 1000 } })
    test('scrolls continuously, updates the page indicator and renders sharp pages without retaining every bitmap', async ({
      page,
    }) => {
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.addInitScript(() => {
        localStorage.setItem('pdm-chat-open', 'false')
        localStorage.setItem('pdm-theme', 'dark')
      })
      await page.goto('/#space')
      await expect(page.getByRole('heading', { name: 'Các môn học', exact: true })).toBeVisible()
      const work = await (
        await page.request.post('/api/v1/tasks', { data: { title: 'Đọc PDF liên tục DPR ' + dpr } })
      ).json()
      const upload = await page.request.post('/api/v1/knowledge/upload', {
        multipart: {
          work_kind: 'tasks',
          work_id: work.id,
          file: {
            name: 'continuous.pdf',
            mimeType: 'application/pdf',
            buffer: readFileSync('e2e/fixtures/board-reader-many.pdf'),
          },
        },
      })
      expect(upload.ok()).toBe(true)
      const doc = await upload.json()
      await page.request.patch('/api/v1/canvas/work:tasks:' + work.id, {
        data: {
          nodes: { ['document:' + doc.id]: { x: 0, y: 0 } },
          sizes: { ['document:' + doc.id]: { width: 500, height: 680 } },
          hidden: ['steps'],
          camera: { x: 20, y: 20, zoom: 1 },
        },
      })
      await page.goto('/#workspace/tasks/' + work.id)
      const card = page.locator('[data-board-card="document:' + doc.id + '"]'),
        scroll = card.locator('.pdf-continuous'),
        first = card.locator('[data-pdf-page="1"]'),
        last = card.locator('[data-pdf-page="20"]')
      await expect(first).toHaveAttribute('data-rendered', 'true')
      await expect(card.locator('[data-pdf-page]')).toHaveCount(20)
      await expect
        .poll(() => first.locator('canvas').evaluate((el) => el.width / parseFloat(el.style.width)))
        .toBeGreaterThanOrEqual(dpr * 2)
      const transform = await page.locator('.wb-world').getAttribute('style')
      await scroll.hover()
      await page.mouse.wheel(0, 620)
      await expect(card.getByLabel('Số trang')).toHaveValue('2')
      await expect(card.locator('[data-pdf-page="2"]')).toHaveAttribute('data-rendered', 'true')
      expect(await page.locator('.wb-world').getAttribute('style')).toBe(transform)
      await scroll.evaluate((el) => (el.scrollTop = 450))
      await expect(card.getByLabel('Số trang')).toHaveValue('1')
      await page.screenshot({ path: `test-results/pdf-continuous-pages-dpr-${dpr}.png` })
      await card.getByLabel('Số trang').fill('20')
      await expect(last).toHaveAttribute('data-rendered', 'true')
      await expect(card.getByLabel('Số trang')).toHaveValue('20')
      await expect.poll(() => first.locator('canvas').count()).toBe(0)
      expect(await card.locator('canvas').count()).toBeLessThan(8)
      const board = await page.locator('.work-board').boundingBox()
      expect(board).not.toBeNull()
      await page.mouse.move(board!.x + 5, board!.y + 5)
      await page.mouse.wheel(0, -400)
      await expect
        .poll(() => last.locator('canvas').evaluate((el) => Number(el.dataset.pixelRatio)))
        .toBeGreaterThanOrEqual(Math.min(6, dpr * 4))
      await card.getByRole('button', { name: 'Phóng to tài liệu', exact: true }).click()
      await expect(card.getByLabel('Số trang')).toHaveValue('20')
      await expect
        .poll(() => last.locator('canvas').evaluate((el) => parseFloat(el.style.width)))
        .toBe(500)
      const image = await last.locator('canvas').evaluate((el) => {
        const pixels = el
          .getContext('2d')!
          .getImageData(
            0,
            0,
            el.width,
            Math.min(el.height, Math.ceil(160 * Number(el.dataset.pixelRatio))),
          ).data
        let ink = 0
        for (let i = 0; i < pixels.length; i += 4)
          if (pixels[i] < 100 && pixels[i + 1] < 100 && pixels[i + 2] < 100) ink++
        return { ink, pixels: el.width * el.height }
      })
      expect(image.ink).toBeGreaterThan(100)
      expect(image.pixels).toBeLessThan(16 * 1024 * 1024 + 10000)
      await page.screenshot({ path: `test-results/pdf-continuous-dpr-${dpr}.png` })
      expect(errors).toEqual([])
    })
  })
