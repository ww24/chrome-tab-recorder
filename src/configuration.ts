export interface Resolution {
    width: number;
    height: number;
}
export interface VideoFormat {
    audioBitrate: number; // bps
    videoBitrate: number; // bps
    frameRate: number; // fps
    mimeType: string;
    recordingMode: VideoRecordingMode;
}
export interface ScreenRecordingSize extends Resolution {
    auto: boolean;
    scale: number;
}
export interface Microphone {
    enabled: boolean | null // null when excluded from sync to prevent cross-device permission conflicts
    gain: number
    deviceId: string | null // null = default device, string = specific device ID
}
export interface RecordingInfo {
    videoFormat: VideoFormat
    recordingSize: Resolution
}
const videoRecordingMode = ['video-and-audio', 'video-only', 'audio-only'] as const
export type VideoRecordingMode = (typeof videoRecordingMode)[number];
export function isVideoRecordingMode(v: unknown): v is VideoRecordingMode {
    return videoRecordingMode.some(m => v === m)
}
export class Configuration {
    public static readonly key = 'settings'
    windowSize: Resolution
    screenRecordingSize: ScreenRecordingSize
    videoFormat: VideoFormat
    enableBugTracking: boolean
    updatedAt: number
    userId: string
    openOptionPage: boolean
    muteRecordingTab: boolean
    microphone: Microphone
    constructor() {
        this.windowSize = {
            width: 1920,
            height: 1080,
        }
        this.screenRecordingSize = {
            width: 1920,
            height: 1080,
            auto: true,
            scale: 2,
        }
        this.videoFormat = {
            audioBitrate: 256 * 1024, // 256Kbps
            videoBitrate: 0, // auto
            frameRate: 30, // 30fps
            mimeType: 'video/webm;codecs="vp9,opus"',
            recordingMode: 'video-and-audio',
        }
        this.enableBugTracking = true
        this.updatedAt = 0
        this.userId = ''
        this.openOptionPage = true
        this.muteRecordingTab = false
        this.microphone = {
            enabled: false,
            gain: 1.0,
            deviceId: null,
        }
    }
    static restoreDefault({ userId }: Configuration): Configuration {
        const config = new Configuration()
        return { ...config, userId }
    }
    static filterForSync(config: Configuration): Configuration {
        return {
            ...config,
            microphone: {
                ...config.microphone,
                enabled: null,
            },
        }
    }
    static screenRecordingSize(screenRecordingSize: ScreenRecordingSize, base: Resolution): Resolution {
        if (screenRecordingSize.auto && base.width > 0 && base.height > 0) {
            return {
                width: base.width * screenRecordingSize.scale,
                height: base.height * screenRecordingSize.scale,
            }
        }
        return screenRecordingSize
    }
    static videoFormat(videoFormat: VideoFormat, screenRecordingSize: Resolution): VideoFormat {
        if (videoFormat.videoBitrate === 0) {
            return {
                ...videoFormat,
                videoBitrate: 8 * screenRecordingSize.width * screenRecordingSize.height,
            }
        }
        return videoFormat
    }
};
