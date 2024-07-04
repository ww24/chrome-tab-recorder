import type { Resolution, Configuration } from './configuration'

export type Message = OffscreenStartRecordingMessage
    | OffscreenStopRecordingMessage
    | OffscreenSyncConfigMessage
    | ExceptionMessage
    | OptionSyncConfigMessage
    | BackgroundStopRecordingMessage
    | BackgroundWindowSizeMessage
    | BackgroundSyncConfigMessage
    | BackgroundFetchConfigMessage;

export interface OffscreenMessage {
    target: 'offscreen';
}
export interface OffscreenStartRecordingMessage extends OffscreenMessage {
    type: 'start-recording';
    data: StartRecording;
}
export interface OffscreenStopRecordingMessage extends OffscreenMessage {
    type: 'stop-recording';
}
export interface OffscreenSyncConfigMessage extends OffscreenMessage {
    type: 'sync-config';
    data: Configuration;
}
export interface ExceptionMessage extends OffscreenMessage {
    type: 'exception';
    data: unknown;
}

export interface OptionMessage {
    target: 'option';
}
export interface OptionSyncConfigMessage extends OptionMessage {
    type: 'sync-config';
    data: Configuration;
}

export interface BackgroundMessage {
    target: 'background';
}
export interface BackgroundStopRecordingMessage extends BackgroundMessage {
    type: 'stop-recording';
}
export interface BackgroundWindowSizeMessage extends BackgroundMessage {
    type: 'resize-window';
    data: Resolution;
}
export interface BackgroundSyncConfigMessage extends BackgroundMessage {
    type: 'sync-config';
    data: Configuration;
}
export interface BackgroundFetchConfigMessage extends BackgroundMessage {
    type: 'fetch-config';
}

export interface StartRecording {
    tabSize: Resolution;
    streamId: string;
}
