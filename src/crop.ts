import { CropRegion } from './configuration'

export class Crop {
    region: CropRegion | null = null
    #frameRate: number = 1
    #interval: number = 1
    #intervalId: ReturnType<typeof setInterval> | null = null
    #videoTrack: MediaStreamTrack | null = null
    #video: HTMLVideoElement = document.createElement('video')
    #canvas: HTMLCanvasElement = document.createElement('canvas')
    #canvasCtx: CanvasRenderingContext2D | null = this.#canvas.getContext('2d', { alpha: false, willReadFrequently: false })
    constructor(frameRate: number = 30) {
        this.setFrameRate(frameRate)
    }

    private setFrameRate(frameRate: number) {
        this.#frameRate = frameRate
        this.#interval = 1000 / frameRate
    }

    // Create cropped media stream using Canvas
    public getCroppedStream(originalStream: MediaStream, cropRegion: CropRegion) {
        this.region = cropRegion
        this.#videoTrack = originalStream.getVideoTracks()[0]
        if (!this.#videoTrack) return originalStream
        const frameRate = this.#videoTrack.getSettings().frameRate || this.#frameRate
        this.setFrameRate(frameRate)

        // Create hidden video element to receive the stream
        this.#video.srcObject = originalStream
        this.#video.muted = true
        this.#video.playsInline = true
        this.#video.play()

        if (!this.#canvasCtx) {
            console.error('Failed to get canvas context')
            return originalStream
        }

        // Get cropped video stream from canvas
        const canvasStream = this.#canvas.captureStream(frameRate)

        // Combine cropped video with original audio
        const audioTracks = originalStream.getAudioTracks()

        return new MediaStream([
            ...canvasStream.getVideoTracks(),
            ...audioTracks,
        ])
    }

    public start() {
        if (this.#intervalId !== null) return
        // workaround: requestAnimationFrame is not works in offscreen.
        this.#intervalId = setInterval(this.render.bind(this), this.#interval)
    }

    public stop() {
        if (this.#intervalId) {
            clearInterval(this.#intervalId)
            this.#intervalId = null
        }
        this.#videoTrack = null
        this.#video.srcObject = null
    }

    private render() {
        try {
            if (this.region == null || this.#video == null || this.#canvasCtx == null) return
            const { x, y, width, height } = this.region

            // Update canvas size if crop region changed
            if (this.#canvas.width !== width || this.#canvas.height !== height) {
                this.#canvas.setAttribute('width', width.toString())
                this.#canvas.setAttribute('height', height.toString())
            }

            // Draw cropped region
            this.#canvasCtx.drawImage(
                this.#video,
                x, y, width, height,  // source rectangle
                0, 0, width, height   // destination rectangle
            )
        } catch (e) {
            console.error('Cropping draw error:', e)
            // Continue on error
        }
        if (this.#videoTrack?.readyState !== 'live') return
    }
}
