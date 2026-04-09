import { render } from 'vitest-browser-lit'
import { html } from 'lit'
import { describe, test, expect } from 'vitest'
import { shadowQuery, shadowQueryAll, elementUpdated } from './test-helpers'
import './tab'
import type { OptionTab } from './tab'

function renderTab() {
    const screen = render(html`<option-tab></option-tab>`)
    return screen.container.querySelector('option-tab') as OptionTab
}

describe('option-tab', () => {
    test('renders 4 primary tabs', async () => {
        const el = renderTab()
        await elementUpdated(el)

        const tabs = shadowQueryAll(el, 'md-primary-tab')
        expect(tabs.length).toBe(4)
    })

    test('tab labels contain Records, Settings, Cropping, Support', async () => {
        const el = renderTab()
        await elementUpdated(el)

        const tabs = shadowQueryAll(el, 'md-primary-tab')
        const texts = tabs.map(t => t.textContent ?? '')
        expect(texts.some(t => t.includes('Records'))).toBe(true)
        expect(texts.some(t => t.includes('Settings'))).toBe(true)
        expect(texts.some(t => t.includes('Cropping'))).toBe(true)
        expect(texts.some(t => t.includes('Support'))).toBe(true)
    })

    test('first tab (Records) is active by default', async () => {
        const el = renderTab()
        await elementUpdated(el)

        const firstTab = shadowQuery(el, '#tab-main')
        expect(firstTab?.hasAttribute('active')).toBe(true)
    })

    test('renders 4 tab panels with correct IDs and aria attributes', async () => {
        const el = renderTab()
        await elementUpdated(el)

        const panels = shadowQueryAll(el, '[role="tabpanel"]')
        expect(panels.length).toBe(4)

        const panelIds = panels.map(p => p.id)
        expect(panelIds).toContain('panel-main')
        expect(panelIds).toContain('panel-settings')
        expect(panelIds).toContain('panel-cropping')
        expect(panelIds).toContain('panel-support')
    })

    test('non-active panels are hidden', async () => {
        const el = renderTab()
        await elementUpdated(el)

        const mainPanel = shadowQuery(el, '#panel-main')
        const settingsPanel = shadowQuery(el, '#panel-settings')
        const croppingPanel = shadowQuery(el, '#panel-cropping')
        const supportPanel = shadowQuery(el, '#panel-support')

        expect(mainPanel?.hasAttribute('hidden')).toBe(false)
        expect(settingsPanel?.hasAttribute('hidden')).toBe(true)
        expect(croppingPanel?.hasAttribute('hidden')).toBe(true)
        expect(supportPanel?.hasAttribute('hidden')).toBe(true)
    })

    test('each panel has a slot for content projection', async () => {
        const el = renderTab()
        await elementUpdated(el)

        const slots = shadowQueryAll<HTMLSlotElement>(el, 'slot')
        const slotNames = slots.map(s => s.name)
        expect(slotNames).toContain('panel-main')
        expect(slotNames).toContain('panel-settings')
        expect(slotNames).toContain('panel-cropping')
        expect(slotNames).toContain('panel-support')
    })
})
