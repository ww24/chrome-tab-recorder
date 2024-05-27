import { MediaRecorderWebMDurationWorkaround } from './fix_webm_duration'
import { Settings } from './element/settings'
import type { Message, BackgroundStopRecordingMessage } from './message'
import { getScope, sendEvent } from './sentry'

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
            case 'exception':
                throw message.data
        }
    } catch (e) {
        getScope()?.captureException(e)
        console.error(e)
    }
})

let recorder: MediaRecorder | undefined

async function startRecording(streamId: string) {
    if (recorder?.state === 'recording') {
        throw new Error('Called startRecording while recording is in progress.')
    }

    if (! await navigator.storage.persist()) {
        throw new Error('OPFS persist: permission denied')
    }

    const dirHandle = await navigator.storage.getDirectory()
    const fileBaseName = `video-${Date.now()}`
    const backupFileName = `${fileBaseName}.bk.webm`
    const backupFileHandle = await dirHandle.getFileHandle(backupFileName, { create: true })
    const writableStream = await backupFileHandle.createWritable()

    const size = Settings.getScreenRecordingSize()
    const media = await navigator.mediaDevices.getUserMedia({
        audio: {
            mandatory: {
                chromeMediaSource: 'tab',
                chromeMediaSourceId: streamId,
            }
        },
        video: {
            mandatory: {
                chromeMediaSource: 'tab',
                chromeMediaSourceId: streamId,
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

    const mimeType = 'video/webm;codecs="vp9,opus"'
    if (!MediaRecorder.isTypeSupported(mimeType)) {
        throw new Error('unsupported MIME type: ' + mimeType)
    }

    // Start recording.
    recorder = new MediaRecorder(media, {
        mimeType,
        audioBitsPerSecond: 256 * 1000, // 256Kbps
        videoBitsPerSecond: 8 * size.width * size.height,
    })
    const fixWebM = new MediaRecorderWebMDurationWorkaround()
    recorder.addEventListener('dataavailable', async event => {
        try {
            await writableStream.write(event.data)
            await fixWebM.write(event.data)
        } catch (e) {
            getScope()?.captureException(e)
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
                    duration: duration / 1000,
                    mimeType: recorder?.mimeType,
                    videoBitRate: recorder?.videoBitsPerSecond,
                    audioBitRate: recorder?.audioBitsPerSecond,
                    recordingResolution: `${size.width}x${size.height}`,
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
            getScope()?.captureException(e)
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
                type: 'stop-recording',
                target: 'background',
            }
            await chrome.runtime.sendMessage(msg)
        }
    })
    recorder.start(timeslice)

    console.log('mimeType:', recorder.mimeType)
    console.log('videoBitRate:', recorder.videoBitsPerSecond)
    console.log('audioBitRate:', recorder.audioBitsPerSecond)

    // Record the current state in the URL. This provides a very low-bandwidth
    // way of communicating with the service worker (the service worker can check
    // the URL of the document and see the current recording state). We can't
    // store that directly in the service worker as it may be terminated while
    // recording is in progress. We could write it to storage but that slightly
    // increases the risk of things getting out of sync.
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
