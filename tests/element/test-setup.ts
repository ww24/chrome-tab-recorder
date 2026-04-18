import 'vitest-browser-lit'
import { beforeEach, vi } from 'vitest'
import { mockGetMessage } from '../i18n-mock'

// ── Chrome API Mocks ─────────────────────────────────────────────────────────

type MessageListener = (message: unknown, sender: unknown, sendResponse: (response?: unknown) => void) => void
type StorageListener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void

const messageListeners: MessageListener[] = []
const storageListeners: StorageListener[] = []

const chromeMock = {
    i18n: {
        getMessage: vi.fn(mockGetMessage),
        getUILanguage: vi.fn(() => 'en'),
    },
    runtime: {
        onMessage: {
            addListener: vi.fn((listener: MessageListener) => {
                messageListeners.push(listener)
            }),
            removeListener: vi.fn((listener: MessageListener) => {
                const idx = messageListeners.indexOf(listener)
                if (idx !== -1) messageListeners.splice(idx, 1)
            }),
            hasListeners: vi.fn(() => messageListeners.length > 0),
        },
        sendMessage: vi.fn(() => Promise.resolve()),
        getURL: vi.fn((path: string) => `chrome-extension://mock-id/${path}`),
    },
    storage: {
        local: {
            get: vi.fn(() => Promise.resolve({})),
            set: vi.fn(() => Promise.resolve()),
            remove: vi.fn(() => Promise.resolve()),
        },
        sync: {
            get: vi.fn(() => Promise.resolve({})),
            set: vi.fn(() => Promise.resolve()),
        },
        onChanged: {
            addListener: vi.fn((listener: StorageListener) => {
                storageListeners.push(listener)
            }),
            removeListener: vi.fn((listener: StorageListener) => {
                const idx = storageListeners.indexOf(listener)
                if (idx !== -1) storageListeners.splice(idx, 1)
            }),
        },
    },
}

    // Always install chrome mock (in Chromium, window.chrome exists but lacks extension APIs)
    ; (globalThis as Record<string, unknown>).chrome = chromeMock

beforeEach(() => {
    // Clear all listener arrays
    messageListeners.length = 0
    storageListeners.length = 0

    // Reset all mock function call history
    vi.clearAllMocks()
})

// ── Export helpers for tests ─────────────────────────────────────────────────

/**
 * Simulate a chrome.runtime.onMessage dispatch.
 * Calls all registered message listeners with the given message.
 */
export function simulateChromeMessage(message: unknown): void {
    for (const listener of [...messageListeners]) {
        listener(message, {}, () => { })
    }
}

/**
 * Simulate a chrome.storage.onChanged dispatch.
 * Calls all registered storage change listeners.
 */
export function simulateStorageChange(changes: Record<string, chrome.storage.StorageChange>, areaName: string = 'local'): void {
    for (const listener of [...storageListeners]) {
        listener(changes, areaName)
    }
}

/**
 * Get the internal chrome mock for direct assertion access.
 */
export function getChromeMock() {
    return chromeMock
}

/**
 * Get current message listeners count (for testing listener registration).
 */
export function getMessageListenersCount(): number {
    return messageListeners.length
}

/**
 * Get current storage listeners count (for testing listener registration).
 */
export function getStorageListenersCount(): number {
    return storageListeners.length
}
