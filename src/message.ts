import type { Resolution, Configuration } from './configuration'

export type Message =
    | ExceptionMessage
    | StartRecordingMessage
    | UpdateRecordingIconMessage
    | StopRecordingMessage
    | CompleteRecordingMessage
    | ResizeWindowMessage
    | FetchConfigMessage
    | SaveConfigLocalMessage
    | SaveConfigSyncMessage
    ;

export interface ExceptionMessage {
    type: 'exception';
    data: unknown;
}

export interface StartRecordingMessage {
    type: 'start-recording';
    data: StartRecording;
}
export interface StartRecording {
    tabSize: Resolution;
    streamId: string;
}

export interface UpdateRecordingIconMessage {
    type: 'update-recording-icon';
    icon: 'video-and-audio' | 'audio-only' | 'video-only';
}

export interface StopRecordingMessage {
    type: 'stop-recording';
}

export interface CompleteRecordingMessage {
    type: 'complete-recording';
}

export interface ResizeWindowMessage {
    type: 'resize-window';
    data: Resolution;
}

export interface FetchConfigMessage {
    type: 'fetch-config';
}

export interface SaveConfigLocalMessage {
    type: 'save-config-local';
    data: Configuration;
}

export interface SaveConfigSyncMessage {
    type: 'save-config-sync';
    data: Configuration;
}
