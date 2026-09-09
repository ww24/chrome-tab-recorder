import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TranscriptionSession, type TranscriptionSessionDeps } from '../src/transcription/session'

;(Symbol as any).dispose ??= Symbol.for('Symbol.dispose')

vi.mock('mediabunny', () => ({
    ALL_FORMATS: [],
    BlobSource: class MockBlobSource {},
    Input: class MockInput {
        canRead = vi.fn().mockResolvedValue(true);
        [Symbol.dispose] = vi.fn()
    },
    Output: class MockOutput {},
    BufferTarget: class MockBufferTarget {
        buffer = new ArrayBuffer(48)
    },
    WavOutputFormat: class MockWavOutputFormat {},
    Conversion: {
        init: vi.fn().mockResolvedValue({
            isValid: true,
            execute: vi.fn().mockResolvedValue(undefined),
            discardedTracks: [],
        }),
    },
}))

vi.mock('../src/transcription/utils', () => ({
    wavToFloat32Array: vi.fn().mockReturnValue(new Float32Array(16000)), // 1 second of audio
}))

describe('TranscriptionSession', () => {
    let mockWorker: {
        postMessage: ReturnType<typeof vi.fn>
        addEventListener: ReturnType<typeof vi.fn>
        removeEventListener: ReturnType<typeof vi.fn>
        terminate: ReturnType<typeof vi.fn>
    }
    let deps: TranscriptionSessionDeps
    let messageListeners: Record<string, ((e: any) => void)[]>

    beforeEach(() => {
        messageListeners = {}
        mockWorker = {
            postMessage: vi.fn((msg: any) => {
                if (msg.type === 'init') {
                    // Simulate ready
                    setTimeout(() => {
                        messageListeners['message']?.forEach(fn => fn({ data: { type: 'ready' } }))
                    }, 0)
                } else if (msg.type === 'transcribe') {
                    // Simulate result
                    setTimeout(() => {
                        messageListeners['message']?.forEach(fn =>
                            fn({
                                data: {
                                    type: 'result',
                                    segments: [{ startSec: 0, endSec: 1, text: 'テスト字幕' }],
                                    timings: { loudnessNormMs: 10, vadMs: 20, inferenceMs: 100 },
                                },
                            }),
                        )
                    }, 0)
                }
            }),
            addEventListener: vi.fn((event: string, fn: any) => {
                if (!messageListeners[event]) messageListeners[event] = []
                messageListeners[event].push(fn)
            }),
            removeEventListener: vi.fn((event: string, fn: any) => {
                if (messageListeners[event]) {
                    messageListeners[event] = messageListeners[event].filter(f => f !== fn)
                }
            }),
            terminate: vi.fn(),
        }

        deps = {
            getVideoFile: vi.fn().mockResolvedValue(new Blob(['fake video'], { type: 'video/webm' })),
            saveTranscription: vi.fn().mockResolvedValue(undefined),
            sendEvent: vi.fn(),
            broadcastMessage: vi.fn().mockResolvedValue(undefined),
            createWorker: vi.fn().mockReturnValue(mockWorker as unknown as Worker),
            getLanguage: vi.fn().mockResolvedValue('japanese'),
        }
    })

    it('successfully transcribes audio and terminates worker', async () => {
        const session = new TranscriptionSession(deps)
        expect(session.isTranscribing('rec.webm')).toBe(false)

        const promise = session.transcribe('rec.webm')
        expect(session.isTranscribing('rec.webm')).toBe(true)

        await promise
        expect(session.isTranscribing('rec.webm')).toBe(false)

        expect(deps.getVideoFile).toHaveBeenCalledWith('rec.webm')
        expect(deps.saveTranscription).toHaveBeenCalledWith(
            'rec.webm',
            expect.objectContaining({
                segments: [{ startSec: 0, endSec: 1, text: 'テスト字幕' }],
                language: 'japanese',
            }),
        )
        expect(deps.sendEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'transcription_complete',
            }),
        )
        expect(deps.broadcastMessage).toHaveBeenCalledWith({
            type: 'transcription-complete',
            path: 'rec.webm',
        })
        expect(mockWorker.terminate).toHaveBeenCalled()
    })

    it('terminates worker and broadcasts error on failure', async () => {
        deps.getVideoFile = vi.fn().mockRejectedValue(new Error('File not found'))
        const session = new TranscriptionSession(deps)

        await expect(session.transcribe('missing.webm')).rejects.toThrow('File not found')
        expect(session.isTranscribing('missing.webm')).toBe(false)
        expect(deps.broadcastMessage).toHaveBeenCalledWith({
            type: 'transcription-error',
            path: 'missing.webm',
            error: 'File not found',
        })
    })
})
