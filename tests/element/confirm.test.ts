import { render } from 'vitest-browser-lit'
import { html } from 'lit'
import { describe, test, expect } from 'vitest'
import { shadowQuery, shadowQueryAll, elementUpdated } from './test-helpers'
import '../../src/element/confirm'
import type Confirm from '../../src/element/confirm'
import type { RecordEntry } from '../../src/element/recordList'

function makeRecord(overrides: Partial<RecordEntry> = {}): RecordEntry {
    return {
        title: 'video-123456.webm',
        size: 1024 * 1024, // 1 MB
        selected: false,
        isRecording: false,
        subFiles: [],
        subFilesSize: 0,
        ...overrides,
    }
}

describe('extension-confirm', () => {
    test('renders md-dialog with "Permanently delete?" headline', async () => {
        const screen = render(html`<extension-confirm></extension-confirm>`)
        const el = screen.container.querySelector('extension-confirm')!
        await elementUpdated(el)

        const headline = shadowQuery(el, '[slot="headline"]')
        expect(headline?.textContent).toBe('Permanently delete?')
    })

    test('renders delete icon', async () => {
        const screen = render(html`<extension-confirm></extension-confirm>`)
        const el = screen.container.querySelector('extension-confirm')!
        await elementUpdated(el)

        const icon = shadowQuery(el, 'md-icon[slot="icon"]')
        expect(icon?.textContent?.trim()).toBe('delete_outline')
    })

    test('renders Delete and Cancel buttons', async () => {
        const screen = render(html`<extension-confirm></extension-confirm>`)
        const el = screen.container.querySelector('extension-confirm')!
        await elementUpdated(el)

        const deleteBtn = shadowQuery(el, 'md-text-button[value="delete"]')
        expect(deleteBtn).not.toBeNull()
        expect(deleteBtn?.textContent?.trim()).toBe('Delete')

        const cancelBtn = shadowQuery(el, 'md-filled-tonal-button[value="cancel"]')
        expect(cancelBtn).not.toBeNull()
        expect(cancelBtn?.textContent?.trim()).toBe('Cancel')
    })

    test('renders empty list when no records', async () => {
        const screen = render(html`<extension-confirm></extension-confirm>`)
        const el = screen.container.querySelector('extension-confirm')!
        await elementUpdated(el)

        const listItems = shadowQueryAll(el, 'md-list-item')
        expect(listItems.length).toBe(0)
    })

    test('setRecords renders record entries with formatted file size', async () => {
        const screen = render(html`<extension-confirm></extension-confirm>`)
        const el = screen.container.querySelector('extension-confirm')! as Confirm
        await elementUpdated(el)

        const records = [
            makeRecord({ title: 'video-001.webm', size: 2 * 1024 * 1024, subFilesSize: 512 * 1024 }), // (2 + 0.5) MB = 2.50 MB
        ]
        el.setRecords(records)
        await elementUpdated(el)

        const listItems = shadowQueryAll(el, 'md-list-item')
        expect(listItems.length).toBe(1)
        expect(listItems[0].textContent).toContain('video-001.webm')
        expect(listItems[0].textContent).toContain('2.50 MB')
    })

    test('multiple records render with dividers between them', async () => {
        const screen = render(html`<extension-confirm></extension-confirm>`)
        const el = screen.container.querySelector('extension-confirm')! as Confirm
        await elementUpdated(el)

        const records = [
            makeRecord({ title: 'video-001.webm', size: 1024 * 1024, subFilesSize: 0 }),
            makeRecord({ title: 'video-002.webm', size: 2048 * 1024, subFilesSize: 0 }),
            makeRecord({ title: 'video-003.webm', size: 512 * 1024, subFilesSize: 0 }),
        ]
        el.setRecords(records)
        await elementUpdated(el)

        const listItems = shadowQueryAll(el, 'md-list-item')
        expect(listItems.length).toBe(3)

        const dividers = shadowQueryAll(el, 'md-divider')
        expect(dividers.length).toBe(2) // n-1 dividers
    })

    test('file size includes subFilesSize in calculation', async () => {
        const screen = render(html`<extension-confirm></extension-confirm>`)
        const el = screen.container.querySelector('extension-confirm')! as Confirm
        await elementUpdated(el)

        // size=1MB, subFilesSize=1MB → total 2MB → "2.00 MB"
        const records = [makeRecord({ title: 'test.webm', size: 1024 * 1024, subFilesSize: 1024 * 1024 })]
        el.setRecords(records)
        await elementUpdated(el)

        const listItem = shadowQuery(el, 'md-list-item')
        expect(listItem?.textContent).toContain('2.00 MB')
    })
})
