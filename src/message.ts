import type { Resolution, Configuration, SyncConfiguration, CropRegion } from './configuration'

export type Message =
    | ExceptionMessage
    | StartRecordingMessage
    | UpdateRecordingIconMessage
    | TabTrackEndedMessage
    | StopRecordingMessage
    | UnexpectedRecordingStateMessage
    | CancelRecordingMessage
    | ResizeWindowMessage
    | FetchConfigMessage
    | SaveConfigLocalMessage
    | SaveConfigSyncMessage
    | RecordingStateMessage
    | RequestRecordingStateMessage
    | PreviewFrameMessage
    | PreviewControlMessage
    | UpdateCropRegionMessage
    ;

export interface ExceptionMessage {
    type: 'exception';
    data: unknown;
}

export type Trigger = 'action-icon' | 'context-menu' | 'keyboard-shortcut' | 'tab-track-ended'

export type StartTrigger = Exclude<Trigger, 'tab-track-ended'>

export interface StartRecordingMessage {
    type: 'start-recording';
    data: StartRecording;
    trigger: StartTrigger;
}
export interface StartRecording {
    startAtMs: number; // unix timestamp [ms]
    tabSize: Resolution;
    streamId: string;
}

export interface UpdateRecordingIconMessage {
    type: 'update-recording-icon';
    icon: 'video-and-audio' | 'audio-only' | 'video-only';
}

export interface TabTrackEndedMessage {
    type: 'tab-track-ended';
}

export interface StopRecordingMessage {
    type: 'stop-recording';
    trigger: Trigger;
}

export interface UnexpectedRecordingStateMessage {
    type: 'unexpected-recording-state';
}

export interface CancelRecordingMessage {
    type: 'cancel-recording';
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
    data: SyncConfiguration;
}

// Recording state notification (service_worker → option page)
export interface RecordingStateMessage {
    type: 'recording-state';
    isRecording: boolean;
    screenSize?: Resolution;
}

// Request current recording state (option page → service_worker)
export interface RequestRecordingStateMessage {
    type: 'request-recording-state';
}

// Preview frame transfer (offscreen → service_worker → option page)
export interface PreviewFrameMessage {
    type: 'preview-frame';
    recordingSize: Resolution;
    image: string; // base64 encoded jpeg image
}

// Preview start/stop request (option page → service_worker → offscreen)
export interface PreviewControlMessage {
    type: 'preview-control';
    action: 'start' | 'stop';
}

// Cropping region update (option page → service_worker → offscreen)
export interface UpdateCropRegionMessage {
    type: 'update-crop-region';
    region: CropRegion;
}
