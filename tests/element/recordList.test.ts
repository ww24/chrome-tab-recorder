import { render } from 'vitest-browser-lit'
import { html } from 'lit'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { shadowQuery, elementUpdated } from './test-helpers'
import { getChromeMock, getMessageListenersCount, simulateChromeMessage } from './test-setup'
import '../../src/element/recordList'
import type { RecordingMetadata } from '../../src/storage'

// Mock the api_client module used by RecordList
const listRecordingsMock = vi.fn().mockResolvedValue([])
vi.mock('../../src/api_client', () => ({
    recordingApi: {
        listRecordings: (...args: unknown[]) => listRecordingsMock(...args),
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
    beforeEach(() => {
        listRecordingsMock.mockReset().mockResolvedValue([])
    })

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

    test('storage heading includes record count and file size', async () => {
        const screen = render(html`<record-list></record-list>`)
        const el = screen.container.querySelector('record-list')!
        await elementUpdated(el)

        const heading = shadowQuery(el, '.storage-heading')
        expect(heading?.textContent).toContain('total:')
        expect(heading?.textContent).toContain('0 Records')
        expect(heading?.textContent).toContain('0 B')
    })

    test('storage heading shows singular record count for one recording', async () => {
        const ts = '1000000000000'
        listRecordingsMock.mockResolvedValue([
            {
                title: `video-${ts}.webm`,
                size: 1024,
                lastModified: Date.now(),
                mimeType: 'video/webm',
                recordedAt: Number(ts),
                isTemporary: false,
                subFiles: [],
                subFilesSize: 0,
            },
        ])

        const screen = render(html`<record-list></record-list>`)
        const el = screen.container.querySelector('record-list')!
        await elementUpdated(el)

        await vi.waitFor(() => {
            const heading = shadowQuery(el, '.storage-heading')
            expect(heading?.textContent).toContain('1 Record')
            expect(heading?.textContent).not.toContain('1 Records')
        })
    })

    test('storage heading shows sum of record sizes including subFilesSize', async () => {
        const ts1 = '1000000000000'
        const ts2 = '1000000001000'
        const recordings: RecordingMetadata[] = [
            {
                title: `video-${ts1}.webm`,
                size: 5 * 1024 * 1024, // 5 MB
                lastModified: Date.now(),
                mimeType: 'video/webm',
                recordedAt: Number(ts1),
                isTemporary: false,
                subFiles: [{ path: `video-${ts1}-tab.ogg`, type: 'tab' as const, fileSize: 1 * 1024 * 1024 }],
                subFilesSize: 1 * 1024 * 1024, // 1 MB
            },
            {
                title: `video-${ts2}.webm`,
                size: 3 * 1024 * 1024, // 3 MB
                lastModified: Date.now(),
                mimeType: 'video/webm',
                recordedAt: Number(ts2),
                isTemporary: false,
                subFiles: [],
                subFilesSize: 0,
            },
        ]
        listRecordingsMock.mockResolvedValue(recordings)

        const screen = render(html`<record-list></record-list>`)
        const el = screen.container.querySelector('record-list')!
        await elementUpdated(el)

        // Wait for async updateRecord to complete
        await vi.waitFor(() => {
            const heading = shadowQuery(el, '.storage-heading')
            // 2 recordings total
            expect(heading?.textContent).toContain('2 Records')
            // Total = 5 MB (main) + 1 MB (sub, counted via subFilesSize) + 3 MB (main) = 9.00 MB
            expect(heading?.textContent).toContain('9.00 MB')
        })
    })

    test('connectedCallback sends request-recording-state message', async () => {
        const chromeMock = getChromeMock()
        const screen = render(html`<record-list></record-list>`)
        const el = screen.container.querySelector('record-list')!
        await elementUpdated(el)

        await vi.waitFor(() => {
            expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'request-recording-state' }),
            )
        })
    })

    test('shows paused state with elapsed-blink class on recording-state message', async () => {
        const startAtMs = Date.now() - 5000
        const recordingMeta: RecordingMetadata = {
            title: 'video-' + startAtMs + '.webm',
            size: 1024,
            lastModified: Date.now(),
            mimeType: 'video/webm',
            recordedAt: startAtMs,
            isRecording: true,
            isTemporary: false,
        }
        listRecordingsMock.mockResolvedValue([recordingMeta])

        const screen = render(html`<record-list></record-list>`)
        const el = screen.container.querySelector('record-list')!
        await elementUpdated(el)

        // Simulate a paused recording-state message
        simulateChromeMessage({
            type: 'recording-state',
            data: {
                isRecording: true,
                isPaused: true,
                totalPausedMs: 2000,
                startAtMs,
            },
        })

        await vi.waitFor(() => {
            const recordingDiv = shadowQuery(el, '.recording')
            expect(recordingDiv).not.toBeNull()
            expect(recordingDiv?.textContent).toContain('Paused')
            const blinkSpan = shadowQuery(el, '.elapsed-blink')
            expect(blinkSpan).not.toBeNull()
            expect(blinkSpan?.classList.contains('elapsed-time')).toBe(true)
        })
    })

    test('shows recording state without elapsed-blink class when not paused', async () => {
        const startAtMs = Date.now() - 5000
        const recordingMeta: RecordingMetadata = {
            title: 'video-' + startAtMs + '.webm',
            size: 1024,
            lastModified: Date.now(),
            mimeType: 'video/webm',
            recordedAt: startAtMs,
            isRecording: true,
            isTemporary: false,
        }
        listRecordingsMock.mockResolvedValue([recordingMeta])

        const screen = render(html`<record-list></record-list>`)
        const el = screen.container.querySelector('record-list')!
        await elementUpdated(el)

        // Simulate a non-paused recording-state message
        simulateChromeMessage({
            type: 'recording-state',
            data: {
                isRecording: true,
                isPaused: false,
                totalPausedMs: 0,
                startAtMs,
            },
        })

        await vi.waitFor(() => {
            const recordingDiv = shadowQuery(el, '.recording')
            expect(recordingDiv).not.toBeNull()
            expect(recordingDiv?.textContent).toContain('Recording')
            const elapsedSpan = shadowQuery(el, '.elapsed-time')
            expect(elapsedSpan).not.toBeNull()
            expect(elapsedSpan?.classList.contains('elapsed-blink')).toBe(false)
        })
    })

    test('elapsed time stops updating while paused', async () => {
        vi.useFakeTimers()
        try {
            const startAtMs = Date.now() - 10000
            const recordingMeta: RecordingMetadata = {
                title: 'video-' + startAtMs + '.webm',
                size: 1024,
                lastModified: Date.now(),
                mimeType: 'video/webm',
                recordedAt: startAtMs,
                isRecording: true,
                isTemporary: false,
            }
            listRecordingsMock.mockResolvedValue([recordingMeta])

            const screen = render(html`<record-list></record-list>`)
            const el = screen.container.querySelector('record-list')!
            await elementUpdated(el)

            // Flush pending microtasks from connectedCallback
            await vi.advanceTimersByTimeAsync(0)

            // Simulate a paused recording-state with known totalPausedMs
            const totalPausedMs = 3000
            simulateChromeMessage({
                type: 'recording-state',
                data: {
                    isRecording: true,
                    isPaused: true,
                    totalPausedMs,
                    startAtMs,
                },
            })

            // Flush microtasks so the message handler and re-render complete
            await vi.advanceTimersByTimeAsync(0)
            await elementUpdated(el)

            const elapsedSpan = shadowQuery(el, '.elapsed-time')
            expect(elapsedSpan).not.toBeNull()

            // Capture the frozen elapsed text
            const frozenText = elapsedSpan!.textContent

            // Advance time well past the 1-second update interval
            await vi.advanceTimersByTimeAsync(3000)
            await elementUpdated(el)

            // Verify it hasn't changed (timer is stopped during pause)
            expect(elapsedSpan!.textContent).toBe(frozenText)
        } finally {
            vi.useRealTimers()
        }
    })
})
