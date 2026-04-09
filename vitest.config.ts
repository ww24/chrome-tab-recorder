import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
    test: {
        globals: true,
        coverage: {
            provider: 'v8',
            reporter: ['lcov', 'text'],
        },
        projects: [
            {
                extends: true,
                test: {
                    name: 'node',
                    include: ['src/**/*.test.ts'],
                    exclude: ['src/element/**/*.test.ts'],
                },
            },
            {
                extends: true,
                test: {
                    name: 'browser',
                    include: ['src/element/**/*.test.ts'],
                    setupFiles: ['src/element/test-setup.ts'],
                    browser: {
                        enabled: true,
                        provider: playwright(),
                        headless: true,
                        instances: [{ browser: 'chromium' }],
                    },
                },
            },
        ],
    },
})
