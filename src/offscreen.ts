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
import { Preview } from './preview'
import { Crop } from './crop'

const timeslice = 3000 // 3s

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

    // Handle source ended event
    const [tabTrack] = tabStream.getTracks()
    tabTrack?.addEventListener('ended', () => {
        mixedOutput.stream.getAudioTracks().forEach(track => track.stop())
    })

    // Microphone audio
    const micAudioSource = getAudioContext().createMediaStreamSource(micStream)
    const micGainNode = getAudioContext().createGain()
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
    if (recorder?.state === 'recording') {
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

    // workaround: When a MediaStream from getUserMedia has only one audio track, the stream does not become
    // inactive even after the MediaStreamTrack ends. We manually remove the track to make the stream inactive.
    if (videoFormat.recordingMode === 'audio-only' && !microphone.enabled) {
        const [tabTrack] = tabMedia.getTracks()
        tabTrack?.addEventListener('ended', () => {
            console.debug(`tabTrack.readyState: ${tabTrack.readyState}, tabMedia.active: ${tabMedia.active}`)
            tabMedia.getTracks().forEach(track => tabMedia.removeTrack(track))
            console.debug(`tabMedia.active: ${tabMedia.active}`)
        })
    }

    // Store video track for preview
    const videoTracks = tabMedia.getVideoTracks()
    if (videoTracks.length > 0) {
        currentVideoTrack = videoTracks[0]
    }

    // Apply cropping if enabled (video modes only)
    const croppingConfig = Settings.getConfiguration().cropping
    const croppingEnabled = croppingConfig.enabled && videoFormat.recordingMode !== 'audio-only'
    if (croppingEnabled) {
        media = crop.getCroppedStream(media, croppingConfig.region)
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
            sendException(e, { exceptionSource: 'recorder.dataavailable' })
            console.error(e)
        }
    })
    const startTime = Date.now()
    recorder.addEventListener('stop', async () => {
        const duration = Date.now() - startTime
        console.info(`stopped: duration=${duration / 1000}s`)

        if (media.active) {
            recorder?.start(timeslice)
            sendEvent({
                type: 'unexpected_stop',
                metrics: {
                    recording: {
                        durationSec: duration / 1000,
                    },
                },
            })
            console.warn('recorder: unexpected stop, retrying')
            return
        }
        try {
            await writableStream.close()
            const file = await recordFileHandle.getFile()
            let filesize = file.size;

            if (fixWebM != null) {
                // workaround: fix video duration
                fixWebM.close()
                const fixWebMDuration = fixWebM.duration()
                console.debug(`fixWebM: duration=${fixWebMDuration / 1000}s`)

                const fixedFileHandle = await dirHandle.getFileHandle(regularFileName, { create: true })
                const fixedWritableStream = await fixedFileHandle.createWritable()
                const fixed = fixWebM.fixMetadata(file)

                try {
                    await fixed.stream().pipeTo(fixedWritableStream)
                    if (fixed.size >= file.size && Math.abs(duration - fixWebMDuration) < 5000) {
                        await dirHandle.removeEntry(recordFileName)
                    }
                    filesize = fixed.size
                } catch (e) {
                    await fixedWritableStream.close()
                    throw e
                } finally {
                    fixWebM = undefined
                }
            }

            sendEvent({
                type: 'stop_recording',
                metrics: {
                    recording: {
                        durationSec: duration / 1000,
                        filesize,
                    },
                },
            })
        } catch (e) {
            sendException(e, { exceptionSource: 'recorder.stop' })
            console.error(e)
        } finally {
            recorder = undefined
            window.location.hash = ''
            const msg: CompleteRecordingMessage = {
                type: 'complete-recording',
            }
            await chrome.runtime.sendMessage(msg)
        }
    })
    recorder.addEventListener('error', e => {
        sendException(e, { exceptionSource: 'recorder.error' })
        console.error('recorder error:', e)
    })
    recorder.start(timeslice)

    console.info('mimeType:', recorder.mimeType)
    console.info('videoBitRate:', recorder.videoBitsPerSecond)
    console.info('audioBitRate:', recorder.audioBitsPerSecond)

    // ref. https://github.com/GoogleChrome/chrome-extensions-samples/blob/137cf71b9b4d631191cedbf96343d5b6a51c9a74/functional-samples/sample.tabcapture-recorder/offscreen.js#L71-L77
    window.location.hash = 'recording'
}

async function stopRecording() {
    if (recorder == null) {
        window.location.hash = ''
        return
    }

    // Stop preview, cropping and recorder
    preview.stop()
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
