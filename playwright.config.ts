import { defineConfig, devices } from '@playwright/test';

/**
 * Screen tests: the real app (built with a local address) against tests/fake-supabase.mjs,
 * which runs the real SQL migrations on an in-memory PostgreSQL (PGlite) with demo data.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:54321/',
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } } },
    { name: 'celular', use: { ...devices['Pixel 7'], browserName: 'chromium' } }
  ],
  webServer: {
    command: 'npm run e2e:server',
    url: 'http://localhost:54321/',
    reuseExistingServer: false,
    timeout: 120_000
  }
});
