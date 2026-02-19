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
const containerFormats = ['webm', 'mp4'] as const
export type ContainerFormat = (typeof containerFormats)[number]
export function isContainerFormat(v: unknown): v is ContainerFormat {
    return containerFormats.some(f => v === f)
}

export const ALL_VIDEO_CODECS = ['vp8', 'vp9', 'av1', 'avc', 'hevc'] as const
export type VideoCodecType = (typeof ALL_VIDEO_CODECS)[number]
const videoCodecs = ALL_VIDEO_CODECS
export function isVideoCodec(v: unknown): v is VideoCodecType {
    return videoCodecs.some(c => v === c)
}

export const ALL_AUDIO_CODECS = ['opus', 'aac', 'vorbis'] as const
export type AudioCodecType = (typeof ALL_AUDIO_CODECS)[number]
const audioCodecs = ALL_AUDIO_CODECS
export function isAudioCodec(v: unknown): v is AudioCodecType {
    return audioCodecs.some(c => v === c)
}

/** Available codecs per container format */
export const containerCodecs: Record<ContainerFormat, { video: VideoCodecType[], audio: AudioCodecType[] }> = {
    webm: { video: ['vp8', 'vp9', 'av1'], audio: ['opus', 'vorbis'] },
    mp4: { video: ['avc', 'hevc', 'vp9', 'av1'], audio: ['aac', 'opus'] },
}

/** Container format to file extension */
export function containerExtension(container: ContainerFormat): string {
    switch (container) {
        case 'webm': return '.webm'
        case 'mp4': return '.mp4'
    }
}

export interface VideoFormat {
    audioBitrate: number; // bps
    videoBitrate: number; // bps
    frameRate: number; // fps
    container: ContainerFormat;
    videoCodec: VideoCodecType;
    audioCodec: AudioCodecType;
    recordingMode: VideoRecordingMode;
}

/**
 * Migrate legacy configuration that used mimeType string
 */
export function migrateFromMimeType(mimeType: string): { container: ContainerFormat, videoCodec: VideoCodecType, audioCodec: AudioCodecType } {
    const base = mimeType.split(';')[0]
    const codecStr = mimeType.match(/codecs="?([^"]+)"?/)?.[1] ?? ''
    const codecs = codecStr.split(',').map(c => c.trim().toLowerCase())

    const container: ContainerFormat = base === 'video/mp4' ? 'mp4' : 'webm'

    let videoCodec: VideoCodecType = container === 'mp4' ? 'avc' : 'vp9'
    for (const c of codecs) {
        if (c === 'vp9') { videoCodec = 'vp9'; break }
        if (c === 'vp8') { videoCodec = 'vp8'; break }
        if (c === 'av1' || c.startsWith('av01')) { videoCodec = 'av1'; break }
        if (c.startsWith('avc') || c.startsWith('h264')) { videoCodec = 'avc'; break }
        if (c.startsWith('hev') || c.startsWith('hvc') || c.startsWith('h265')) { videoCodec = 'hevc'; break }
    }

    let audioCodec: AudioCodecType = container === 'mp4' ? 'aac' : 'opus'
    for (const c of codecs) {
        if (c === 'opus') { audioCodec = 'opus'; break }
        if (c === 'vorbis') { audioCodec = 'vorbis'; break }
        if (c.startsWith('mp4a') || c === 'aac') { audioCodec = 'aac'; break }
    }

    return { container, videoCodec, audioCodec }
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
    Pick<Configuration, 'windowSize' | 'screenRecordingSize' | 'videoFormat' | 'openOptionPage' | 'muteRecordingTab' | 'recordingSortOrder'>
    & { microphone: Omit<Microphone, 'deviceId'> }
    & { cropping: Pick<CroppingConfig, 'enabled'> & { region: Pick<CropRegion, 'width' | 'height'> } }

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
            container: 'webm',
            videoCodec: 'vp9',
            audioCodec: 'opus',
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
        const { windowSize, screenRecordingSize, videoFormat, openOptionPage, muteRecordingTab, microphone, cropping, recordingSortOrder } = config
        return {
            windowSize,
            screenRecordingSize,
            videoFormat,
            openOptionPage,
            muteRecordingTab,
            microphone: { enabled: microphone.enabled, gain: microphone.gain },
            cropping: { enabled: cropping.enabled, region: { width: cropping.region.width, height: cropping.region.height } },
            recordingSortOrder,
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
