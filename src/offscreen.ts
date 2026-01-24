import { MediaRecorderWebMDurationWorkaround } from './fix_webm_duration'
import { Settings } from './element/settings'
import type {
    Message,
    StartRecording,
    UpdateRecordingIconMessage,
    CompleteRecordingMessage,
    PreviewFrameMessage,
    PreviewControlMessage,
    UpdateCropRegionMessage,
} from './message'
import { sendEvent, sendException } from './sentry'
import { MIMEType } from './mime'
import { CropRegion } from './configuration'
import { Preview } from './preview'

const timeslice = 3000 // 3s
const CROPPING_INTERVAL = 10 // 10ms

const preview = new Preview(async ({ imageUrl, width, height }) => {
    // Send preview frame
    const msg: PreviewFrameMessage = {
        type: 'preview-frame',
        imageUrl,
        recordingSize: { width, height },
    }
    await chrome.runtime.sendMessage(msg)
})

chrome.runtime.onMessage.addListener((message: Message, sender: chrome.runtime.MessageSender, sendResponse: () => void) => {
    (async () => {
        try {
            switch (message.type) {
                case 'start-recording':
                    await startRecording(message.data)
                    return
                case 'stop-recording':
                    await stopRecording()
                    return
                case 'save-config-local':
                    Settings.mergeRemoteConfiguration(message.data)
                    return
                case 'exception':
                    throw message.data
                case 'preview-control':
                    handlePreviewControl(message)
                    return
                case 'update-crop-region':
                    handleCropRegionUpdate(message)
                    return
            }
        } catch (e) {
            sendException(e)
            console.error(e)
        } finally {
            sendResponse()
        }
    })()
    return true // asynchronous flag
})

let recorder: MediaRecorder | undefined
let _audioContext: AudioContext | undefined
function getAudioContext(): AudioContext {
    if (_audioContext == null) {
        _audioContext = new AudioContext()
    }
    return _audioContext
}

// Cropping and preview state
let currentVideoTrack: MediaStreamTrack | null = null
let currentCropRegion: CropRegion | null = null
let croppingEnabled = false

// Canvas for cropping
let croppingCanvas: HTMLCanvasElement | null = null
let croppingCtx: CanvasRenderingContext2D | null = null
let croppingVideo: HTMLVideoElement | null = null
let croppingIntervalId: ReturnType<typeof setInterval> | null = null

function createMixedMediaStream(tabStream: MediaStream, micStream: MediaStream | null, micGain: number): MediaStream {
    if (!micStream) {
        return tabStream
    }

    const mixedOutput = getAudioContext().createMediaStreamDestination()

    // Tab audio (if exists)
    const tabAudioTracks = tabStream.getAudioTracks()
    if (tabAudioTracks.length > 0) {
        const tabAudioSource = getAudioContext().createMediaStreamSource(
            new MediaStream(tabAudioTracks)
        )
        tabAudioSource.connect(mixedOutput)
    }

    // Microphone audio
    const micAudioSource = getAudioContext().createMediaStreamSource(micStream)
    const micGainNode = getAudioContext().createGain()
    micGainNode.gain.value = micGain
    micAudioSource.connect(micGainNode)
    micGainNode.connect(mixedOutput)

    // Combine mixed audio with video tracks
    const videoTracks = tabStream.getVideoTracks()
    const finalStream = new MediaStream([
        ...mixedOutput.stream.getAudioTracks(),
        ...videoTracks
    ])

    return finalStream
}

async function startRecording(startRecording: StartRecording) {
    if (recorder?.state === 'recording') {
        throw new Error('Called startRecording while recording is in progress.')
    }

    if (! await navigator.storage.persisted()) {
        console.warn('OPFS persist: permission denied')
    }

    const { videoFormat, recordingSize } = Settings.getRecordingInfo(startRecording.tabSize)
    if (!MediaRecorder.isTypeSupported(videoFormat.mimeType)) {
        throw new Error('unsupported MIME type: ' + videoFormat.mimeType)
    }
    const mimeType = new MIMEType(videoFormat.mimeType)

    // update recording icon
    const msg: UpdateRecordingIconMessage = {
        type: 'update-recording-icon',
        icon: videoFormat.recordingMode,
    }
    await chrome.runtime.sendMessage(msg)

    const dirHandle = await navigator.storage.getDirectory()
    const fileBaseName = `video-${Date.now()}`
    const backupFileName = `${fileBaseName}.bk${mimeType.extension()}`
    const regularFileName = `${fileBaseName}${mimeType.extension()}`
    const recordFileName = mimeType.is(MIMEType.webm) ? backupFileName : regularFileName
    const recordFileHandle = await dirHandle.getFileHandle(recordFileName, { create: true })
    const writableStream = await recordFileHandle.createWritable()

    const tabMedia = await navigator.mediaDevices.getUserMedia({
        audio: videoFormat.recordingMode === 'video-only' ? undefined : {
            mandatory: {
                chromeMediaSource: 'tab',
                chromeMediaSourceId: startRecording.streamId,
            }
        },
        video: videoFormat.recordingMode === 'audio-only' ? undefined : {
            mandatory: {
                chromeMediaSource: 'tab',
                chromeMediaSourceId: startRecording.streamId,
                maxWidth: recordingSize.width,
                maxHeight: recordingSize.height,
                maxFrameRate: videoFormat.frameRate,
            },
        }
    })

    // Get microphone stream if enabled
    const microphone = Settings.getConfiguration().microphone
    let micStream: MediaStream | null = null

    if (microphone.enabled) {
        try {
            const constraints: MediaStreamConstraints = {
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: false,
                    ...(microphone.deviceId && microphone.deviceId !== 'default'
                        ? { deviceId: { exact: microphone.deviceId } }
                        : {})
                }
            }
            micStream = await navigator.mediaDevices.getUserMedia(constraints)
        } catch (e) {
            console.warn('Microphone access denied:', e)
        }
    }

    // Mix audio streams if microphone is available
    let media = createMixedMediaStream(tabMedia, micStream, microphone.gain)

    // Store video track for preview
    const videoTracks = tabMedia.getVideoTracks()
    if (videoTracks.length > 0) {
        currentVideoTrack = videoTracks[0]
    }

    // Apply cropping if enabled (video modes only)
    const croppingConfig = Settings.getConfiguration().cropping
    croppingEnabled = croppingConfig.enabled && videoFormat.recordingMode !== 'audio-only'
    if (croppingEnabled) {
        currentCropRegion = croppingConfig.region
        media = createCroppedMediaStream(media, croppingConfig.region, videoFormat.frameRate)
    }

    const muteRecordingTab = Settings.getConfiguration().muteRecordingTab
    if (!muteRecordingTab && tabMedia.getAudioTracks().length > 0) {
        // Continue to play the captured audio to the user.
        const source = getAudioContext().createMediaStreamSource(tabMedia)
        source.connect(getAudioContext().destination)
    }

    // Start recording.
    const hasAudio = videoFormat.recordingMode !== 'video-only' || (microphone.enabled && micStream != null)
    recorder = new MediaRecorder(media, {
        mimeType: videoFormat.mimeType,
        audioBitsPerSecond: hasAudio ? videoFormat.audioBitrate : undefined,
        videoBitsPerSecond: videoFormat.recordingMode === 'audio-only' ? undefined : videoFormat.videoBitrate,
    })

    let fixWebM: MediaRecorderWebMDurationWorkaround | undefined
    if (mimeType.is(MIMEType.webm)) {
        fixWebM = new MediaRecorderWebMDurationWorkaround()
    }
    recorder.addEventListener('dataavailable', async event => {
        try {
            await writableStream.write(event.data)
            if (fixWebM != null) {
                await fixWebM.write(event.data)
            }
        } catch (e) {
            sendException(e)
            console.error(e)
        }
    })
    const startTime = Date.now()
    recorder.addEventListener('stop', async () => {
        const duration = Date.now() - startTime
        console.log(`stopped: duration=${duration / 1000}s`)

        try {
            if (media.active) {
                console.log('recorder: unexpected stop, retrying')
                recorder?.start(timeslice)
                return
            }

            sendEvent({
                type: 'stop_recording',
                tags: {
                    mimeType: recorder?.mimeType,
                    videoBitRate: recorder?.videoBitsPerSecond,
                    audioBitRate: recorder?.audioBitsPerSecond,
                    recordingResolution: `${recordingSize.width}x${recordingSize.height}`,
                    recordingMode: videoFormat.recordingMode,
                },
                metrics: {
                    duration: duration / 1000,
                },
            })

            await writableStream.close()

            if (fixWebM != null) {
                // workaround: fix video duration
                fixWebM.close()
                const fixWebMDuration = fixWebM.duration()
                console.debug(`fixWebM: duration=${fixWebMDuration / 1000}s`)

                const fixedFileHandle = await dirHandle.getFileHandle(regularFileName, { create: true })
                const fixedWritableStream = await fixedFileHandle.createWritable()
                const file = await recordFileHandle.getFile()
                const fixed = fixWebM.fixMetadata(file)

                try {
                    await fixed.stream().pipeTo(fixedWritableStream)
                    if (fixed.size >= file.size && Math.abs(duration - fixWebMDuration) < 5000) {
                        await dirHandle.removeEntry(recordFileName)
                    }
                } catch (e) {
                    await fixedWritableStream.close()
                    throw e
                } finally {
                    fixWebM = undefined
                }
            }
        } catch (e) {
            sendException(e)
            console.error(e)

            try {
                // close backup file writable stream
                await writableStream.close()
            } catch (e) {
                console.error(e)
            }
        } finally {
            recorder = undefined
            window.location.hash = ''
            const msg: CompleteRecordingMessage = {
                type: 'complete-recording',
            }
            await chrome.runtime.sendMessage(msg)
        }
    })
    recorder.start(timeslice)

    console.log('mimeType:', recorder.mimeType)
    console.log('videoBitRate:', recorder.videoBitsPerSecond)
    console.log('audioBitRate:', recorder.audioBitsPerSecond)

    // ref. https://github.com/GoogleChrome/chrome-extensions-samples/blob/137cf71b9b4d631191cedbf96343d5b6a51c9a74/functional-samples/sample.tabcapture-recorder/offscreen.js#L71-L77
    window.location.hash = 'recording'
}

async function stopRecording() {
    if (recorder == null) {
        window.location.hash = ''
        return
    }

    // Stop preview and cropping
    preview.stop()
    stopCroppingLoop()

    recorder.stop()

    // Stopping the tracks makes sure the recording icon in the tab is removed.
    recorder.stream.getTracks().forEach(t => t.stop())

    // Clean up cropping resources
    currentVideoTrack = null

    // Update current state in URL
    window.location.hash = ''
}

// Preview control handler
function handlePreviewControl(message: PreviewControlMessage) {
    if (message.action === 'start' && currentVideoTrack !== null) {
        preview.start(currentVideoTrack)
    } else {
        preview.stop()
    }
}

// Crop region update handler
function handleCropRegionUpdate(message: UpdateCropRegionMessage) {
    currentCropRegion = message.region
}

// Create cropped media stream using Canvas
function createCroppedMediaStream(
    originalStream: MediaStream,
    cropRegion: CropRegion,
    frameRate: number
): MediaStream {
    // Create hidden video element to receive the stream
    croppingVideo = document.createElement('video')
    croppingVideo.srcObject = originalStream
    croppingVideo.muted = true
    croppingVideo.playsInline = true
    croppingVideo.play()

    // Create canvas for cropping
    croppingCanvas = document.createElement('canvas')
    croppingCanvas.width = cropRegion.width
    croppingCanvas.height = cropRegion.height
    croppingCtx = croppingCanvas.getContext('2d', { alpha: false, willReadFrequently: true })

    if (!croppingCtx) {
        console.error('Failed to get canvas context')
        return originalStream
    }

    // Store current crop region for dynamic updates
    currentCropRegion = cropRegion

    // Start drawing loop
    startCroppingLoop()

    // Get cropped video stream from canvas
    const canvasStream = croppingCanvas.captureStream(frameRate)

    // Combine cropped video with original audio
    const audioTracks = originalStream.getAudioTracks()

    return new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...audioTracks,
    ])
}

// Start the cropping draw loop
function startCroppingLoop() {
    if (croppingIntervalId !== null) return
    const drawFrame = () => {
        if (!croppingVideo || !croppingCanvas || !croppingCtx || !currentCropRegion) {
            croppingIntervalId = null
            return
        }

        try {
            const { x, y, width, height } = currentCropRegion

            // Update canvas size if crop region changed
            if (croppingCanvas.width !== width || croppingCanvas.height !== height) {
                croppingCanvas.setAttribute('width', width.toString())
                croppingCanvas.setAttribute('height', height.toString())
            }

            // Draw cropped region
            croppingCtx.drawImage(
                croppingVideo,
                x, y, width, height,  // source rectangle
                0, 0, width, height   // destination rectangle
            )
        } catch (e) {
            console.error('Cropping draw error:', e)
            // Continue on error
        }
        if (currentVideoTrack?.readyState !== 'live') return
    }
    croppingVideo?.addEventListener('loadedmetadata', () => {
        // workaround: requestAnimationFrame is not works in offscreen.
        croppingIntervalId = setInterval(drawFrame, CROPPING_INTERVAL)
    })
}

// Stop the cropping draw loop
function stopCroppingLoop() {
    if (croppingIntervalId !== null) {
        clearInterval(croppingIntervalId)
        croppingIntervalId = null
    }

    if (croppingVideo) {
        croppingVideo.srcObject = null
        croppingVideo = null
    }

    croppingCanvas = null
    croppingCtx = null
}
