export interface ExceptionMetadata {
    exceptionSource: string;
}

export type Event = StartRecordingEvent | StopRecordingEvent | UnexpectedStopEvent | ClickExternalLinkEvent;

export interface StartRecordingEvent {
    type: 'start_recording';
    tags: {
        state: {
            opfsPersisted: boolean,
        },
    };
}

export interface StopRecordingEvent {
    type: 'stop_recording';
    metrics: {
        recording: {
            durationSec: number,
            filesize: number,
        },
    };
}

export interface UnexpectedStopEvent {
    type: 'unexpected_stop';
    metrics: {
        recording: {
            durationSec: number,
        },
    };
}

export interface ClickExternalLinkEvent {
    type: 'click_external_link';
    tags: {
        link: 'support' | 'review',
    };
}
