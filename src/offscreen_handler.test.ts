import type { Mock } from 'vitest'

vi.mock('mediabunny', () => ({
    canEncodeAudio: vi.fn().mockResolvedValue(true),
}))
vi.mock('@mediabunny/flac-encoder', () => ({
    registerFlacEncoder: vi.fn(),
}))

import { OffscreenHandler } from './offscreen_handler'
import type { OffscreenDeps, OffscreenSession } from './offscreen_handler'
import type { Message, StartRecordingResponse } from './message'
import { Configuration, VideoFormat } from './configuration'

// ---------- helpers ----------

function createMockSession(overrides: Partial<OffscreenSession> = {}): OffscreenSession {
    return {
        start: vi.fn().mockResolvedValue({
            startAtMs: 1000,
            recordingMode: 'video-and-audio',
            micEnabled: false,
        }),
        stop: vi.fn().mockResolvedValue({
            startAtMs: 1000,
            durationMs: 5000,
            fileSize: 12345,
        }),
        cancel: vi.fn().mockResolvedValue(3000),
        startPreview: vi.fn(),
        stopPreview: vi.fn(),
        updateCropRegion: vi.fn(),
        ...overrides,
    }
}

function createMockDeps(overrides: Partial<OffscreenDeps> = {}): OffscreenDeps {
    const defaultConfig = new Configuration()
    return {
        getRecordingInfo: vi.fn().mockReturnValue({
            videoFormat: defaultConfig.videoFormat,
            recordingSize: { width: 1920, height: 1080 },
        }),
        getConfiguration: vi.fn().mockReturnValue(defaultConfig),
        mergeRemoteConfiguration: vi.fn(),
        session: createMockSession(),
        checkStoragePersisted: vi.fn().mockResolvedValue(true),
        sendEvent: vi.fn(),
        sendException: vi.fn(),
        flush: vi.fn().mockResolvedValue(undefined),
        sendRuntimeMessage: vi.fn().mockResolvedValue(undefined),
        getLocationHash: vi.fn().mockReturnValue(''),
        setLocationHash: vi.fn(),
        ...overrides,
    }
}

// ---------- start-recording ----------

describe('start-recording', () => {
    it('calls getRecordingInfo with tabSize from message', async () => {
        const deps = createMockDeps()
        const handler = new OffscreenHandler(deps)
        await handler.handleMessage({
            type: 'start-recording',
            data: { tabSize: { width: 1280, height: 720 }, streamId: 'stream-1' },
            trigger: 'action-icon',
        })
        expect(deps.getRecordingInfo).toHaveBeenCalledWith({ width: 1280, height: 720 })
    })

    it('calls getConfiguration', async () => {
        const deps = createMockDeps()
        const handler = new OffscreenHandler(deps)
        await handler.handleMessage({
            type: 'start-recording',
            data: { tabSize: { width: 1920, height: 1080 }, streamId: 'stream-1' },
            trigger: 'action-icon',
        })
        expect(deps.getConfiguration).toHaveBeenCalled()
    })

    it('checks OPFS persistence', async () => {
        const deps = createMockDeps()
        const handler = new OffscreenHandler(deps)
        await handler.handleMessage({
            type: 'start-recording',
            data: { tabSize: { width: 1920, height: 1080 }, streamId: 'stream-1' },
            trigger: 'action-icon',
        })
        expect(deps.checkStoragePersisted).toHaveBeenCalled()
    })

    it('sends start_recording event with trigger and opfsPersisted tags', async () => {
        const deps = createMockDeps({
            checkStoragePersisted: vi.fn().mockResolvedValue(false),
        })
        const handler = new OffscreenHandler(deps)
        await handler.handleMessage({
            type: 'start-recording',
            data: { tabSize: { width: 1920, height: 1080 }, streamId: 'stream-1' },
            trigger: 'keyboard-shortcut',
        })
        expect(deps.sendEvent).toHaveBeenCalledWith({
            type: 'start_recording',
            tags: {
                trigger: 'keyboard-shortcut',
                state: { opfsPersisted: false },
            },
        })
    })

    it('calls session.start with correct config assembled from deps', async () => {
        const config = new Configuration()
        config.microphone = { enabled: true, gain: 0.8, deviceId: 'mic-1' }
        config.cropping = { enabled: true, region: { x: 10, y: 20, width: 640, height: 480 } }
        config.muteRecordingTab = true
        config.audioSeparation = { enabled: true }
        const videoFormat = new VideoFormat(
            'video-and-audio', 'webm', 'opus', 'high', 256000, 44100, 'vp9', 'high', 8000000, 30,
        )
        const deps = createMockDeps({
            getRecordingInfo: vi.fn().mockReturnValue({
                videoFormat,
                recordingSize: { width: 1280, height: 720 },
            }),
            getConfiguration: vi.fn().mockReturnValue(config),
        })
        const handler = new OffscreenHandler(deps)
        const data = { tabSize: { width: 1920, height: 1080 }, streamId: 'stream-1' }
        await handler.handleMessage({
            type: 'start-recording',
            data,
            trigger: 'action-icon',
        })
        expect(deps.session.start).toHaveBeenCalledWith(data, {
            videoFormat,
            recordingSize: { width: 1280, height: 720 },
            microphone: config.microphone,
            cropping: config.cropping,
            muteRecordingTab: true,
            audioSeparation: { enabled: true },
        })
    })

    it('sets location hash to recording', async () => {
        const deps = createMockDeps()
        const handler = new OffscreenHandler(deps)
        await handler.handleMessage({
            type: 'start-recording',
            data: { tabSize: { width: 1920, height: 1080 }, streamId: 'stream-1' },
            trigger: 'action-icon',
        })
        expect(deps.setLocationHash).toHaveBeenCalledWith('recording')
    })

    it('returns StartRecordingResponse from session', async () => {
        const sessionResponse: StartRecordingResponse = {
            startAtMs: 2000,
            recordingMode: 'audio-only',
            micEnabled: true,
        }
        const deps = createMockDeps({
            session: createMockSession({
                start: vi.fn().mockResolvedValue(sessionResponse),
            }),
        })
        const handler = new OffscreenHandler(deps)
        const result = await handler.handleMessage({
            type: 'start-recording',
            data: { tabSize: { width: 1920, height: 1080 }, streamId: 'stream-1' },
            trigger: 'context-menu',
        })
        expect(result!.response).toEqual(sessionResponse)
    })

    it('sets timer and adds stopAtMs when timer enabled', async () => {
        vi.useFakeTimers()
        try {
            const config = new Configuration()
            config.recordingTimer = { enabled: true, durationMinutes: 5, skipStopConfirmation: false }
            const deps = createMockDeps({
                getConfiguration: vi.fn().mockReturnValue(config),
            })
            const handler = new OffscreenHandler(deps)
            const result = await handler.handleMessage({
                type: 'start-recording',
                data: { tabSize: { width: 1920, height: 1080 }, streamId: 'stream-1' },
                trigger: 'action-icon',
            })
            expect(result!.response?.stopAtMs).toBeDefined()
            expect(typeof result!.response?.stopAtMs).toBe('number')
        } finally {
            vi.useRealTimers()
        }
    })

    it('does not set stopAtMs when timer disabled', async () => {
        const config = new Configuration()
        config.recordingTimer = { enabled: false, durationMinutes: 5, skipStopConfirmation: false }
        const deps = createMockDeps({
            getConfiguration: vi.fn().mockReturnValue(config),
        })
        const handler = new OffscreenHandler(deps)
        const result = await handler.handleMessage({
            type: 'start-recording',
            data: { tabSize: { width: 1920, height: 1080 }, streamId: 'stream-1' },
            trigger: 'action-icon',
        })
        expect(result!.response?.stopAtMs).toBeUndefined()
    })

    it('does not set stopAtMs when durationMinutes is 0', async () => {
        const config = new Configuration()
        config.recordingTimer = { enabled: true, durationMinutes: 0, skipStopConfirmation: false }
        const deps = createMockDeps({
            getConfiguration: vi.fn().mockReturnValue(config),
        })
        const handler = new OffscreenHandler(deps)
        const result = await handler.handleMessage({
            type: 'start-recording',
            data: { tabSize: { width: 1920, height: 1080 }, streamId: 'stream-1' },
            trigger: 'action-icon',
        })
        expect(result!.response?.stopAtMs).toBeUndefined()
    })

    it('preserves all three trigger types', async () => {
        const triggers = ['action-icon', 'context-menu', 'keyboard-shortcut'] as const
        for (const trigger of triggers) {
            const deps = createMockDeps()
            const handler = new OffscreenHandler(deps)
            await handler.handleMessage({
                type: 'start-recording',
                data: { tabSize: { width: 1920, height: 1080 }, streamId: 'stream-1' },
                trigger,
            })
            expect(deps.sendEvent).toHaveBeenCalledWith(
                expect.objectContaining({ tags: expect.objectContaining({ trigger }) }),
            )
        }
    })
})

// ---------- stop-recording ----------

describe('stop-recording', () => {
    it('calls session.stop and sends stop_recording event with metrics', async () => {
        const deps = createMockDeps()
        const handler = new OffscreenHandler(deps)
        await handler.handleMessage({ type: 'stop-recording', trigger: 'action-icon' })
        expect(deps.session.stop).toHaveBeenCalled()
        expect(deps.sendEvent).toHaveBeenCalledWith({
            type: 'stop_recording',
            metrics: {
                trigger: 'action-icon',
                recording: {
                    durationSec: 5,
                    filesize: 12345,
                },
            },
        })
    })

    it('clears timer and location hash', async () => {
        const deps = createMockDeps()
        const handler = new OffscreenHandler(deps)
        await handler.handleMessage({ type: 'stop-recording', trigger: 'action-icon' })
        expect(deps.setLocationHash).toHaveBeenCalledWith('')
    })

    it('calls flush', async () => {
        const deps = createMockDeps()
        const handler = new OffscreenHandler(deps)
        await handler.handleMessage({ type: 'stop-recording', trigger: 'action-icon' })
        expect(deps.flush).toHaveBeenCalled()
    })

    it('does not send event when session.stop returns null', async () => {
        const deps = createMockDeps({
            session: createMockSession({
                stop: vi.fn().mockResolvedValue(null),
            }),
        })
        const handler = new OffscreenHandler(deps)
        await handler.handleMessage({ type: 'stop-recording', trigger: 'action-icon' })
        expect(deps.sendEvent).not.toHaveBeenCalled()
        expect(deps.setLocationHash).toHaveBeenCalledWith('')
        expect(deps.flush).toHaveBeenCalled()
    })

    it('sends exception and still clears timer/hash when session.stop throws', async () => {
        const error = new Error('stop failed')
        const deps = createMockDeps({
            session: createMockSession({
                stop: vi.fn().mockRejectedValue(error),
            }),
        })
        const handler = new OffscreenHandler(deps)
        await handler.handleMessage({ type: 'stop-recording', trigger: 'action-icon' })
        expect(deps.sendException).toHaveBeenCalledWith(error, { exceptionSource: 'offscreen.stopRecording' })
        expect(deps.setLocationHash).toHaveBeenCalledWith('')
        expect(deps.flush).toHaveBeenCalled()
    })

    it('preserves trigger in stop_recording event', async () => {
        const deps = createMockDeps()
        const handler = new OffscreenHandler(deps)
        await handler.handleMessage({ type: 'stop-recording', trigger: 'timer' })
        expect(deps.sendEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                metrics: expect.objectContaining({ trigger: 'timer' }),
            }),
        )
    })

    it('clears a previously set recording timer on stop', async () => {
        vi.useFakeTimers()
        try {
            const config = new Configuration()
            config.recordingTimer = { enabled: true, durationMinutes: 10, skipStopConfirmation: false }
            const deps = createMockDeps({
                getConfiguration: vi.fn().mockReturnValue(config),
            })
            const handler = new OffscreenHandler(deps)

            // Start (which sets a timer)
            await handler.handleMessage({
                type: 'start-recording',
                data: { tabSize: { width: 1920, height: 1080 }, streamId: 'stream-1' },
                trigger: 'action-icon',
            })

            // Stop (which should clear the timer)
            await handler.handleMessage({ type: 'stop-recording', trigger: 'action-icon' })

            // Advance time past original timer duration — timer-expired should NOT be sent
            vi.advanceTimersByTime(10 * 60 * 1000 + 1000)
            expect(deps.sendRuntimeMessage).not.toHaveBeenCalledWith({ type: 'timer-expired' })
        } finally {
            vi.useRealTimers()
        }
    })
})

// ---------- cancel-recording ----------

describe('cancel-recording', () => {
    it('calls session.cancel and sends unexpected_stop event', async () => {
        const deps = createMockDeps()
        const handler = new OffscreenHandler(deps)
        await handler.handleMessage({ type: 'cancel-recording' })
        expect(deps.session.cancel).toHaveBeenCalled()
        expect(deps.sendEvent).toHaveBeenCalledWith({
            type: 'unexpected_stop',
            metrics: {
                recording: {
                    durationSec: 3,
                },
            },
        })
    })

    it('clears timer and location hash', async () => {
        const deps = createMockDeps()
        const handler = new OffscreenHandler(deps)
        await handler.handleMessage({ type: 'cancel-recording' })
        expect(deps.setLocationHash).toHaveBeenCalledWith('')
    })

    it('calls flush', async () => {
        const deps = createMockDeps()
        const handler = new OffscreenHandler(deps)
        await handler.handleMessage({ type: 'cancel-recording' })
        expect(deps.flush).toHaveBeenCalled()
    })

    it('sends exception and still clears when session.cancel throws', async () => {
        const error = new Error('cancel failed')
        const deps = createMockDeps({
            session: createMockSession({
                cancel: vi.fn().mockRejectedValue(error),
            }),
        })
        const handler = new OffscreenHandler(deps)
        await handler.handleMessage({ type: 'cancel-recording' })
        expect(deps.sendException).toHaveBeenCalledWith(error, { exceptionSource: 'offscreen.cancelRecording' })
        expect(deps.setLocationHash).toHaveBeenCalledWith('')
        expect(deps.flush).toHaveBeenCalled()
    })
})

// ---------- save-config-local ----------

describe('save-config-local', () => {
    it('calls mergeRemoteConfiguration with data', async () => {
        const data = { userId: 'test-user' } as Configuration
        const deps = createMockDeps()
        const handler = new OffscreenHandler(deps)
        await handler.handleMessage({ type: 'save-config-local', data })
        expect(deps.mergeRemoteConfiguration).toHaveBeenCalledWith(data)
    })

    it('calls flush', async () => {
        const deps = createMockDeps()
        const handler = new OffscreenHandler(deps)
        await handler.handleMessage({ type: 'save-config-local', data: {} as Configuration })
        expect(deps.flush).toHaveBeenCalled()
    })
})

// ---------- update-recording-timer ----------

describe('update-recording-timer', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it('sets timer and sends timer-updated when recording and enabled', async () => {
        const deps = createMockDeps({
            getLocationHash: vi.fn().mockReturnValue('#recording'),
        })
        const handler = new OffscreenHandler(deps)
        await handler.handleMessage({
            type: 'update-recording-timer',
            enabled: true,
            durationMinutes: 15,
        })
        expect(deps.sendRuntimeMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'timer-updated', stopAtMs: expect.any(Number) }),
        )
    })

    it('clears timer and sends timer-updated when recording and disabled', async () => {
        const deps = createMockDeps({
            getLocationHash: vi.fn().mockReturnValue('#recording'),
        })
        const handler = new OffscreenHandler(deps)
        await handler.handleMessage({
            type: 'update-recording-timer',
            enabled: false,
            durationMinutes: 0,
        })
        expect(deps.sendRuntimeMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'timer-updated', stopAtMs: null }),
        )
    })

    it('does nothing when not recording', async () => {
        const deps = createMockDeps({
            getLocationHash: vi.fn().mockReturnValue(''),
        })
        const handler = new OffscreenHandler(deps)
        await handler.handleMessage({
            type: 'update-recording-timer',
            enabled: true,
            durationMinutes: 10,
        })
        expect(deps.sendRuntimeMessage).not.toHaveBeenCalled()
    })

    it('replaces existing timer when called again', async () => {
        const deps = createMockDeps({
            getLocationHash: vi.fn().mockReturnValue('#recording'),
        })
        const handler = new OffscreenHandler(deps)

        // Set first timer (5 min)
        await handler.handleMessage({
            type: 'update-recording-timer',
            enabled: true,
            durationMinutes: 5,
        })
        const firstStopAtMs = (deps.sendRuntimeMessage as Mock).mock.calls[0][0].stopAtMs

        // Set second timer (10 min)
        await handler.handleMessage({
            type: 'update-recording-timer',
            enabled: true,
            durationMinutes: 10,
        })
        const secondStopAtMs = (deps.sendRuntimeMessage as Mock).mock.calls[1][0].stopAtMs

        expect(secondStopAtMs).toBeGreaterThan(firstStopAtMs)

        // Advancing past 5 min should NOT fire timer-expired (first timer replaced)
        vi.advanceTimersByTime(5 * 60 * 1000 + 1000)
        expect(deps.sendRuntimeMessage).not.toHaveBeenCalledWith({ type: 'timer-expired' })
    })
})

// ---------- exception ----------

describe('exception', () => {
    it('throws the exception data', async () => {
        const deps = createMockDeps()
        const handler = new OffscreenHandler(deps)
        const error = new Error('test exception')
        await expect(
            handler.handleMessage({ type: 'exception', data: error }),
        ).rejects.toBe(error)
    })

    it('throws non-Error data as-is', async () => {
        const deps = createMockDeps()
        const handler = new OffscreenHandler(deps)
        await expect(
            handler.handleMessage({ type: 'exception', data: 'string error' }),
        ).rejects.toBe('string error')
    })
})

// ---------- preview-control ----------

describe('preview-control', () => {
    it('calls session.startPreview on start action', async () => {
        const deps = createMockDeps()
        const handler = new OffscreenHandler(deps)
        await handler.handleMessage({ type: 'preview-control', action: 'start' })
        expect(deps.session.startPreview).toHaveBeenCalled()
        expect(deps.session.stopPreview).not.toHaveBeenCalled()
    })

    it('calls session.stopPreview on stop action', async () => {
        const deps = createMockDeps()
        const handler = new OffscreenHandler(deps)
        await handler.handleMessage({ type: 'preview-control', action: 'stop' })
        expect(deps.session.stopPreview).toHaveBeenCalled()
        expect(deps.session.startPreview).not.toHaveBeenCalled()
    })
})

// ---------- update-crop-region ----------

describe('update-crop-region', () => {
    it('calls session.updateCropRegion with region', async () => {
        const region = { x: 10, y: 20, width: 640, height: 480 }
        const deps = createMockDeps()
        const handler = new OffscreenHandler(deps)
        await handler.handleMessage({ type: 'update-crop-region', region })
        expect(deps.session.updateCropRegion).toHaveBeenCalledWith(region)
    })
})

// ---------- timer integration ----------

describe('recording timer', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it('sends timer-expired message when timer fires', async () => {
        const config = new Configuration()
        config.recordingTimer = { enabled: true, durationMinutes: 2, skipStopConfirmation: false }
        const deps = createMockDeps({
            getConfiguration: vi.fn().mockReturnValue(config),
        })
        const handler = new OffscreenHandler(deps)

        await handler.handleMessage({
            type: 'start-recording',
            data: { tabSize: { width: 1920, height: 1080 }, streamId: 'stream-1' },
            trigger: 'action-icon',
        })

        // Advance time to just before expiry — should not fire
        vi.advanceTimersByTime(2 * 60 * 1000 - 1)
        expect(deps.sendRuntimeMessage).not.toHaveBeenCalledWith({ type: 'timer-expired' })

        // Advance past expiry
        vi.advanceTimersByTime(2)
        await Promise.resolve() // flush microtask
        expect(deps.sendRuntimeMessage).toHaveBeenCalledWith({ type: 'timer-expired' })
    })

    it('clearing timer before expiry prevents timer-expired', async () => {
        const config = new Configuration()
        config.recordingTimer = { enabled: true, durationMinutes: 5, skipStopConfirmation: false }
        const deps = createMockDeps({
            getConfiguration: vi.fn().mockReturnValue(config),
        })
        const handler = new OffscreenHandler(deps)

        // Start recording (sets timer)
        await handler.handleMessage({
            type: 'start-recording',
            data: { tabSize: { width: 1920, height: 1080 }, streamId: 'stream-1' },
            trigger: 'action-icon',
        })

        // Cancel recording (clears timer)
        await handler.handleMessage({ type: 'cancel-recording' })

        // Advance past original timer
        vi.advanceTimersByTime(5 * 60 * 1000 + 1000)
        expect(deps.sendRuntimeMessage).not.toHaveBeenCalledWith({ type: 'timer-expired' })
    })

    it('update-recording-timer can set a new timer that fires', async () => {
        const deps = createMockDeps({
            getLocationHash: vi.fn().mockReturnValue('#recording'),
        })
        const handler = new OffscreenHandler(deps)

        await handler.handleMessage({
            type: 'update-recording-timer',
            enabled: true,
            durationMinutes: 1,
        })

        vi.advanceTimersByTime(1 * 60 * 1000 + 1)
        await Promise.resolve()
        expect(deps.sendRuntimeMessage).toHaveBeenCalledWith({ type: 'timer-expired' })
    })
})

// ---------- unknown / unhandled message types ----------

describe('unknown message type', () => {
    it('returns null for unhandled message types', () => {
        const deps = createMockDeps()
        const handler = new OffscreenHandler(deps)
        const result = handler.handleMessage({ type: 'fetch-config' } as unknown as Message)
        expect(result).toBeNull()
    })
})
