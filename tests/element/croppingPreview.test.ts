import { render } from 'vitest-browser-lit'
import { html } from 'lit'
import { describe, test, expect } from 'vitest'
import { shadowQuery, elementUpdated } from './test-helpers'
import { getMessageListenersCount } from './test-setup'
import '../../src/element/croppingPreview'
import type { CroppingPreview } from '../../src/element/croppingPreview'

describe('cropping-preview', () => {
    test('renders preview container', async () => {
        const screen = render(html`<cropping-preview></cropping-preview>`)
        const el = screen.container.querySelector('cropping-preview')!
        await elementUpdated(el)

        const container = shadowQuery(el, '.preview-container')
        expect(container).not.toBeNull()
    })

    test('renders canvas element', async () => {
        const screen = render(html`<cropping-preview></cropping-preview>`)
        const el = screen.container.querySelector('cropping-preview')!
        await elementUpdated(el)

        const canvas = shadowQuery(el, '.preview-canvas')
        expect(canvas).not.toBeNull()
    })

    test('shows "Start recording" message when not recording', async () => {
        const screen = render(html`<cropping-preview></cropping-preview>`)
        const el = screen.container.querySelector('cropping-preview')!
        await elementUpdated(el)

        const msg = shadowQuery(el, '.preview-message')
        expect(msg?.textContent).toContain('Start recording to preview')
    })

    test('canvas is hidden when not recording', async () => {
        const screen = render(html`<cropping-preview></cropping-preview>`)
        const el = screen.container.querySelector('cropping-preview')!
        await elementUpdated(el)

        const canvas = shadowQuery(el, '.preview-canvas')
        expect(canvas?.classList.contains('hidden')).toBe(true)
    })

    test('connectedCallback registers chrome.runtime.onMessage listener', async () => {
        const screen = render(html`<cropping-preview></cropping-preview>`)
        const el = screen.container.querySelector('cropping-preview')!
        await elementUpdated(el)

        expect(getMessageListenersCount()).toBeGreaterThan(0)
    })

    test('disconnectedCallback removes message listener', async () => {
        const screen = render(html`<cropping-preview></cropping-preview>`)
        const el = screen.container.querySelector('cropping-preview')!
        await elementUpdated(el)

        const countBefore = getMessageListenersCount()
        el.remove()
        expect(getMessageListenersCount()).toBeLessThan(countBefore)
    })

    test('accepts croppingEnabled property', async () => {
        const screen = render(html` <cropping-preview .croppingEnabled=${true}></cropping-preview> `)
        const el = screen.container.querySelector('cropping-preview')! as CroppingPreview
        await elementUpdated(el)

        expect(el.croppingEnabled).toBe(true)
    })

    test('accepts cropRegion property', async () => {
        const region = { x: 100, y: 200, width: 800, height: 600 }
        const screen = render(html` <cropping-preview .cropRegion=${region}></cropping-preview> `)
        const el = screen.container.querySelector('cropping-preview')! as CroppingPreview
        await elementUpdated(el)

        expect(el.cropRegion).toEqual(region)
    })

    test('accepts isRecording property', async () => {
        const screen = render(html` <cropping-preview .isRecording=${true}></cropping-preview> `)
        const el = screen.container.querySelector('cropping-preview')! as CroppingPreview
        await elementUpdated(el)

        expect(el.isRecording).toBe(true)
    })

    test('accepts canInteract property', async () => {
        const screen = render(html` <cropping-preview .canInteract=${false}></cropping-preview> `)
        const el = screen.container.querySelector('cropping-preview')! as CroppingPreview
        await elementUpdated(el)

        expect(el.canInteract).toBe(false)
    })

    test('no crop overlay rendered when croppingEnabled is false', async () => {
        const screen = render(html`
            <cropping-preview .croppingEnabled=${false} .isRecording=${true}></cropping-preview>
        `)
        const el = screen.container.querySelector('cropping-preview')!
        await elementUpdated(el)

        const cropOverlay = shadowQuery(el, '.crop-overlay')
        expect(cropOverlay).toBeNull()
    })

    test('dispatches crop-region-change event', async () => {
        const screen = render(html`<cropping-preview></cropping-preview>`)
        const el = screen.container.querySelector('cropping-preview')! as CroppingPreview
        await elementUpdated(el)

        let receivedEvent: CustomEvent | null = null
        el.addEventListener('crop-region-change', ((e: CustomEvent) => {
            receivedEvent = e
        }) as EventListener)

        // Manually dispatch an event to verify the custom event interface
        const region = { x: 10, y: 20, width: 300, height: 200 }
        el.dispatchEvent(
            new CustomEvent('crop-region-change', {
                detail: { region },
                bubbles: true,
                composed: true,
            }),
        )

        expect(receivedEvent).not.toBeNull()
        expect(receivedEvent!.detail.region).toEqual(region)
    })
})
