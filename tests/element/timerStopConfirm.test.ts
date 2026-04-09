import { render } from 'vitest-browser-lit'
import { html } from 'lit'
import { describe, test, expect } from 'vitest'
import { shadowQuery, elementUpdated } from './test-helpers'
import { getStorageListenersCount } from './test-setup'
import '../../src/element/timerStopConfirm'

describe('extension-timer-stop-confirm', () => {
    test('renders md-dialog with "Stop recording?" headline', async () => {
        const screen = render(html`<extension-timer-stop-confirm></extension-timer-stop-confirm>`)
        const el = screen.container.querySelector('extension-timer-stop-confirm')!
        await elementUpdated(el)

        const headline = shadowQuery(el, '[slot="headline"]')
        expect(headline?.textContent).toBe('Stop recording?')
    })

    test('renders timer icon', async () => {
        const screen = render(html`<extension-timer-stop-confirm></extension-timer-stop-confirm>`)
        const el = screen.container.querySelector('extension-timer-stop-confirm')!
        await elementUpdated(el)

        const icon = shadowQuery(el, 'md-icon[slot="icon"]')
        expect(icon?.textContent?.trim()).toBe('timer')
    })

    test('renders "Don\'t show again" checkbox', async () => {
        const screen = render(html`<extension-timer-stop-confirm></extension-timer-stop-confirm>`)
        const el = screen.container.querySelector('extension-timer-stop-confirm')!
        await elementUpdated(el)

        const checkbox = shadowQuery(el, '#dont-show')
        expect(checkbox).not.toBeNull()

        const label = shadowQuery(el, 'label[for="dont-show"]')
        expect(label?.textContent?.trim()).toBe('Don\'t show this again')
    })

    test('renders Stop Recording and Continue Recording buttons', async () => {
        const screen = render(html`<extension-timer-stop-confirm></extension-timer-stop-confirm>`)
        const el = screen.container.querySelector('extension-timer-stop-confirm')!
        await elementUpdated(el)

        const stopBtn = shadowQuery(el, 'md-text-button[value="stop"]')
        expect(stopBtn).not.toBeNull()
        expect(stopBtn?.textContent?.trim()).toBe('Stop Recording')

        const continueBtn = shadowQuery(el, 'md-filled-tonal-button[value="continue"]')
        expect(continueBtn).not.toBeNull()
        expect(continueBtn?.textContent?.trim()).toBe('Continue Recording')
    })

    test('connectedCallback registers chrome.storage.onChanged listener', async () => {
        const screen = render(html`<extension-timer-stop-confirm></extension-timer-stop-confirm>`)
        const el = screen.container.querySelector('extension-timer-stop-confirm')!
        await elementUpdated(el)

        expect(getStorageListenersCount()).toBeGreaterThan(0)
    })

    test('disconnectedCallback removes chrome.storage.onChanged listener', async () => {
        const screen = render(html`<extension-timer-stop-confirm></extension-timer-stop-confirm>`)
        const el = screen.container.querySelector('extension-timer-stop-confirm')!
        await elementUpdated(el)

        const countBefore = getStorageListenersCount()
        expect(countBefore).toBeGreaterThan(0)

        el.remove()
        expect(getStorageListenersCount()).toBeLessThan(countBefore)
    })

    test('dialog description mentions timer', async () => {
        const screen = render(html`<extension-timer-stop-confirm></extension-timer-stop-confirm>`)
        const el = screen.container.querySelector('extension-timer-stop-confirm')!
        await elementUpdated(el)

        const form = shadowQuery(el, '#form')
        expect(form?.textContent).toContain('recording timer is active')
    })
})
