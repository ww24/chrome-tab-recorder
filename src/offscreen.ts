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
    StartRecording,
    UpdateRecordingIconMessage,
    TabTrackEndedMessage,
    PreviewFrameMessage,
    PreviewControlMessage,
    UpdateCropRegionMessage,
} from './message'
import { sendEvent, sendException } from './sentry'
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
            sendException(e, { exceptionSource: 'offscreen.onMessage' })
            console.error(e)
        } finally {
            sendResponse()
        }
    })()
    return true // asynchronous flag
})

let output: Output | undefined
let currentMediaTracks: MediaStreamTrack[] = []
let recordingStartTime = 0
let recordingFileHandle: FileSystemFileHandle | undefined
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

async function startRecording(startRecording: StartRecording) {
    if (output?.state === 'started') {
        throw new Error('Called startRecording while recording is in progress.')
    }

    const opfsPersisted = await navigator.storage.persisted()
    if (!opfsPersisted) {
        console.warn('OPFS persist: permission denied')
    }

    sendEvent({
        type: 'start_recording',
        tags: {
            state: {
                opfsPersisted,
            },
        },
    })

    const { videoFormat, recordingSize } = Settings.getRecordingInfo(startRecording.tabSize)

    // update recording icon
    const msg: UpdateRecordingIconMessage = {
        type: 'update-recording-icon',
        icon: videoFormat.recordingMode,
    }
    await chrome.runtime.sendMessage(msg)

    // Prepare output file
    const dirHandle = await navigator.storage.getDirectory()
    const ext = containerExtension(videoFormat.container)
    const fileName = Configuration.filename(startRecording.startAtMs, ext)
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
            videoSource.errorPromise.catch(e => {
                sendException(e, { exceptionSource: 'videoSource.error' })
                console.error('Video source error:', e)
            })
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
            audioSource.errorPromise.catch(e => {
                sendException(e, { exceptionSource: 'audioSource.error' })
                console.error('Audio source error:', e)
            })
        }
    }

    // Collect all media tracks for cleanup
    currentMediaTracks = [
        ...tabMedia.getTracks(),
        ...(micStream?.getTracks() ?? []),
    ]

    // Start output
    recordingStartTime = startRecording.startAtMs
    await output.start()

    const outputMimeType = await output.getMimeType()
    console.info('container:', videoFormat.container)
    console.info('mimeType:', outputMimeType)
    console.info('videoCodec:', videoFormat.videoCodec)
    console.info('audioCodec:', videoFormat.audioCodec)
    console.info('videoBitRate:', videoFormat.videoBitrate)
    console.info('audioBitRate:', videoFormat.audioBitrate)
    console.info('audioSampleRate:', videoFormat.audioSampleRate)

    // Listen for tab track ending to auto-finalize
    const [tabTrack] = tabMedia.getTracks()
    tabTrack?.addEventListener('ended', async () => {
        console.debug('tabTrack ended, event triggered')
        try {
            const msg: TabTrackEndedMessage = {
                type: 'tab-track-ended',
            }
            await chrome.runtime.sendMessage(msg)
        } catch (e) {
            sendException(e, { exceptionSource: 'tabTrack.ended' })
            console.error(e)
        }
    })

    // ref. https://github.com/GoogleChrome/chrome-extensions-samples/blob/137cf71b9b4d631191cedbf96343d5b6a51c9a74/functional-samples/sample.tabcapture-recorder/offscreen.js#L71-L77
    window.location.hash = 'recording'
}

async function stopRecording() {
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

        await sendEvent({
            type: 'stop_recording',
            metrics: {
                recording: {
                    durationSec: duration / 1000,
                    filesize: file?.size ?? 0,
                },
            },
        })
    } catch (e) {
        sendException(e, { exceptionSource: 'offscreen.stopRecording' })
        console.error(e)
    } finally {
        output = undefined
        recordingStartTime = 0
        recordingFileHandle = undefined
        currentMediaTracks.forEach(t => t.stop())
        currentMediaTracks = []
        currentVideoTrack = null
        window.location.hash = ''
    }
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
