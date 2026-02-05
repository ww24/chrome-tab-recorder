export interface ExceptionMetadata {
    exceptionSource: string;
}

export type Event = StartRecordingEvent | StopRecordingEvent | UnexpectedStopEvent;

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
