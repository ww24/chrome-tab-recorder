import { render } from 'vitest-browser-lit'
import { html } from 'lit'
import { describe, test, expect } from 'vitest'
import { shadowQuery, elementUpdated } from './test-helpers'
import './alert'
import type Alert from './alert'

describe('extension-alert', () => {
    test('renders md-dialog in shadow DOM', async () => {
        const screen = render(html`<extension-alert></extension-alert>`)
        const el = screen.container.querySelector('extension-alert')!
        await elementUpdated(el)

        const dialog = shadowQuery(el, 'md-dialog')
        expect(dialog).not.toBeNull()
    })

    test('renders default headline "Alert"', async () => {
        const screen = render(html`<extension-alert></extension-alert>`)
        const el = screen.container.querySelector('extension-alert')!
        await elementUpdated(el)

        const headline = shadowQuery(el, '[slot="headline"]')
        expect(headline?.textContent).toBe('Alert')
    })

    test('renders OK button', async () => {
        const screen = render(html`<extension-alert></extension-alert>`)
        const el = screen.container.querySelector('extension-alert')!
        await elementUpdated(el)

        const button = shadowQuery(el, 'md-text-button')
        expect(button).not.toBeNull()
        expect(button?.textContent?.trim()).toBe('OK')
        expect(button?.getAttribute('value')).toBe('ok')
    })

    test('setContent updates headline and content', async () => {
        const screen = render(html`<extension-alert></extension-alert>`)
        const el = screen.container.querySelector('extension-alert')! as Alert
        await elementUpdated(el)

        el.setContent('Warning', 'Something went wrong')
        await elementUpdated(el)

        const headline = shadowQuery(el, '[slot="headline"]')
        expect(headline?.textContent).toBe('Warning')

        const form = shadowQuery(el, '#form')!
        const paragraphs = form.querySelectorAll('p')
        expect(paragraphs.length).toBe(1)
        expect(paragraphs[0].textContent).toBe('Something went wrong')
    })

    test('content with newlines renders as multiple paragraphs', async () => {
        const screen = render(html`<extension-alert></extension-alert>`)
        const el = screen.container.querySelector('extension-alert')! as Alert
        await elementUpdated(el)

        el.setContent('Info', 'Line 1\nLine 2\nLine 3')
        await elementUpdated(el)

        const form = shadowQuery(el, '#form')!
        const paragraphs = form.querySelectorAll('p')
        expect(paragraphs.length).toBe(3)
        expect(paragraphs[0].textContent).toBe('Line 1')
        expect(paragraphs[1].textContent).toBe('Line 2')
        expect(paragraphs[2].textContent).toBe('Line 3')
    })
})
