import { Settings } from './element/settings'
import type {
    Message,
    StartRecordingResponse,
    TabTrackEndedMessage,
    PreviewFrameMessage,
    UnexpectedRecordingStateMessage,
    RecordingTickMessage,
} from './message'
import { flush, sendEvent, sendException } from './sentry'
import { Preview } from './preview'
import { Crop } from './crop'
import { createRecordingSession, type RecordingSession } from './recorder'

const preview = new Preview(async ({ image, width, height }) => {
    const msg: PreviewFrameMessage = {
        type: 'preview-frame',
        recordingSize: { width, height },
        image: (new Uint8Array(await image.arrayBuffer())).toBase64(),
    }
    await chrome.runtime.sendMessage(msg)
})
const crop = new Crop()

const session: RecordingSession = createRecordingSession(preview, crop, {
    onTabTrackEnded: async () => {
        try {
            const msg: TabTrackEndedMessage = { type: 'tab-track-ended' }
            await chrome.runtime.sendMessage(msg)
        } catch (e) {
            console.error(e)
            sendException(e, { exceptionSource: 'tabTrack.ended' })
        }
    },
    onSourceError: async (e: Error) => {
        sendException(e, { exceptionSource: 'offscreen.startRecording' })
        const msg: UnexpectedRecordingStateMessage = { type: 'unexpected-recording-state', error: e.message }
        try {
            await chrome.runtime.sendMessage(msg)
        } catch (sendErr) {
            console.error(sendErr)
            sendException(sendErr, { exceptionSource: 'offscreen.startRecording.sendMessage' })
        }
    },
    onTick: async () => {
        const tickMsg: RecordingTickMessage = { type: 'recording-tick' }
        await chrome.runtime.sendMessage(tickMsg)
    },
})

chrome.runtime.onMessage.addListener((message: Message, sender: chrome.runtime.MessageSender, sendResponse: (response?: StartRecordingResponse) => void) => {
    (async () => {
        let response: StartRecordingResponse | undefined
        try {
            switch (message.type) {
                case 'start-recording': {
                    const { videoFormat, recordingSize } = Settings.getRecordingInfo(message.data.tabSize)
                    const config = Settings.getConfiguration()

                    // Check OPFS persistence
                    const opfsPersisted = await navigator.storage.persisted()
                    if (!opfsPersisted) {
                        console.warn('OPFS persist: permission denied')
                    }
                    sendEvent({
                        type: 'start_recording',
                        tags: {
                            trigger: message.trigger,
                            state: { opfsPersisted },
                        },
                    })

                    response = await session.start(message.data, {
                        videoFormat,
                        recordingSize,
                        microphone: config.microphone,
                        cropping: config.cropping,
                        muteRecordingTab: config.muteRecordingTab,
                        audioSeparation: config.audioSeparation,
                    })

                    // ref. https://github.com/GoogleChrome/chrome-extensions-samples/blob/137cf71b9b4d631191cedbf96343d5b6a51c9a74/functional-samples/sample.tabcapture-recorder/offscreen.js#L71-L77
                    window.location.hash = 'recording'
                    return
                }
                case 'stop-recording': {
                    try {
                        const result = await session.stop()
                        if (result) {
                            sendEvent({
                                type: 'stop_recording',
                                metrics: {
                                    trigger: message.trigger,
                                    recording: {
                                        durationSec: result.durationMs / 1000,
                                        filesize: result.fileSize,
                                    },
                                },
                            })
                        }
                    } catch (e) {
                        console.error(e)
                        sendException(e, { exceptionSource: 'offscreen.stopRecording' })
                    } finally {
                        window.location.hash = ''
                    }
                    await flush()
                    return
                }
                case 'cancel-recording': {
                    try {
                        const durationMs = await session.cancel()
                        sendEvent({
                            type: 'unexpected_stop',
                            metrics: {
                                recording: {
                                    durationSec: durationMs / 1000,
                                },
                            },
                        })
                    } catch (e) {
                        console.error(e)
                        sendException(e, { exceptionSource: 'offscreen.cancelRecording' })
                    } finally {
                        window.location.hash = ''
                    }
                    await flush()
                    return
                }
                case 'save-config-local':
                    Settings.mergeRemoteConfiguration(message.data)
                    await flush()
                    return
                case 'exception':
                    throw message.data
                case 'preview-control':
                    if (message.action === 'start') {
                        session.startPreview()
                    } else {
                        session.stopPreview()
                    }
                    return
                case 'update-crop-region':
                    session.updateCropRegion(message.region)
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
