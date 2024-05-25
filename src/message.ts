export type Message = OffscreenStartRecordingMessage
    | OffscreenStopRecordingMessage
    | BackgroundStopRecordingMessage
    | BackgroundWindowSizeMessage;

export interface OffscreenMessage {
    target: 'offscreen';
}
export interface OffscreenStartRecordingMessage extends OffscreenMessage {
    type: 'start-recording';
    data: string;
}
export interface OffscreenStopRecordingMessage extends OffscreenMessage {
    type: 'stop-recording';
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
export interface Resolution {
    width: number;
    height: number;
}
