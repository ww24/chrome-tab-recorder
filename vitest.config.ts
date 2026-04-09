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
                    include: ['tests/**/*.test.ts'],
                    exclude: ['tests/element/**/*.test.ts'],
                },
            },
            {
                extends: true,
                test: {
                    name: 'browser',
                    include: ['tests/element/**/*.test.ts'],
                    setupFiles: ['tests/element/test-setup.ts'],
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
