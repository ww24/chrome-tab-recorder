import { vi } from 'vitest'
import { mockGetMessage } from './i18n-mock'
;(globalThis as Record<string, unknown>).chrome = {
    i18n: {
        getMessage: vi.fn(mockGetMessage),
        getUILanguage: vi.fn(() => 'en'),
    },
}

if (typeof (globalThis as Record<string, unknown>).localStorage === 'undefined') {
    const store = new Map<string, string>()
    ;(globalThis as Record<string, unknown>).localStorage = {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, val: string) => store.set(key, String(val)),
        removeItem: (key: string) => store.delete(key),
        clear: () => store.clear(),
        key: (index: number) => Array.from(store.keys())[index] ?? null,
        get length() {
            return store.size
        },
    }
}
