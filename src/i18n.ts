/**
 * Thin wrapper around chrome.i18n.getMessage() for consistent i18n access.
 */
export function t(key: string, substitutions?: string | string[]): string {
    return chrome.i18n.getMessage(key, substitutions)
}
