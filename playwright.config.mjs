import { defineConfig } from '@playwright/test';
export default defineConfig({
    testDir: './tests/browser',
    timeout: 30000,
    workers: 1,
    use: {
        baseURL: 'http://127.0.0.1:8080',
        headless: true,
        launchOptions: {
            executablePath: process.env.KRYOFIX_CHROMIUM || undefined,
            args: ['--no-sandbox', '--disable-dev-shm-usage']
        },
        trace: 'retain-on-failure'
    },
    webServer: process.env.CI ? { command: 'npm run serve', url: 'http://127.0.0.1:8080', reuseExistingServer: false } : undefined
});
