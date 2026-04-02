jest.mock('mediabunny', () => ({
    canEncodeAudio: jest.fn().mockResolvedValue(true),
}))
jest.mock('@mediabunny/flac-encoder', () => ({
    registerFlacEncoder: jest.fn(),
}))

import { handleMessage, type ServiceWorkerDeps } from './service_worker_handler'
import type { Message, Trigger } from './message'
import type { RecordingState } from './handler'
import type { Configuration } from './configuration'

// ---------- helpers ----------

function createMockDeps(overrides: Partial<ServiceWorkerDeps> = {}): ServiceWorkerDeps {
    return {
        getRecordingState: jest.fn<Promise<RecordingState>, []>().mockResolvedValue({ isRecording: false }),
        setRecordingState: jest.fn<Promise<void>, [RecordingState]>().mockResolvedValue(undefined),
        getConfiguration: jest.fn<Promise<Configuration>, []>().mockResolvedValue({} as Configuration),
        getRemoteConfiguration: jest.fn<Promise<Configuration | null>, []>().mockResolvedValue(null),
        stopRecording: jest.fn<Promise<void>, [Trigger, boolean?]>().mockResolvedValue(undefined),
        cancelRecording: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
        broadcastRecordingState: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
        updateActionTitle: jest.fn<Promise<void>, [RecordingState]>().mockResolvedValue(undefined),
        resizeWindow: jest.fn<Promise<void>, [{ width: number; height: number }]>().mockResolvedValue(undefined),
        storageSyncSet: jest.fn<Promise<void>, [string, unknown]>().mockResolvedValue(undefined),
        ...overrides,
    }
}

// ---------- confirm-timer-stop ----------

describe('confirm-timer-stop', () => {
    it('passes trigger to stopRecording with skipConfirmation=true', async () => {
        const deps = createMockDeps()
        const result = await handleMessage({ type: 'confirm-timer-stop', trigger: 'keyboard-shortcut' }, deps)
        expect(result.fireAndForget).toBeInstanceOf(Promise)
        await result.fireAndForget
        expect(deps.stopRecording).toHaveBeenCalledWith('keyboard-shortcut', true)
    })

    it('preserves action-icon trigger', async () => {
        const deps = createMockDeps()
        const result = await handleMessage({ type: 'confirm-timer-stop', trigger: 'action-icon' }, deps)
        await result.fireAndForget
        expect(deps.stopRecording).toHaveBeenCalledWith('action-icon', true)
    })

    it('preserves context-menu trigger', async () => {
        const deps = createMockDeps()
        const result = await handleMessage({ type: 'confirm-timer-stop', trigger: 'context-menu' }, deps)
        await result.fireAndForget
        expect(deps.stopRecording).toHaveBeenCalledWith('context-menu', true)
    })
})

// ---------- timer-expired ----------

describe('timer-expired', () => {
    it('calls stopRecording with timer trigger and skipConfirmation=true', async () => {
        const deps = createMockDeps()
        const result = await handleMessage({ type: 'timer-expired' }, deps)
        expect(result.fireAndForget).toBeInstanceOf(Promise)
        await result.fireAndForget
        expect(deps.stopRecording).toHaveBeenCalledWith('timer', true)
    })
})

// ---------- timer-updated ----------

describe('timer-updated', () => {
    it('updates recording state with stopAtMs when recording', async () => {
        const state: RecordingState = { isRecording: true, startAtMs: 1000 }
        const deps = createMockDeps({
            getRecordingState: jest.fn<Promise<RecordingState>, []>().mockResolvedValue(state),
        })
        await handleMessage({ type: 'timer-updated', stopAtMs: 61000 }, deps)
        expect(deps.setRecordingState).toHaveBeenCalledWith({ ...state, stopAtMs: 61000 })
        expect(deps.broadcastRecordingState).toHaveBeenCalled()
        expect(deps.updateActionTitle).toHaveBeenCalled()
    })

    it('clears stopAtMs when stopAtMs is null', async () => {
        const state: RecordingState = { isRecording: true, startAtMs: 1000, stopAtMs: 61000 }
        const deps = createMockDeps({
            getRecordingState: jest.fn<Promise<RecordingState>, []>().mockResolvedValue(state),
        })
        await handleMessage({ type: 'timer-updated', stopAtMs: null }, deps)
        expect(deps.setRecordingState).toHaveBeenCalledWith({ ...state, stopAtMs: undefined })
    })

    it('does nothing when not recording', async () => {
        const deps = createMockDeps({
            getRecordingState: jest.fn<Promise<RecordingState>, []>().mockResolvedValue({ isRecording: false }),
        })
        await handleMessage({ type: 'timer-updated', stopAtMs: 61000 }, deps)
        expect(deps.setRecordingState).not.toHaveBeenCalled()
        expect(deps.broadcastRecordingState).not.toHaveBeenCalled()
    })
})

// ---------- tab-track-ended ----------

describe('tab-track-ended', () => {
    it('calls stopRecording with tab-track-ended trigger and skipConfirmation=true (fire-and-forget)', async () => {
        const deps = createMockDeps()
        const result = await handleMessage({ type: 'tab-track-ended' }, deps)
        expect(result.fireAndForget).toBeInstanceOf(Promise)
        await result.fireAndForget
        expect(deps.stopRecording).toHaveBeenCalledWith('tab-track-ended', true)
    })
})

// ---------- unexpected-recording-state ----------

describe('unexpected-recording-state', () => {
    it('calls cancelRecording with error (fire-and-forget)', async () => {
        const deps = createMockDeps()
        const result = await handleMessage({ type: 'unexpected-recording-state', error: 'test error' }, deps)
        expect(result.fireAndForget).toBeInstanceOf(Promise)
        await result.fireAndForget
        expect(deps.cancelRecording).toHaveBeenCalledWith('test error')
    })
})

// ---------- recording-tick ----------

describe('recording-tick', () => {
    it('updates action title with current state', async () => {
        const state: RecordingState = { isRecording: true, startAtMs: 1000 }
        const deps = createMockDeps({
            getRecordingState: jest.fn<Promise<RecordingState>, []>().mockResolvedValue(state),
        })
        await handleMessage({ type: 'recording-tick' }, deps)
        expect(deps.updateActionTitle).toHaveBeenCalledWith(state)
    })
})

// ---------- resize-window ----------

describe('resize-window', () => {
    it('calls resizeWindow with data', async () => {
        const deps = createMockDeps()
        await handleMessage({ type: 'resize-window', data: { width: 1280, height: 720 } }, deps)
        expect(deps.resizeWindow).toHaveBeenCalledWith({ width: 1280, height: 720 })
    })

    it('ignores invalid data (null)', async () => {
        const deps = createMockDeps()
        await handleMessage({ type: 'resize-window', data: null as unknown as { width: number; height: number } }, deps)
        expect(deps.resizeWindow).not.toHaveBeenCalled()
    })
})

// ---------- save-config-sync ----------

describe('save-config-sync', () => {
    it('saves config to sync storage', async () => {
        const deps = createMockDeps()
        const syncData = { key: 'value' } as unknown as Configuration
        await handleMessage({ type: 'save-config-sync', data: syncData } as Message, deps)
        expect(deps.storageSyncSet).toHaveBeenCalledWith('settings', syncData)
    })
})

// ---------- fetch-config ----------

describe('fetch-config', () => {
    it('returns merged config when remote exists', async () => {
        const remoteConfig = { userId: 'test-user' } as Configuration
        const deps = createMockDeps({
            getRemoteConfiguration: jest.fn<Promise<Configuration | null>, []>().mockResolvedValue(remoteConfig),
        })
        const result = await handleMessage({ type: 'fetch-config' }, deps)
        expect(result.response).toBeDefined()
        expect(result.response?.userId).toBe('test-user')
    })

    it('returns empty result when no remote config', async () => {
        const deps = createMockDeps({
            getRemoteConfiguration: jest.fn<Promise<Configuration | null>, []>().mockResolvedValue(null),
        })
        const result = await handleMessage({ type: 'fetch-config' }, deps)
        expect(result.response).toBeUndefined()
    })
})

// ---------- request-recording-state ----------

describe('request-recording-state', () => {
    it('broadcasts recording state', async () => {
        const deps = createMockDeps()
        await handleMessage({ type: 'request-recording-state' }, deps)
        expect(deps.broadcastRecordingState).toHaveBeenCalled()
    })
})

// ---------- unknown message types ----------

describe('unknown message type', () => {
    it('returns empty result for unhandled message types', async () => {
        const deps = createMockDeps()
        const result = await handleMessage({ type: 'start-recording' } as unknown as Message, deps)
        expect(result).toEqual({})
    })
})
