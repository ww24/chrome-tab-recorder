import { render } from 'vitest-browser-lit'
import { html } from 'lit'
import { describe, test, expect, vi } from 'vitest'
import { shadowQuery, shadowQueryAll, elementUpdated } from './test-helpers'

// Mock sentry to avoid process.env references in browser
vi.mock('../sentry', () => ({
    sendException: vi.fn(),
    sendFeedback: vi.fn(() => true),
    sendEvent: vi.fn(),
    FeedbackType: {},
}))

import './support'

describe('extension-support', () => {
    test('renders review section with Chrome Web Store link', async () => {
        const screen = render(html`<extension-support></extension-support>`)
        const el = screen.container.querySelector('extension-support')!
        await elementUpdated(el)

        const headings = shadowQueryAll(el, 'h2')
        const reviewHeading = headings.find(h => h.textContent?.trim() === 'Review')
        expect(reviewHeading).not.toBeUndefined()

        const reviewBtn = shadowQuery(el, '.review-section md-filled-tonal-button')
        expect(reviewBtn?.textContent?.trim()).toContain('Write a Review')
        expect(reviewBtn?.getAttribute('href')).toContain('chromewebstore.google.com')
    })

    test('renders support section with Buy Me a Coffee link', async () => {
        const screen = render(html`<extension-support></extension-support>`)
        const el = screen.container.querySelector('extension-support')!
        await elementUpdated(el)

        const link = shadowQuery<HTMLAnchorElement>(el, '.buymeacoffee-link')
        expect(link).not.toBeNull()
        expect(link?.getAttribute('href')).toContain('buymeacoffee.com')
    })

    test('renders feedback section with heading', async () => {
        const screen = render(html`<extension-support></extension-support>`)
        const el = screen.container.querySelector('extension-support')!
        await elementUpdated(el)

        const headings = shadowQueryAll(el, 'h2')
        const feedbackHeading = headings.find(h => h.textContent?.trim() === 'Feedback')
        expect(feedbackHeading).not.toBeUndefined()
    })

    test('renders feedback form with type selector', async () => {
        const screen = render(html`<extension-support></extension-support>`)
        const el = screen.container.querySelector('extension-support')!
        await elementUpdated(el)

        const select = shadowQuery(el, '.feedback-form md-filled-select')
        expect(select).not.toBeNull()
    })

    test('renders feedback form with message textarea', async () => {
        const screen = render(html`<extension-support></extension-support>`)
        const el = screen.container.querySelector('extension-support')!
        await elementUpdated(el)

        const textField = shadowQuery(el, '.feedback-form md-filled-text-field')
        expect(textField).not.toBeNull()
        expect(textField?.getAttribute('type')).toBe('textarea')
    })

    test('renders character count display', async () => {
        const screen = render(html`<extension-support></extension-support>`)
        const el = screen.container.querySelector('extension-support')!
        await elementUpdated(el)

        const charCount = shadowQuery(el, '.char-count')
        expect(charCount).not.toBeNull()
        // Default: 0 characters
        expect(charCount?.textContent).toContain('0')
        expect(charCount?.textContent).toContain('1000')
    })

    test('renders bug tracking switch', async () => {
        const screen = render(html`<extension-support></extension-support>`)
        const el = screen.container.querySelector('extension-support')!
        await elementUpdated(el)

        const bugTrackingLabel = shadowQueryAll(el, 'label').find(l => l.textContent?.includes('Bug Tracking'))
        expect(bugTrackingLabel).not.toBeUndefined()

        const switchEl = shadowQuery(el, 'md-switch')
        expect(switchEl).not.toBeNull()
    })

    test('renders send feedback button', async () => {
        const screen = render(html`<extension-support></extension-support>`)
        const el = screen.container.querySelector('extension-support')!
        await elementUpdated(el)

        const sendBtn = shadowQuery(el, '.feedback-form md-filled-tonal-button')
        expect(sendBtn).not.toBeNull()
        expect(sendBtn?.textContent?.trim()).toContain('Send Feedback')
    })

    test('renders Support Development section', async () => {
        const screen = render(html`<extension-support></extension-support>`)
        const el = screen.container.querySelector('extension-support')!
        await elementUpdated(el)

        const headings = shadowQueryAll(el, 'h2')
        const supportHeading = headings.find(h => h.textContent?.trim() === 'Support Development')
        expect(supportHeading).not.toBeUndefined()
    })
})
