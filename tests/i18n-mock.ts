import enMessages from '../extension/_locales/en/messages.json'

type MessageEntry = { message: string; placeholders?: Record<string, { content: string }> }
const messages = enMessages as Record<string, MessageEntry>

export function mockGetMessage(key: string, substitutions?: string | string[]): string {
    const entry = messages[key]
    if (!entry) return ''
    let result = entry.message
    if (substitutions != null) {
        const subs = Array.isArray(substitutions) ? substitutions : [substitutions]
        // Replace $N$ placeholders (use callback to avoid special $ handling in replacement strings)
        for (let i = 0; i < subs.length; i++) {
            result = result.replace(new RegExp(`\\$${i + 1}\\$`, 'g'), () => subs[i])
        }
        // Replace named placeholders
        if (entry.placeholders) {
            for (const [name, ph] of Object.entries(entry.placeholders)) {
                const idx = parseInt(ph.content.replace(/\$/g, ''), 10) - 1
                if (idx >= 0 && idx < subs.length) {
                    result = result.replace(new RegExp(`\\$${name}\\$`, 'gi'), () => subs[idx])
                }
            }
        }
    }
    return result
}
