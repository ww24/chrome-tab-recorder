import type { Resolution, Configuration, SyncConfiguration, CropRegion } from './configuration'

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
