export class MIMEType {
    public static readonly webm = Symbol()
    public static readonly mp4 = Symbol()

    private mimeType: symbol
    constructor(mimeType: string) {
        switch (mimeType.split(';')[0]) {
            case 'video/webm':
                this.mimeType = MIMEType.webm
                break
            case 'video/mp4':
                this.mimeType = MIMEType.mp4
                break
            default:
                this.mimeType = MIMEType.webm
                break
        }
    }

    extension(): string {
        switch (this.mimeType) {
            case MIMEType.webm:
                return '.webm'
            case MIMEType.mp4:
                return '.mp4'
            default:
                return '.webm'
        }
    }

    is(type: symbol): boolean {
        return this.mimeType === type
    }
}
