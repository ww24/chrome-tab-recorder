export interface Resolution {
    width: number;
    height: number;
}
export interface VideoFormat {
    audioBitrate: number; // bps
    videoBitrate: number; // bps
    mimeType: string;
}
export interface ScreenRecordingSize extends Resolution {
    auto: boolean;
    scale: number;
}
export class Configuration {
    public static readonly key = 'settings'
    windowSize: Resolution
    screenRecordingSize: ScreenRecordingSize
    videoFormat: VideoFormat
    enableBugTracking: boolean
    updatedAt: number
    userId: string
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
            mimeType: 'video/webm;codecs="vp9,opus"',
        }
        this.enableBugTracking = true
        this.updatedAt = 0
        this.userId = ''
    }
    static restoreDefault({ userId }: Configuration): Configuration {
        const config = new Configuration()
        return { ...config, userId }
    }
    static screenRecordingSize(config: Configuration, base: Resolution): Resolution {
        if (config.screenRecordingSize.auto && base.width > 0 && base.height > 0) {
            return {
                width: base.width * config.screenRecordingSize.scale,
                height: base.height * config.screenRecordingSize.scale,
            }
        }
        return config.screenRecordingSize
    }
    static videoFormat(config: Configuration): VideoFormat {
        if (config.videoFormat.videoBitrate === 0) {
            return {
                ...config.videoFormat,
                videoBitrate: 8 * config.screenRecordingSize.width * config.screenRecordingSize.height,
            }
        }
        return config.videoFormat
    }
};
