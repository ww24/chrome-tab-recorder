export interface Resolution {
    width: number;
    height: number;
}
export class Configuration {
    public static readonly key = 'settings'
    windowSize: Resolution
    screenRecordingSize: Resolution
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
        }
        this.enableBugTracking = true
        this.updatedAt = 0
        this.userId = ''
    }
};
