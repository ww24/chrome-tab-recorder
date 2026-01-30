export interface PreviewFrame {
    image: Blob;
    width: number;
    height: number;
}

export class Preview {
    private interval: number = 500 // 500ms
    private maxPreviewSize: number = 1200 // 1,200px
    private callback: ((frame: PreviewFrame) => void)
    private intervalId?: ReturnType<typeof setInterval>
    private imageCapture?: ImageCapture
    private canvas: OffscreenCanvas = new OffscreenCanvas(1, 1)
    private canvasCtx?: ImageBitmapRenderingContext | null = this.canvas.getContext('bitmaprenderer', { alpha: false, willReadFrequently: false })
    constructor(callback: (frame: PreviewFrame) => void) {
        this.callback = callback
    }

    public start(videoTrack: MediaStreamTrack) {
        if (this.intervalId != null) return
        this.imageCapture = new ImageCapture(videoTrack)
        this.intervalId = setInterval(this.render.bind(this), this.interval)
    }

    public stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId)
            this.intervalId = undefined
        }
        this.imageCapture = undefined
    }

    private async render() {
        try {
            if (!this.imageCapture || !this.canvasCtx) return
            const imageBitmap = await this.imageCapture.grabFrame()

            // Calculate preview size
            const { width, height } = imageBitmap
            const scale = Math.min(1, this.maxPreviewSize / Math.max(width, height))
            const previewWidth = Math.round(width * scale)
            const previewHeight = Math.round(height * scale)

            // Set canvas size for preview
            this.canvas.width = previewWidth
            this.canvas.height = previewHeight

            // Consuming ImageBitmap with canvas
            this.canvasCtx.transferFromImageBitmap(imageBitmap)

            // Convert to JPEG blob
            const image = await this.canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })

            // Send preview frame
            this.callback({ image, width, height })
        } catch (e) {
            console.error('Preview frame error:', e)
            // Continue on error, next interval will retry
        }
    }
}
