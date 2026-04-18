import type { StartTrigger, Trigger } from './message'

export interface ExceptionMetadata {
    exceptionSource: string
    additionalMetadata?: Record<string, string>
}

export type Event = StartRecordingEvent | StopRecordingEvent | UnexpectedStopEvent | ClickExternalLinkEvent

export interface StartRecordingEvent {
    type: 'start_recording'
    tags: {
        trigger: StartTrigger
        state: {
            opfsPersisted: boolean
        }
    }
}

export interface StopRecordingEvent {
    type: 'stop_recording'
    metrics: {
        trigger: Trigger
        recording: {
            durationSec: number
            filesize: number
        }
    }
}

export interface UnexpectedStopEvent {
    type: 'unexpected_stop'
    metrics: {
        recording: {
            durationSec: number
        }
    }
}

export interface ClickExternalLinkEvent {
    type: 'click_external_link'
    tags: {
        link: 'support' | 'review'
    }
}
