import { MediaRecorderWebMDurationWorkaround } from './fix_webm_duration'
import { Settings } from './element/settings'
import type { Message, StartRecording, UpdateRecordingIconMessage, CompleteRecordingMessage } from './message'
import { sendEvent, sendException } from './sentry'
import { MIMEType } from './mime'

const timeslice = 3000 // 3s

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
                    Settings.setConfiguration(message.data)
                    return
                case 'exception':
                    throw message.data
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

    const media = await navigator.mediaDevices.getUserMedia({
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

    if (media.getAudioTracks().length > 0) {
        // Continue to play the captured audio to the user.
        const output = new AudioContext()
        const source = output.createMediaStreamSource(media)
        source.connect(output.destination)
    }

    // Start recording.
    recorder = new MediaRecorder(media, {
        mimeType: videoFormat.mimeType,
        audioBitsPerSecond: videoFormat.recordingMode === 'video-only' ? undefined : videoFormat.audioBitrate,
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

    recorder.stop()

    // Stopping the tracks makes sure the recording icon in the tab is removed.
    recorder.stream.getTracks().forEach(t => t.stop())

    // Update current state in URL
    window.location.hash = ''
}
