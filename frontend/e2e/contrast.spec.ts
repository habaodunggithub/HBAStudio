import { test, expect, type Locator } from './fixtures'

function luminance(color: string) {
  const rgb = color
    .match(/[\d.]+/g)!
    .slice(0, 3)
    .map(Number)
    .map((v) => {
      v /= 255
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    })
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
}
function ratio(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => x - y)
  return (values[1] + 0.05) / (values[0] + 0.05)
}
async function paint(locator: Locator, pseudo?: string) {
  return locator.evaluate((el, pseudo) => {
    const style = getComputedStyle(el, pseudo)
    let node: Element | null = el
    let background = 'rgb(255, 255, 255)'
    while (node) {
      const color = getComputedStyle(node).backgroundColor
      if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') {
        background = color
        break
      }
      node = node.parentElement
    }
    return { color: style.color, background, border: style.borderLeftColor, opacity: style.opacity }
  }, pseudo)
}

test('both palettes keep workspace text, placeholders, boundaries and focus visible', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('pdm-chat-open', 'false')
    localStorage.setItem('pdm-theme', 'light')
  })
  await page.goto('/#space')
  await expect(page.getByRole('heading', { name: 'Các môn học', exact: true })).toBeVisible()
  const course = await (
    await page.request.post('/api/v1/courses', { data: { title: 'Môn kiểm tra tương phản' } })
  ).json()
  const task = await (
    await page.request.post('/api/v1/tasks', {
      data: { title: 'Không gian làm việc rõ ràng', course_id: course.id },
    })
  ).json()
  for (const theme of ['light', 'dark']) {
    await page.goto('/#space')
    if (theme === 'dark')
      await page.getByRole('button', { name: 'Chuyển sang giao diện tối', exact: true }).click()
    const courseCard = page
      .locator('.space-node')
      .filter({ has: page.getByRole('button', { name: 'Mở ' + course.title, exact: true }) })
    for (const node of [
      courseCard.locator('b'),
      courseCard.locator('small').first(),
      page.locator('.space-grip').first(),
    ]) {
      const sample = await paint(node)
      expect(ratio(sample.color, sample.background)).toBeGreaterThanOrEqual(4.5)
      expect(sample.opacity).toBe('1')
    }
    await page.goto('/#workspace/tasks/' + task.id)
    await expect(page.locator('.work-board')).toBeVisible()
    for (const selector of [
      '.work-heading h1',
      '.wb-handle',
      '.work-empty > span',
      '.wb-toolbar .text-btn',
      '.work-view-switch button[aria-pressed=true]',
      '.wb-resize',
    ]) {
      const sample = await paint(page.locator(selector).first())
      expect(ratio(sample.color, sample.background), theme + ' ' + selector).toBeGreaterThanOrEqual(
        4.5,
      )
    }
    const placeholder = await paint(
      page.getByLabel('Đầu việc mới', { exact: true }),
      '::placeholder',
    )
    expect(placeholder.opacity).toBe('1')
    expect(ratio(placeholder.color, placeholder.background)).toBeGreaterThanOrEqual(4.5)
    const card = await paint(page.locator('.wb-card').first()),
      canvas = await paint(page.locator('.work-board'))
    expect(ratio(card.border, card.background)).toBeGreaterThanOrEqual(3)
    expect(ratio(card.border, canvas.background)).toBeGreaterThanOrEqual(3)
    const mode = page.getByRole('button', { name: 'Board', exact: true })
    await mode.focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
    const focus = await mode.evaluate((el) => ({
      color: getComputedStyle(el).outlineColor,
      style: getComputedStyle(el).outlineStyle,
    }))
    expect(focus.style).not.toBe('none')
    const active = await paint(mode)
    expect(ratio(focus.color, active.background)).toBeGreaterThanOrEqual(3)
    await page.screenshot({ path: 'test-results/contrast-' + theme + '.png' })
  }
})
