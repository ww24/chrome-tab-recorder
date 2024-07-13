import { v7 as uuidv7 } from 'uuid'

import type { getMediaStreamId } from './type'
import type { Message, StartRecordingMessage, StopRecordingMessage, SaveConfigLocalMessage, ExceptionMessage } from './message'
import { Configuration, Resolution } from './configuration'
import { ExtensionSyncStorage } from './storage'
import { deepMerge } from './element/util'

const recordingIcon = '/icons/recording.png'
const notRecordingIcon = '/icons/not-recording.png'
const storage = new ExtensionSyncStorage()

chrome.runtime.onInstalled.addListener(async () => {
    await getOrCreateOffscreenDocument()

    const defaultConfig = new Configuration()
    const remoteConfig = await getRemoteConfiguration()
    // for backward compatibility
    if (remoteConfig != null && remoteConfig.screenRecordingSize.auto != true) {
        remoteConfig.screenRecordingSize.auto = false
    }
    const config = remoteConfig == null ? defaultConfig : deepMerge(defaultConfig, remoteConfig)
    if (config.userId === '') {
        config.userId = uuidv7()
    }
    await storage.set(Configuration.key, config)
    console.debug('config:', config)

    const msg: SaveConfigLocalMessage = {
        type: 'save-config-local',
        data: config as Configuration,
    }
    await chrome.runtime.sendMessage(msg)
})

async function getOrCreateOffscreenDocument(): Promise<boolean> {
    const existingContexts = await chrome.runtime.getContexts({})
    const offscreenDocument = existingContexts.find(
        c => c.contextType === 'OFFSCREEN_DOCUMENT'
    )

    // If an offscreen document is not already open, create one.
    let recording = false
    if (!offscreenDocument) {
        await chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: [chrome.offscreen.Reason.USER_MEDIA],
            justification: 'Recording from chrome.tabCapture API'
        })
    } else {
        recording = (offscreenDocument.documentUrl?.endsWith('#recording') ?? false)
    }
    return recording
}

chrome.action.onClicked.addListener(async (tab: chrome.tabs.Tab) => {
    try {
        const recording = await getOrCreateOffscreenDocument()
        if (recording) {
            await stopRecording()
            return
        }
        await startRecording(tab)
    } catch (e) {
        const msg: ExceptionMessage = {
            type: 'exception',
            data: e,
        }
        await chrome.runtime.sendMessage(msg)
    }
})

async function startRecording(tab: chrome.tabs.Tab) {
    // Get a MediaStream for the active tab.
    const streamId = await (chrome.tabCapture.getMediaStreamId as typeof getMediaStreamId)({
        targetTabId: tab.id
    })

    // Send the stream ID to the offscreen document to start recording.
    const msg: StartRecordingMessage = {
        type: 'start-recording',
        data: {
            tabSize: { width: tab.width ?? 0, height: tab.height ?? 0 },
            streamId,
        },
    }
    await chrome.runtime.sendMessage(msg)

    await chrome.action.setIcon({ path: recordingIcon })
}

async function stopRecording() {
    const msg: StopRecordingMessage = {
        type: 'stop-recording',
    }
    await chrome.runtime.sendMessage(msg)
    await chrome.action.setIcon({ path: notRecordingIcon })

    const config = await getConfiguration()
    if (config.openOptionPage) await chrome.runtime.openOptionsPage()
}

chrome.runtime.onMessage.addListener((message: Message, sender: chrome.runtime.MessageSender, sendResponse: (response?: Configuration) => void) => {
    (async () => {
        try {
            switch (message.type) {
                case 'resize-window':
                    if (typeof message.data !== 'object' || message.data == null) return
                    await resizeWindow(message.data)
                    return
                case 'complete-recording':
                    await chrome.action.setIcon({ path: notRecordingIcon })
                    return
                case 'save-config-sync':
                    await storage.set(Configuration.key, message.data)
                    return
                case 'fetch-config':
                    const defaultConfig = new Configuration()
                    const remoteConfig = await getRemoteConfiguration()
                    if (remoteConfig == null) return
                    const config = deepMerge(defaultConfig, remoteConfig)
                    console.debug('fetch:', config)
                    sendResponse(config)
                    return
            }
        } catch (e) {
            const msg: ExceptionMessage = {
                type: 'exception',
                data: e,
            }
            await chrome.runtime.sendMessage(msg)
        } finally {
            sendResponse()
        }
    })()
    return true // asynchronous flag
})

async function resizeWindow({ width, height }: Resolution) {
    const window = await chrome.windows.getCurrent()
    if (window.id == null) return
    const updateInfo: chrome.windows.UpdateInfo = {
        width,
        height,
        state: 'normal',
    }
    await chrome.windows.update(window.id, updateInfo)
}

async function getRemoteConfiguration(): Promise<Configuration | null> {
    return (await storage.get(Configuration.key)) as Configuration | null
}

async function getConfiguration(): Promise<Configuration> {
    const defaultConfig = new Configuration()
    const remoteConfig = await getRemoteConfiguration()
    return remoteConfig == null ? defaultConfig : deepMerge(defaultConfig, remoteConfig)
}

// remote configuration change log
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'sync' || changes[Configuration.key] == null) return
    const { newValue } = changes[Configuration.key]
    console.log('updated:', newValue)
})
