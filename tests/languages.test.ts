import { describe, it, expect } from 'vitest'
import { TRANSCRIPTION_LANGUAGES, getDefaultTranscriptionLanguage } from '../src/transcription/languages'

describe('TRANSCRIPTION_LANGUAGES', () => {
    it('contains major languages including Japanese and English', () => {
        expect(TRANSCRIPTION_LANGUAGES.length).toBeGreaterThanOrEqual(12)

        const ja = TRANSCRIPTION_LANGUAGES.find(l => l.value === 'japanese')
        expect(ja).toBeDefined()
        expect(ja?.label).toBe('日本語 (Japanese)')

        const en = TRANSCRIPTION_LANGUAGES.find(l => l.value === 'english')
        expect(en).toBeDefined()
        expect(en?.label).toBe('English')

        const zh = TRANSCRIPTION_LANGUAGES.find(l => l.value === 'chinese')
        expect(zh).toBeDefined()
        expect(zh?.label).toBe('中文 (Chinese)')
    })

    it('formats English as "English" and all other languages with native name and English name in parentheses', () => {
        for (const lang of TRANSCRIPTION_LANGUAGES) {
            if (lang.value === 'english') {
                expect(lang.label).toBe('English')
            } else {
                expect(lang.label).toMatch(/^.+ \([A-Za-z ]+\)$/)
            }
        }
    })

    it('has unique values and labels', () => {
        const values = new Set<string>()
        const labels = new Set<string>()

        for (const lang of TRANSCRIPTION_LANGUAGES) {
            expect(values.has(lang.value)).toBe(false)
            expect(labels.has(lang.label)).toBe(false)
            values.add(lang.value)
            labels.add(lang.label)
        }
    })
})

describe('getDefaultTranscriptionLanguage', () => {
    it('resolves supported language from explicit locale', () => {
        expect(getDefaultTranscriptionLanguage('ja')).toBe('japanese')
        expect(getDefaultTranscriptionLanguage('ja-JP')).toBe('japanese')
        expect(getDefaultTranscriptionLanguage('en')).toBe('english')
        expect(getDefaultTranscriptionLanguage('en-US')).toBe('english')
        expect(getDefaultTranscriptionLanguage('zh')).toBe('chinese')
        expect(getDefaultTranscriptionLanguage('zh-CN')).toBe('chinese')
        expect(getDefaultTranscriptionLanguage('fr-FR')).toBe('french')
        expect(getDefaultTranscriptionLanguage('de-DE')).toBe('german')
        expect(getDefaultTranscriptionLanguage('es-ES')).toBe('spanish')
    })

    it('falls back to english for unsupported or unknown locale', () => {
        expect(getDefaultTranscriptionLanguage('xx')).toBe('english')
        expect(getDefaultTranscriptionLanguage('unknown')).toBe('english')
        expect(getDefaultTranscriptionLanguage('')).toBe('english')
    })

    it('resolves from chrome.i18n.getUILanguage when available', () => {
        const originalChrome = globalThis.chrome
        try {
            ;(globalThis as Record<string, unknown>).chrome = {
                i18n: {
                    getUILanguage: () => 'ja-JP',
                },
            }
            expect(getDefaultTranscriptionLanguage()).toBe('japanese')

            ;(globalThis as Record<string, unknown>).chrome = {
                i18n: {
                    getUILanguage: () => 'de',
                },
            }
            expect(getDefaultTranscriptionLanguage()).toBe('german')
        } finally {
            Object.defineProperty(globalThis, 'chrome', {
                value: originalChrome,
                writable: true,
                configurable: true,
            })
        }
    })

    it('falls back to navigator.language when chrome.i18n is not available', () => {
        const originalChrome = globalThis.chrome
        const originalNavigator = globalThis.navigator
        try {
            delete (globalThis as Record<string, unknown>).chrome
            Object.defineProperty(globalThis, 'navigator', {
                value: { language: 'fr-FR' },
                writable: true,
                configurable: true,
            })
            expect(getDefaultTranscriptionLanguage()).toBe('french')
        } finally {
            Object.defineProperty(globalThis, 'chrome', {
                value: originalChrome,
                writable: true,
                configurable: true,
            })
            Object.defineProperty(globalThis, 'navigator', {
                value: originalNavigator,
                writable: true,
                configurable: true,
            })
        }
    })
})
