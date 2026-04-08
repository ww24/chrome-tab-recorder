import type {
    Message,
    Trigger,
} from './message'
import { Configuration, type Resolution } from './configuration'
import type { RecordingState } from './handler'
import { deepMerge } from './element/util'

export interface ServiceWorkerDeps {
    getRecordingState: () => Promise<RecordingState>
    setRecordingState: (state: RecordingState) => Promise<void>
    getConfiguration: () => Promise<Configuration>
    getRemoteConfiguration: () => Promise<Configuration | null>
    stopRecording: (trigger: Trigger, skipConfirmation?: boolean) => Promise<void>
    pauseRecording: (trigger: Trigger) => Promise<void>
    resumeRecording: (trigger: Trigger) => Promise<void>
    cancelRecording: (error: string) => Promise<void>
    broadcastRecordingState: () => Promise<void>
    updateActionTitle: (state: RecordingState) => Promise<void>
    resizeWindow: (resolution: Resolution) => Promise<void>
    storageSyncSet: (key: string, value: object) => Promise<void>
}

export type HandleMessageResult = {
    response?: Configuration
    fireAndForget?: Promise<void>
}

export async function handleMessage(
    message: Message,
    deps: ServiceWorkerDeps,
): Promise<HandleMessageResult> {
    switch (message.type) {
        case 'resize-window':
            if (typeof message.data !== 'object' || message.data == null) return {}
            await deps.resizeWindow(message.data)
            return {}
        case 'recording-tick':
            const state = await deps.getRecordingState()
            await deps.updateActionTitle(state)
            return {}
        case 'tab-track-ended':
            return { fireAndForget: deps.stopRecording('tab-track-ended', true) }
        case 'timer-expired':
            return { fireAndForget: deps.stopRecording('timer', true) }
        case 'pause-recording':
            return { fireAndForget: deps.pauseRecording(message.trigger) }
        case 'resume-recording':
            return { fireAndForget: deps.resumeRecording(message.trigger) }
        case 'timer-updated':
            const timerState = await deps.getRecordingState()
            if (timerState.isRecording) {
                const updatedTimerState = { ...timerState, stopAtMs: message.stopAtMs ?? undefined }
                await deps.setRecordingState(updatedTimerState)
                await deps.broadcastRecordingState()
                await deps.updateActionTitle(updatedTimerState)
            }
            return {}
        case 'confirm-timer-stop':
            return { fireAndForget: deps.stopRecording(message.trigger, true) }
        case 'unexpected-recording-state':
            return { fireAndForget: deps.cancelRecording(message.error) }
        case 'save-config-sync':
            await deps.storageSyncSet(Configuration.key, message.data)
            return {}
        case 'fetch-config':
            const defaultConfig = new Configuration()
            const remoteConfig = await deps.getRemoteConfiguration()
            if (remoteConfig == null) return {}
            const config = deepMerge(defaultConfig, remoteConfig)
            console.debug('fetch:', config)
            return { response: config }
        case 'request-recording-state':
            await deps.broadcastRecordingState()
            return {}
    }
    return {}
}
