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
    taskId: string;
}
export interface StartRecording {
    tabSize: Resolution;
    streamId: string;
    tabId: number;
    tabTitle?: string;
}

export interface UpdateRecordingIconMessage {
    type: 'update-recording-icon';
    icon: 'video-and-audio' | 'audio-only' | 'video-only';
    tabId?: number;
}

export interface StopRecordingMessage {
    type: 'stop-recording';
    taskId?: string;
}

export interface CompleteRecordingMessage {
    type: 'complete-recording';
    taskId: string;
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
