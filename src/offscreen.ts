import {
    Output,
    StreamTarget,
    MediaStreamVideoTrackSource,
    MediaStreamAudioTrackSource,
} from 'mediabunny'
import { Configuration, resolveBitrate, createOutputFormat, hasVideo, hasAudio, containerExtension } from './configuration'
import { Settings } from './element/settings'
import type {
    Message,
    Trigger,
    StartTrigger,
    StartRecording,
    StartRecordingResponse,
    TabTrackEndedMessage,
    PreviewFrameMessage,
    PreviewControlMessage,
    UpdateCropRegionMessage,
    UnexpectedRecordingStateMessage,
    RecordingTickMessage,
} from './message'
import { flush, sendEvent, sendException } from './sentry'
import { Preview } from './preview'
import { Crop } from './crop'

const preview = new Preview(async ({ image, width, height }) => {
    // Send preview frame
    const msg: PreviewFrameMessage = {
        type: 'preview-frame',
        recordingSize: { width, height },
        image: (new Uint8Array(await image.arrayBuffer())).toBase64(),
    }
    await chrome.runtime.sendMessage(msg)
})
const crop = new Crop()

chrome.runtime.onMessage.addListener((message: Message, sender: chrome.runtime.MessageSender, sendResponse: (response?: StartRecordingResponse) => void) => {
    (async () => {
        let response: StartRecordingResponse | undefined
        try {
            switch (message.type) {
                case 'start-recording':
                    response = await startRecording(message.trigger, message.data)
                    return
                case 'stop-recording':
                    await stopRecording(message.trigger)
                    await flush()
                    return
                case 'cancel-recording':
                    await cancelRecording()
                    await flush()
                    return
                case 'save-config-local':
                    Settings.mergeRemoteConfiguration(message.data)
                    await flush()
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
            console.error(e)
            sendException(e, {
                exceptionSource: 'offscreen.onMessage',
                additionalMetadata: { messageType: message.type },
            })
        } finally {
            sendResponse(response)
        }
    })()
    return true // asynchronous flag
})

let output: Output | undefined
let currentMediaTracks: MediaStreamTrack[] = []
let recordingStartTime = 0
let recordingFileHandle: FileSystemFileHandle | undefined
let recordingTickTimerId: ReturnType<typeof setInterval> | undefined
const getAudioContext = (() => {
    let audioCtx: AudioContext | undefined
    return (sampleRate: number): AudioContext => {
        if (audioCtx == null) {
            audioCtx = sampleRate > 0 ? new AudioContext({ sampleRate }) : new AudioContext()
        }
        return audioCtx
    }
})()

// Cropping and preview state
let currentVideoTrack: MediaStreamTrack | null = null

function createMixedMediaStream(tabStream: MediaStream, micStream: MediaStream | null, micGain: number, audioSampleRate: number): MediaStream {
    const audioCtx = getAudioContext(audioSampleRate)

    if (!micStream) {
        // No microphone — if custom sample rate is requested, resample via AudioContext
        if (audioSampleRate > 0 && tabStream.getAudioTracks().length > 0) {
            const dest = audioCtx.createMediaStreamDestination()
            const src = audioCtx.createMediaStreamSource(new MediaStream(tabStream.getAudioTracks()))
            src.connect(dest)

            const [tabTrack] = tabStream.getTracks()
            tabTrack?.addEventListener('ended', () => {
                dest.stream.getAudioTracks().forEach(track => track.stop())
            })

            return new MediaStream([
                ...dest.stream.getAudioTracks(),
                ...tabStream.getVideoTracks(),
            ])
        }
        return tabStream
    }

    const mixedOutput = audioCtx.createMediaStreamDestination()

    // Tab audio (if exists)
    const tabAudioTracks = tabStream.getAudioTracks()
    if (tabAudioTracks.length > 0) {
        const tabAudioSource = audioCtx.createMediaStreamSource(new MediaStream(tabAudioTracks))
        tabAudioSource.connect(mixedOutput)
    }

    // Handle source ended event
    const [tabTrack] = tabStream.getTracks()
    tabTrack?.addEventListener('ended', () => {
        mixedOutput.stream.getAudioTracks().forEach(track => track.stop())
    })

    // Microphone audio
    const micAudioSource = audioCtx.createMediaStreamSource(micStream)
    const micGainNode = audioCtx.createGain()
    micGainNode.gain.value = micGain
    micAudioSource.connect(micGainNode)
    micGainNode.connect(mixedOutput)

    // Combine mixed audio with video tracks
    const finalStream = new MediaStream([
        ...mixedOutput.stream.getAudioTracks(),
        ...tabStream.getVideoTracks()
    ])

    return finalStream
}

async function startRecording(trigger: StartTrigger, startRecording: StartRecording): Promise<StartRecordingResponse> {
    if (output?.state === 'started') {
        throw new Error('Called startRecording while recording is in progress.')
    }

    const startAtMs = Date.now()

    const opfsPersisted = await navigator.storage.persisted()
    if (!opfsPersisted) {
        console.warn('OPFS persist: permission denied')
    }

    sendEvent({
        type: 'start_recording',
        tags: {
            trigger,
            state: {
                opfsPersisted,
            },
        },
    })

    const { videoFormat, recordingSize } = Settings.getRecordingInfo(startRecording.tabSize)

    // Prepare output file
    const dirHandle = await navigator.storage.getDirectory()
    const ext = containerExtension(videoFormat.container)
    const fileName = Configuration.filename(startAtMs, ext)
    recordingFileHandle = await dirHandle.getFileHandle(fileName, { create: true })
    const writableStream = await recordingFileHandle.createWritable()

    // Create output with StreamTarget
    output = new Output({
        format: createOutputFormat(videoFormat.container),
        target: new StreamTarget(writableStream, { chunked: true }),
    })

    // Capture tab media
    const tabMedia = await navigator.mediaDevices.getUserMedia({
        audio: hasAudio(videoFormat.recordingMode) ? {
            mandatory: {
                chromeMediaSource: 'tab',
                chromeMediaSourceId: startRecording.streamId,
                maxSampleRate: videoFormat.audioSampleRate,
            },
        } : undefined,
        video: hasVideo(videoFormat.recordingMode) ? {
            mandatory: {
                chromeMediaSource: 'tab',
                chromeMediaSourceId: startRecording.streamId,
                maxWidth: recordingSize.width,
                maxHeight: recordingSize.height,
                maxFrameRate: videoFormat.frameRate,
            },
        } : undefined
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
                    sampleRate: videoFormat.audioSampleRate,
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
    let media = createMixedMediaStream(tabMedia, micStream, microphone.gain, videoFormat.audioSampleRate)

    // Store video track for preview
    const videoTracks = tabMedia.getVideoTracks()
    if (videoTracks.length > 0) {
        currentVideoTrack = videoTracks[0]
    }

    // Apply cropping if enabled (video modes only)
    const croppingConfig = Settings.getConfiguration().cropping
    const croppingEnabled = croppingConfig.enabled && hasVideo(videoFormat.recordingMode)
    if (croppingEnabled) {
        media = crop.getCroppedStream(media, croppingConfig.region)
    }

    const muteRecordingTab = Settings.getConfiguration().muteRecordingTab
    if (!muteRecordingTab && tabMedia.getAudioTracks().length > 0) {
        // Continue to play the captured audio to the user.
        const playbackCtx = getAudioContext(videoFormat.audioSampleRate)
        const source = playbackCtx.createMediaStreamSource(tabMedia)
        source.connect(playbackCtx.destination)
    }

    const errorPromises: Promise<void>[] = []

    // Add video track to output
    if (hasVideo(videoFormat.recordingMode)) {
        const mediaVideoTrack = media.getVideoTracks()[0]
        if (mediaVideoTrack) {
            const videoSource = new MediaStreamVideoTrackSource(
                mediaVideoTrack,
                {
                    codec: videoFormat.videoCodec,
                    bitrate: resolveBitrate(videoFormat.videoBitratePreset, videoFormat.videoBitrate),
                    sizeChangeBehavior: 'passThrough',
                },
            )
            output.addVideoTrack(videoSource)
            errorPromises.push(
                videoSource.errorPromise.catch(e => {
                    console.error('Video source error:', e)
                    throw e
                })
            )
        }
    }

    // Add audio track to output
    const hasAudioTrack = hasAudio(videoFormat.recordingMode) || (microphone.enabled && micStream != null)
    if (hasAudioTrack) {
        const mediaAudioTrack = media.getAudioTracks()[0]
        if (mediaAudioTrack) {
            const audioSource = new MediaStreamAudioTrackSource(
                mediaAudioTrack,
                {
                    codec: videoFormat.audioCodec,
                    bitrate: resolveBitrate(videoFormat.audioBitratePreset, videoFormat.audioBitrate),
                },
            )
            output.addAudioTrack(audioSource)
            errorPromises.push(
                audioSource.errorPromise.catch(e => {
                    console.error('Audio source error:', e)
                    throw e
                })
            )
        }
    }

    // Collect all media tracks for cleanup
    currentMediaTracks = [
        ...tabMedia.getTracks(),
        ...(micStream?.getTracks() ?? []),
    ]

    // Handle media source errors
    Promise.race(errorPromises).catch(async e => {
        sendException(e, {
            exceptionSource: 'offscreen.startRecording',
        })
        const errorMessage = e instanceof Error ? e.message : String(e)
        const msg: UnexpectedRecordingStateMessage = { type: 'unexpected-recording-state', error: errorMessage }
        await chrome.runtime.sendMessage(msg)
    }).catch(e => {
        console.error(e)
        sendException(e, { exceptionSource: 'offscreen.startRecording.sendMessage' })
    })

    // Start output
    recordingStartTime = startAtMs
    await output.start()

    // Listen for tab track ending to auto-finalize
    const [tabTrack] = tabMedia.getTracks()
    tabTrack?.addEventListener('ended', async () => {
        console.debug('tabTrack ended, event triggered')
        try {
            const msg: TabTrackEndedMessage = { type: 'tab-track-ended' }
            await chrome.runtime.sendMessage(msg)
        } catch (e) {
            console.error(e)
            sendException(e, { exceptionSource: 'tabTrack.ended' })
        }
    })

    // ref. https://github.com/GoogleChrome/chrome-extensions-samples/blob/137cf71b9b4d631191cedbf96343d5b6a51c9a74/functional-samples/sample.tabcapture-recorder/offscreen.js#L71-L77
    window.location.hash = 'recording'

    // Start periodic tick to keep service worker alive for tooltip updates
    recordingTickTimerId = setInterval(async () => {
        try {
            const tickMsg: RecordingTickMessage = { type: 'recording-tick' }
            await chrome.runtime.sendMessage(tickMsg)
        } catch (e) {
            console.error('Failed to send recording tick:', e)
        }
    }, 60_000)

    return {
        startAtMs,
        recordingMode: videoFormat.recordingMode,
        micEnabled: microphone.enabled && micStream != null,
    }
}

async function stopRecording(trigger: Trigger) {
    if (output == null) {
        window.location.hash = ''
        return
    }
    if (output.state !== 'started') return

    try {
        preview.stop()
        await output.finalize()

        const file = await recordingFileHandle?.getFile()
        const duration = Date.now() - recordingStartTime
        console.info(`stopped: duration=${duration / 1000}s`)

        sendEvent({
            type: 'stop_recording',
            metrics: {
                trigger,
                recording: {
                    durationSec: duration / 1000,
                    filesize: file?.size ?? 0,
                },
            },
        })
    } catch (e) {
        console.error(e)
        sendException(e, { exceptionSource: 'offscreen.stopRecording' })
    } finally {
        cleanupRecordingState()
    }
}

async function cancelRecording() {
    console.warn('cancel recording...')
    try {
        preview.stop()
        await output?.cancel()

        const duration = recordingStartTime > 0 ? Date.now() - recordingStartTime : 0
        console.info(`canceled: duration=${duration / 1000}s`)

        sendEvent({
            type: 'unexpected_stop',
            metrics: {
                recording: {
                    durationSec: duration / 1000,
                },
            },
        })
    } catch (e) {
        console.error(e)
        sendException(e, { exceptionSource: 'offscreen.cancelRecording' })
    } finally {
        cleanupRecordingState()
    }
}

function cleanupRecordingState() {
    if (recordingTickTimerId != null) {
        clearInterval(recordingTickTimerId)
        recordingTickTimerId = undefined
    }
    output = undefined
    recordingStartTime = 0
    recordingFileHandle = undefined
    currentMediaTracks.forEach(t => t.stop())
    currentMediaTracks = []
    currentVideoTrack = null
    window.location.hash = ''
}

// Preview control handler
function handlePreviewControl(message: PreviewControlMessage) {
    if (message.action === 'start' && currentVideoTrack != null) {
        preview.start(currentVideoTrack)
    } else {
        preview.stop()
    }
}

// Crop region update handler
function handleCropRegionUpdate(message: UpdateCropRegionMessage) {
    crop.region = message.region
}
