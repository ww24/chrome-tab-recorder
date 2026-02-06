export interface Resolution {
    width: number;
    height: number;
}
export interface CropRegion {
    x: number;      // Top-left X coordinate (px)
    y: number;      // Top-left Y coordinate (px)
    width: number;  // Width (px)
    height: number; // Height (px)
}
export interface CroppingConfig {
    enabled: boolean;   // Cropping feature ON/OFF
    region: CropRegion; // Cropping region
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
    enabled: boolean
    gain: number
    deviceId: string | null // null = default device, string = specific device ID
}
export interface RecordingInfo {
    videoFormat: VideoFormat
    recordingSize: Resolution
}

/**
 * Sort order for recording list
 */
export type RecordingSortOrder = 'asc' | 'desc'
const videoRecordingMode = ['video-and-audio', 'video-only', 'audio-only'] as const
export type VideoRecordingMode = (typeof videoRecordingMode)[number];
export function isVideoRecordingMode(v: unknown): v is VideoRecordingMode {
    return videoRecordingMode.some(m => v === m)
}

// Configuration type for sync storage (excludes device-specific settings)
export type SyncConfiguration = Omit<Configuration, 'microphone' | 'cropping'>

export type ReportConfiguration =
    Pick<Configuration, 'windowSize' | 'screenRecordingSize' | 'videoFormat' | 'openOptionPage' | 'muteRecordingTab' | 'cropping'>
    & { microphone: Omit<Microphone, 'deviceId'> }

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
    cropping: CroppingConfig
    recordingSortOrder: RecordingSortOrder
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
        this.cropping = {
            enabled: false,
            region: {
                x: 0,
                y: 0,
                width: 1920,
                height: 1080,
            },
        }
        this.recordingSortOrder = 'asc'
    }
    static restoreDefault({ userId }: Configuration): Configuration {
        const config = new Configuration()
        return { ...config, userId }
    }
    static filterForSync(config: Configuration): SyncConfiguration {
        // Exclude microphone and cropping from sync as it depends on device-specific information
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { microphone: _m, cropping: _c, ...rest } = config
        return { ...rest }
    }
    static filterForReport(config: Configuration): ReportConfiguration {
        const { windowSize, screenRecordingSize, videoFormat, openOptionPage, muteRecordingTab, microphone, cropping } = config
        return {
            windowSize,
            screenRecordingSize,
            videoFormat,
            openOptionPage,
            muteRecordingTab,
            microphone: { enabled: microphone.enabled, gain: microphone.gain },
            cropping,
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
