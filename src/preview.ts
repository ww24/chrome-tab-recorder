export interface PreviewFrame {
    imageUrl: string;
    width: number;
    height: number;
}

export class Preview {
    #interval: number = 500 // 500ms
    #maxPreviewSize: number = 1200 // 1,200px
    #callback: ((frame: PreviewFrame) => void)
    #intervalId: ReturnType<typeof setInterval> | null = null
    #imageCapture: ImageCapture | null = null
    #canvas: OffscreenCanvas = new OffscreenCanvas(1, 1)
    #canvasCtx: OffscreenCanvasRenderingContext2D | null = this.#canvas.getContext('2d', { alpha: false, willReadFrequently: true })
    #imageObjectUrl: string | null = null
    constructor(callback: (frame: PreviewFrame) => void) {
        this.#callback = callback
    }

    public start(videoTrack: MediaStreamTrack) {
        if (this.#intervalId !== null) return
        this.#imageCapture = new ImageCapture(videoTrack)
        this.#intervalId = setInterval(this.render.bind(this), this.#interval)
    }

    public stop() {
        if (this.#intervalId) {
            clearInterval(this.#intervalId)
            this.#intervalId = null
        }
        if (this.#imageObjectUrl) {
            URL.revokeObjectURL(this.#imageObjectUrl)
            this.#imageObjectUrl = null
        }
        this.#imageCapture = null
    }

    private async render() {
        try {
            if (!this.#imageCapture || !this.#canvasCtx) return
            const imageBitmap = await this.#imageCapture.grabFrame()

            // Calculate preview size (max 600px for longer edge)
            const { width, height } = imageBitmap
            const scale = Math.min(1, this.#maxPreviewSize / Math.max(width, height))
            const previewWidth = Math.round(width * scale)
            const previewHeight = Math.round(height * scale)

            // Set canvas size for preview
            this.#canvas.width = previewWidth
            this.#canvas.height = previewHeight

            this.#canvasCtx.drawImage(imageBitmap, 0, 0, previewWidth, previewHeight)
            imageBitmap.close()

            // Revoke old preview image object url
            if (this.#imageObjectUrl !== null) URL.revokeObjectURL(this.#imageObjectUrl)

            // Convert to JPEG blob
            const blob = await this.#canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })
            this.#imageObjectUrl = URL.createObjectURL(blob)

            // Send preview frame
            this.#callback({ imageUrl: this.#imageObjectUrl, width, height })
        } catch (e) {
            console.error('Preview frame error:', e)
            // Continue on error, next interval will retry
        }
    }
}
