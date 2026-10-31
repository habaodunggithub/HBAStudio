import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    storageState: {
      cookies: [],
      origins: [
        {
          origin: 'http://127.0.0.1:8766',
          localStorage: [{ name: 'hba-onboarding-done', value: '1' }],
        },
      ],
    },
    baseURL: 'http://127.0.0.1:8766',
    timezoneId: 'Asia/Ho_Chi_Minh',
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  reporter: 'list',
})
