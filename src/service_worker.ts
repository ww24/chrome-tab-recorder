import { v7 as uuidv7 } from 'uuid'

import type { getMediaStreamId } from './type'
import type { Message, OffscreenStartRecordingMessage, OffscreenStopRecordingMessage, OffscreenSyncConfigMessage, OptionSyncConfigMessage, ExceptionMessage } from './message'
import { Configuration, Resolution } from './configuration'
import { ExtensionSyncStorage } from './storage'
import { deepMerge } from './element/util'

const recordingIcon = '/icons/recording.png'
const notRecordingIcon = '/icons/not-recording.png'
const storage = new ExtensionSyncStorage()

chrome.runtime.onInstalled.addListener(async () => {
    await getOrCreateOffscreenDocument()

    const defaultConfig = new Configuration()
    const remoteConfig = (await storage.get(Configuration.key)) as Configuration
    const config = deepMerge(defaultConfig, remoteConfig)
    if (config.userId === '') {
        config.userId = uuidv7()
    }
    console.debug('config:', config)

    const msg: OffscreenSyncConfigMessage = {
        target: 'offscreen',
        type: 'sync-config',
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
            target: 'offscreen',
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
    const msg: OffscreenStartRecordingMessage = {
        target: 'offscreen',
        type: 'start-recording',
        data: streamId,
    }
    await chrome.runtime.sendMessage(msg)

    await chrome.action.setIcon({ path: recordingIcon })
};

async function stopRecording() {
    const msg: OffscreenStopRecordingMessage = {
        target: 'offscreen',
        type: 'stop-recording',
    }
    await chrome.runtime.sendMessage(msg)
    await chrome.action.setIcon({ path: notRecordingIcon })
};

chrome.runtime.onMessage.addListener(async (message: Message) => {
    try {
        if (message.target !== 'background') return
        switch (message.type) {
            case 'resize-window':
                if (typeof message.data !== 'object' || message.data == null) return
                await resizeWindow(message.data)
                return
            case 'stop-recording':
                await chrome.action.setIcon({ path: notRecordingIcon })
                return
            case 'sync-config':
                await storage.set(Configuration.key, message.data)
                return
            case 'fetch-config':
                const data = await storage.get(Configuration.key)
                if (data == null || !(Configuration.key in data)) return
                console.debug('fetch:', data[Configuration.key])
                const msg: OptionSyncConfigMessage = {
                    target: 'option',
                    type: 'sync-config',
                    data: data[Configuration.key] as Configuration,
                }
                await chrome.runtime.sendMessage(msg)
                return
        }
    } catch (e) {
        const msg: ExceptionMessage = {
            target: 'offscreen',
            type: 'exception',
            data: e,
        }
        await chrome.runtime.sendMessage(msg)
    }
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
};

// remote configuration change log
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'sync' || changes[Configuration.key] == null) return
    const { newValue } = changes[Configuration.key]
    console.log('updated:', newValue)
})
