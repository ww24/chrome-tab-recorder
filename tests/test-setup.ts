import { vi } from 'vitest'
import { mockGetMessage } from './i18n-mock'
;(globalThis as Record<string, unknown>).chrome = {
    i18n: {
        getMessage: vi.fn(mockGetMessage),
        getUILanguage: vi.fn(() => 'en'),
    },
}
