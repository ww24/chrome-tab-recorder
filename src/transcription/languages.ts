export interface TranscriptionLanguage {
    code: string
    value: string
    label: string
}

export const TRANSCRIPTION_LANGUAGES: readonly TranscriptionLanguage[] = [
    { code: 'bg', value: 'bulgarian', label: 'български (Bulgarian)' },
    { code: 'zh', value: 'chinese', label: '中文 (Chinese)' },
    { code: 'en', value: 'english', label: 'English' },
    { code: 'fr', value: 'french', label: 'Français (French)' },
    { code: 'de', value: 'german', label: 'Deutsch (German)' },
    { code: 'it', value: 'italian', label: 'Italiano (Italian)' },
    { code: 'ja', value: 'japanese', label: '日本語 (Japanese)' },
    { code: 'pl', value: 'polish', label: 'Polski (Polish)' },
    { code: 'pt', value: 'portuguese', label: 'Português (Portuguese)' },
    { code: 'ru', value: 'russian', label: 'Русский (Russian)' },
    { code: 'es', value: 'spanish', label: 'Español (Spanish)' },
    { code: 'tr', value: 'turkish', label: 'Türkçe (Turkish)' },
    { code: 'vi', value: 'vietnamese', label: 'Tiếng Việt (Vietnamese)' },
] as const

/**
 * Resolves the default transcription language based on the browser's UI language.
 * Falls back to 'english' if the language is not supported or cannot be detected.
 */
export function getDefaultTranscriptionLanguage(locale?: string): string {
    const rawLocale =
        locale ??
        (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage ? chrome.i18n.getUILanguage() : undefined) ??
        (typeof navigator !== 'undefined' ? navigator.language : undefined) ??
        'en'
    const langCode = rawLocale.toLowerCase().split(/[-_]/)[0]

    const matched = TRANSCRIPTION_LANGUAGES.find(lang => lang.code === langCode)
    return matched ? matched.value : 'english'
}
