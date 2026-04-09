import { render } from 'vitest-browser-lit'
import { html } from 'lit'
import { describe, test, expect, vi } from 'vitest'
import { shadowQuery, elementUpdated } from './test-helpers'
import { getMessageListenersCount } from './test-setup'
import '../../src/element/recordList'

// Mock the api_client module used by RecordList
vi.mock('../../src/api_client', () => ({
    recordingApi: {
        listRecordings: vi.fn().mockResolvedValue([]),
        getRecordingFile: vi.fn().mockResolvedValue(null),
        deleteRecording: vi.fn().mockResolvedValue(undefined),
        getStorageEstimate: vi.fn().mockResolvedValue({ usage: 0, quota: 1073741824 }),
    },
}))

// Mock sentry to avoid initialization errors
vi.mock('../../src/sentry', () => ({
    sendException: vi.fn(),
    sendFeedback: vi.fn(),
    sendEvent: vi.fn(),
}))

describe('record-list', () => {
    test('renders storage heading', async () => {
        const screen = render(html`<record-list></record-list>`)
        const el = screen.container.querySelector('record-list')!
        await elementUpdated(el)

        const heading = shadowQuery(el, '.storage-heading')
        expect(heading).not.toBeNull()
        expect(heading?.textContent).toContain('Storage')
    })

    test('renders "no entry" when no records', async () => {
        const screen = render(html`<record-list></record-list>`)
        const el = screen.container.querySelector('record-list')!
        await elementUpdated(el)

        // Wait for async connectedCallback to finish
        await vi.waitFor(() => {
            const listItem = shadowQuery(el, 'md-list md-list-item')
            expect(listItem?.textContent?.trim()).toBe('no entry')
        })
    })

    test('renders Select all chip', async () => {
        const screen = render(html`<record-list></record-list>`)
        const el = screen.container.querySelector('record-list')!
        await elementUpdated(el)

        const selectAllChip = shadowQuery(el, 'md-filter-chip[label="Select all"]')
        expect(selectAllChip).not.toBeNull()
    })

    test('renders sort order chip', async () => {
        const screen = render(html`<record-list></record-list>`)
        const el = screen.container.querySelector('record-list')!
        await elementUpdated(el)

        const sortChip = shadowQuery(el, '.sort-chip')
        expect(sortChip).not.toBeNull()
        // Default sort is 'asc' → label "ASC"
        expect(sortChip?.getAttribute('label')).toBe('ASC')
    })

    test('renders Save and Delete action chips', async () => {
        const screen = render(html`<record-list></record-list>`)
        const el = screen.container.querySelector('record-list')!
        await elementUpdated(el)

        const saveChip = shadowQuery(el, 'md-assist-chip[label="Save"]')
        const deleteChip = shadowQuery(el, 'md-assist-chip[label="Delete"]')
        expect(saveChip).not.toBeNull()
        expect(deleteChip).not.toBeNull()
    })

    test('Save and Delete chips are disabled when no records selected', async () => {
        const screen = render(html`<record-list></record-list>`)
        const el = screen.container.querySelector('record-list')!
        await elementUpdated(el)

        const saveChip = shadowQuery(el, 'md-assist-chip[label="Save"]')
        const deleteChip = shadowQuery(el, 'md-assist-chip[label="Delete"]')
        expect(saveChip?.hasAttribute('disabled')).toBe(true)
        expect(deleteChip?.hasAttribute('disabled')).toBe(true)
    })

    test('renders md-list element', async () => {
        const screen = render(html`<record-list></record-list>`)
        const el = screen.container.querySelector('record-list')!
        await elementUpdated(el)

        const list = shadowQuery(el, 'md-list')
        expect(list).not.toBeNull()
    })

    test('connectedCallback registers chrome.runtime.onMessage listener', async () => {
        const screen = render(html`<record-list></record-list>`)
        const el = screen.container.querySelector('record-list')!
        await elementUpdated(el)

        expect(getMessageListenersCount()).toBeGreaterThan(0)
    })

    test('disconnectedCallback removes message listener', async () => {
        const screen = render(html`<record-list></record-list>`)
        const el = screen.container.querySelector('record-list')!
        await elementUpdated(el)

        const countBefore = getMessageListenersCount()
        el.remove()
        expect(getMessageListenersCount()).toBeLessThan(countBefore)
    })

    test('renders chip-set for actions', async () => {
        const screen = render(html`<record-list></record-list>`)
        const el = screen.container.querySelector('record-list')!
        await elementUpdated(el)

        const chipSet = shadowQuery(el, 'md-chip-set')
        expect(chipSet).not.toBeNull()
    })

    test('storage heading includes total and percentage', async () => {
        const screen = render(html`<record-list></record-list>`)
        const el = screen.container.querySelector('record-list')!
        await elementUpdated(el)

        const heading = shadowQuery(el, '.storage-heading')
        expect(heading?.textContent).toContain('total:')
        expect(heading?.textContent).toContain('MB')
    })
})
