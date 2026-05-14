import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.PORT || 3010)
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${port}`

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: {
    timeout: 30_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['line']] : [['line']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : {
        command: `npm run dev -- -p ${port}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          ...process.env,
          PORT: String(port),
        },
      },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
