import { defineConfig } from '@playwright/test';
const chromium = { browserName: 'chromium', launchOptions: { executablePath: process.env.KRYOFIX_CHROMIUM || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] } };
export default defineConfig({
    testDir: './tests/browser', timeout: 45000, workers: 2,
    use: { baseURL: 'http://127.0.0.1:8080', headless: true, trace: 'retain-on-failure' },
    projects: [
        { name: 'escritorio', use: { ...chromium, viewport: { width: 1280, height: 900 } } },
        { name: 'telefono', use: { ...chromium, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
        { name: 'tablet-vertical', use: { ...chromium, viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
        { name: 'tablet-horizontal', use: { ...chromium, viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
        { name: 'safari-tablet', use: { browserName: 'webkit', viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } }
    ],
    webServer: process.env.CI ? { command: 'npm run serve', url: 'http://127.0.0.1:8080', reuseExistingServer: false } : undefined
});
