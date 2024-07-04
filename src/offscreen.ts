import { MediaRecorderWebMDurationWorkaround } from './fix_webm_duration'
import { Settings } from './element/settings'
import type { Message, BackgroundStopRecordingMessage, StartRecording } from './message'
import { sendEvent, sendException } from './sentry'

const timeslice = 3000 // 3s

chrome.runtime.onMessage.addListener(async (message: Message) => {
    try {
        if (message.target !== 'offscreen') return
        switch (message.type) {
            case 'start-recording':
                await startRecording(message.data)
                return
            case 'stop-recording':
                await stopRecording()
                return
            case 'sync-config':
                Settings.setConfiguration(message.data)
                return
            case 'exception':
                throw message.data
        }
    } catch (e) {
        sendException(e)
        console.error(e)
    }
})

let recorder: MediaRecorder | undefined

async function startRecording(startRecording: StartRecording) {
    if (recorder?.state === 'recording') {
        throw new Error('Called startRecording while recording is in progress.')
    }

    if (! await navigator.storage.persisted()) {
        console.warn('OPFS persist: permission denied')
    }

    const dirHandle = await navigator.storage.getDirectory()
    const fileBaseName = `video-${Date.now()}`
    const backupFileName = `${fileBaseName}.bk.webm`
    const backupFileHandle = await dirHandle.getFileHandle(backupFileName, { create: true })
    const writableStream = await backupFileHandle.createWritable()

    const size = Settings.getScreenRecordingSize(startRecording.tabSize)
    const media = await navigator.mediaDevices.getUserMedia({
        audio: {
            mandatory: {
                chromeMediaSource: 'tab',
                chromeMediaSourceId: startRecording.streamId,
            }
        },
        video: {
            mandatory: {
                chromeMediaSource: 'tab',
                chromeMediaSourceId: startRecording.streamId,
                maxWidth: size.width,
                maxHeight: size.height,
                minFrameRate: 30,
            }
        }
    })

    // Continue to play the captured audio to the user.
    const output = new AudioContext()
    const source = output.createMediaStreamSource(media)
    source.connect(output.destination)

    const videoFormat = Settings.getVideoFormat()
    if (!MediaRecorder.isTypeSupported(videoFormat.mimeType)) {
        throw new Error('unsupported MIME type: ' + videoFormat.mimeType)
    }

    // Start recording.
    recorder = new MediaRecorder(media, {
        mimeType: videoFormat.mimeType,
        audioBitsPerSecond: videoFormat.audioBitrate,
        videoBitsPerSecond: videoFormat.videoBitrate,
    })
    const fixWebM = new MediaRecorderWebMDurationWorkaround()
    recorder.addEventListener('dataavailable', async event => {
        try {
            await writableStream.write(event.data)
            await fixWebM.write(event.data)
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
                    recordingResolution: `${size.width}x${size.height}`,
                },
                metrics: {
                    duration: duration / 1000,
                },
            })

            await writableStream.close()

            // workaround: fix video duration
            fixWebM.close()
            const fixWebMDuration = fixWebM.duration()
            console.debug(`fixWebM: duration=${fixWebMDuration / 1000}s`)

            const fixedFileHandle = await dirHandle.getFileHandle(`${fileBaseName}.webm`, { create: true })
            const fixedWritableStream = await fixedFileHandle.createWritable()
            const file = await backupFileHandle.getFile()
            const fixed = fixWebM.fixMetadata(file)

            try {
                await fixed.stream().pipeTo(fixedWritableStream)
                if (fixed.size >= file.size && Math.abs(duration - fixWebMDuration) < 5000) {
                    await dirHandle.removeEntry(backupFileName)
                }
            } catch (e) {
                await fixedWritableStream.close()
                throw e
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
            const msg: BackgroundStopRecordingMessage = {
                target: 'background',
                type: 'stop-recording',
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
