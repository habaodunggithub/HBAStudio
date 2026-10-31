import { test, expect, type Page, type BrowserContext } from './fixtures'

async function mockConnections(page: Page, context: BrowserContext) {
  let codex: any = {
    installed: true,
    enabled: true,
    source: 'off',
    connected: false,
    account: null,
    pending: null,
    error: '',
  }
  let google: any = { configured: true, connected: false, conflicts: [] }
  let logins = 0,
    disconnects = 0
  await context.route('https://auth.openai.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Trang đăng nhập thử nghiệm</h1>' }),
  )
  await context.route('https://accounts.google.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Google thử nghiệm</h1>' }),
  )
  await page.route('**/api/v1/connections', (route) =>
    route.fulfill({ json: { mode: 'local', codex, google } }),
  )
  await page.route('**/api/v1/connections/codex/login', (route) => {
    if (route.request().method() === 'DELETE') codex = { ...codex, pending: null }
    else {
      logins++
      const device = route.request().postDataJSON().method === 'device'
      codex = {
        ...codex,
        pending: {
          login_id: 'fixture-login',
          url: 'https://auth.openai.com/' + (device ? 'codex/device' : 'oauth/authorize'),
          code: device ? 'TEST-1234' : null,
          method: device ? 'device' : 'browser',
          expires_at: new Date(Date.now() + 600000).toISOString(),
        },
      }
    }
    return route.fulfill({ json: codex })
  })
  await page.route('**/api/v1/connections/codex/system', (route) => {
    codex = {
      ...codex,
      connected: true,
      source: 'system',
      account: { email: 'local@example.test', plan: 'plus' },
    }
    return route.fulfill({ json: codex })
  })
  await page.route('**/api/v1/connections/codex', (route) => {
    disconnects++
    codex = { ...codex, connected: false, source: 'off', account: null }
    return route.fulfill({ json: codex })
  })
  await page.route('**/api/v1/google/authorize', (route) =>
    route.fulfill({ json: { url: 'https://accounts.google.com/o/oauth2/auth?state=fixture' } }),
  )
  return {
    codex: (patch: any) => {
      codex = { ...codex, ...patch }
    },
    google: (patch: any) => {
      google = { ...google, ...patch }
    },
    logins: () => logins,
    disconnects: () => disconnects,
  }
}

test('first launch offers optional connections, traps focus and can continue without sign-in', async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    localStorage.removeItem('hba-onboarding-done')
    localStorage.setItem('pdm-chat-open', 'false')
    localStorage.setItem('pdm-theme', 'light')
  })
  await mockConnections(page, context)
  // A fresh installation, even if another test created records in the shared test server.
  await page.route('**/api/v1/workspace', async (route) => {
    const response = await route.fetch()
    const data = await response.json()
    for (const key of ['courses', 'projects', 'tasks', 'deadlines']) data[key] = []
    await route.fulfill({ json: data })
  })
  await page.goto('/#space')
  const welcome = page.getByRole('dialog', { name: 'Chào mừng đến HBA Studio' })
  await expect(welcome).toBeVisible()
  await expect(welcome.getByRole('heading', { name: 'Bắt đầu theo nhịp của bạn.' })).toBeFocused()
  await expect(welcome.getByText('0/2 đã kết nối')).toBeVisible()
  await expect(welcome.locator('input[type=password]')).toHaveCount(0)
  const next = welcome.getByRole('button', { name: 'Bắt đầu, kết nối sau' })
  await next.focus()
  await page.keyboard.press('Tab')
  await expect(welcome.getByRole('button', { name: 'Chuyển sang giao diện tối' })).toBeFocused()
  await page.screenshot({ path: 'test-results/connections-welcome-light.png' })
  await next.click()
  await expect(welcome).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('hba-onboarding-done'))).toBe('1')
})

test('Codex sign-in waits for confirmation, restores pending state, supports device codes and disconnects only after confirmation', async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('pdm-chat-open', 'false')
    localStorage.setItem('pdm-theme', 'light')
  })
  const state = await mockConnections(page, context)
  await page.goto('/#connections')
  const panel = page.getByRole('dialog', { name: 'Tài khoản & kết nối' }),
    card = panel
      .locator('.connection-card')
      .filter({ has: page.getByRole('heading', { name: 'Codex', exact: true }) })
  const popup = page.waitForEvent('popup')
  await card.getByRole('button', { name: 'Kết nối Codex', exact: true }).click()
  const child = await popup
  await child.waitForURL('https://auth.openai.com/**')
  await expect(card.getByText('Chờ đăng nhập', { exact: true })).toBeVisible()
  await expect(card.getByText('Đã kết nối', { exact: true })).toHaveCount(0)
  await page.reload()
  await expect(card.getByRole('button', { name: 'Hủy đăng nhập' })).toBeVisible()
  state.codex({
    connected: true,
    source: 'app',
    pending: null,
    account: { email: 'myself@example.test', plan: 'plus' },
  })
  await expect(card.getByText('myself@example.test')).toBeVisible({ timeout: 10000 })
  for (const service of await panel.locator('.connection-card').all()) {
    expect(await service.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBeTruthy()
  }
  await expect(panel.getByRole('button', { name: 'Vào Không gian', exact: true })).toBeInViewport()
  await card.getByRole('button', { name: 'Ngắt kết nối', exact: true }).click()
  expect(state.disconnects()).toBe(0)
  const confirm = panel.getByRole('alertdialog')
  await expect(confirm).toContainText('Phiên Codex CLI/IDE không bị đăng xuất')
  await confirm.getByRole('button', { name: 'Ngắt kết nối', exact: true }).click()
  await expect(card.getByRole('button', { name: 'Kết nối Codex', exact: true })).toBeVisible()
  expect(state.disconnects()).toBe(1)
  await card.getByText('Cách kết nối khác', { exact: true }).click()
  await card.getByRole('button', { name: 'Đăng nhập bằng mã', exact: true }).click()
  await expect(card.getByText('TEST-1234', { exact: true })).toBeVisible()
  await card.getByRole('button', { name: 'Hủy đăng nhập', exact: true }).click()
  expect(state.logins()).toBe(2)
  await child.close()
})

test('Google consent is separate, configured by the distributor and reports connection errors honestly', async ({
  page,
  context,
}) => {
  const state = await mockConnections(page, context)
  await page.addInitScript(() => localStorage.setItem('pdm-chat-open', 'false'))
  await page.goto('/#connections')
  const panel = page.getByRole('dialog', { name: 'Tài khoản & kết nối' }),
    card = panel
      .locator('.connection-card')
      .filter({ has: page.getByRole('heading', { name: 'Google Calendar', exact: true }) })
  const popup = page.waitForEvent('popup')
  await card.getByRole('button', { name: 'Kết nối Google Calendar' }).click()
  const child = await popup
  await child.waitForURL('https://accounts.google.com/**')
  await expect(card.getByText('Chờ đăng nhập', { exact: true })).toBeVisible()
  state.google({
    connected: true,
    connected_at: new Date().toISOString(),
    account_label: 'calendar@example.test',
  })
  await expect(card.getByText('calendar@example.test')).toBeVisible({ timeout: 10000 })
  await card.getByText('App được truy cập những gì?', { exact: true }).click()
  await expect(card).toContainText('Các lịch khác không bị chỉnh sửa')
  await card.getByRole('button', { name: 'Chọn lịch & điều chỉnh đồng bộ' }).click()
  await expect(page.getByRole('tab', { name: 'Google Calendar', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await page.goto('/#connections')
  state.google({ connected: false, configured: false })
  await expect(page.getByRole('button', { name: 'Kết nối Google Calendar' })).toBeDisabled({
    timeout: 10000,
  })
  await expect(
    page.getByText('Kết nối Google chưa được thiết lập cho bản app này', { exact: true }),
  ).toBeVisible()
})

test('mobile dark connections retain readable controls and recover from failed sign-in requests', async ({
  page,
  context,
}) => {
  const state = await mockConnections(page, context)
  state.codex({
    connected: true,
    source: 'system',
    account: { email: 'myself@example.test', plan: 'plus' },
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    localStorage.setItem('pdm-theme', 'dark')
    localStorage.setItem('pdm-chat-open', 'false')
  })
  await page.goto('/#connections')
  const panel = page.getByRole('dialog', { name: 'Tài khoản & kết nối' })
  await expect(panel.getByText('myself@example.test')).toBeVisible()
  await page.screenshot({ path: 'test-results/connections-mobile-dark.png', fullPage: true })
  expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBeTruthy()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.route('**/api/v1/connections/codex/login', (route) =>
    route.fulfill({ status: 503, json: { detail: 'Chưa mở được đăng nhập. Hãy thử lại.' } }),
  )
  await panel.getByText('Cách kết nối khác', { exact: true }).click()
  await panel.getByRole('button', { name: 'Đăng nhập bằng mã', exact: true }).click()
  await expect(panel.getByRole('alert')).toContainText('Chưa mở được đăng nhập')
  await expect(panel.getByRole('button', { name: 'Đăng nhập tài khoản khác' })).toBeEnabled()
})

test('Google callback failures return to connections with a working retry button', async ({
  page,
  context,
}) => {
  await mockConnections(page, context)
  await page.addInitScript(() => localStorage.setItem('pdm-chat-open', 'false'))
  await page.goto('/?google=failed#connections')
  const panel = page.getByRole('dialog', { name: 'Tài khoản & kết nối' })
  await expect(panel.getByRole('alert')).toContainText('Chưa hoàn tất kết nối Google Calendar')
  const popup = page.waitForEvent('popup')
  await panel.getByRole('button', { name: 'Kết nối Google Calendar' }).click()
  const child = await popup
  await child.waitForURL('https://accounts.google.com/**')
  await child.close()
  await page.goto('/?google=limited#connections')
  await expect(panel.getByRole('alert')).toContainText('đang giãn lượt gọi')
})
