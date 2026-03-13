import { v7 as uuidv7 } from 'uuid'

import type { getMediaStreamId } from './type'
import type {
    Message,
    Trigger,
    StartTrigger,
    StartRecordingMessage,
    StopRecordingMessage,
    SaveConfigLocalMessage,
    ExceptionMessage,
    RecordingStateMessage,
} from './message'
import { Configuration, Resolution } from './configuration'
import { ExtensionSyncStorage } from './storage'
import { deepMerge } from './element/util'
import { OPFSStorage } from './opfs_storage'
import { handleApiRequest, RecordingState } from './handler'

const recordingIcon = '/icons/recording.png'
const recordingVideoOnlyIcon = '/icons/recording-video-only.png'
const recordingAudioOnlyIcon = '/icons/recording-audio-only.png'
const notRecordingIcon = '/icons/not-recording.png'
const storage = new ExtensionSyncStorage()

const CONTEXT_MENU_ID = 'start-recording'

chrome.runtime.onInstalled.addListener(async () => {
    await createOffscreenDocument()

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
    Configuration.migrate(config, remoteConfig as unknown as Record<string, unknown>)
    await storage.set(Configuration.key, config)
    console.debug('config:', config)

    const msg: SaveConfigLocalMessage = {
        type: 'save-config-local',
        data: config as Configuration,
    }
    await chrome.runtime.sendMessage(msg)

    await chrome.offscreen.closeDocument()

    // Create context menu for starting recording
    chrome.contextMenus.create({
        id: CONTEXT_MENU_ID,
        title: 'Start Recording',
        contexts: ['page'],
    })
})

async function getOffscreenDocument(): Promise<chrome.runtime.ExtensionContext | undefined> {
    const existingContexts = await chrome.runtime.getContexts({})
    return existingContexts.find(c => c.contextType === 'OFFSCREEN_DOCUMENT')
}

async function createOffscreenDocument() {
    const offscreenDocument = await getOffscreenDocument()
    if (offscreenDocument) return

    // If an offscreen document is not already open, create one.
    await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: [chrome.offscreen.Reason.USER_MEDIA],
        justification: 'Recording from chrome.tabCapture API'
    })
}

async function getIsRecording(): Promise<boolean> {
    const offscreenDocument = await getOffscreenDocument()
    return offscreenDocument?.documentUrl?.endsWith('#recording') ?? false
}

// Persistent recording state
const recordingStateKey = 'recordingState'
async function getRecordingState(): Promise<RecordingState> {
    const isRecording = await getIsRecording()
    if (!isRecording) return { isRecording }

    const recordingState = (await chrome.storage.local.get(recordingStateKey))[recordingStateKey]
    if (!recordingState) return { isRecording }

    return { ...recordingState, isRecording }
}
async function setRecordingState(state: RecordingState) {
    await chrome.storage.local.set({ [recordingStateKey]: state })
}

// Action icon handler
chrome.action.onClicked.addListener(async (tab: chrome.tabs.Tab) => {
    const trigger = 'action-icon'
    try {
        if (await getIsRecording()) {
            await stopRecording(trigger)
            return
        }
        await startRecording(tab, trigger)
    } catch (e) {
        console.error(e)
        const msg: ExceptionMessage = {
            type: 'exception',
            data: e,
        }
        await chrome.runtime.sendMessage(msg)
    }
})

// Context menu click handler
chrome.contextMenus.onClicked.addListener(async (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => {
    if (info.menuItemId !== CONTEXT_MENU_ID || !tab) return
    const trigger = 'context-menu'
    try {
        if (await getIsRecording()) {
            await stopRecording(trigger)
            return
        }
        await startRecording(tab, trigger)
    } catch (e) {
        console.error(e)
        const msg: ExceptionMessage = {
            type: 'exception',
            data: e,
        }
        await chrome.runtime.sendMessage(msg)
    }
})

// Keyboard shortcut handler
chrome.commands.onCommand.addListener(async (command: string, tab?: chrome.tabs.Tab) => {
    const trigger = 'keyboard-shortcut'
    try {
        switch (command) {
            case 'start-recording': {
                if (!tab) return
                if (await getIsRecording()) return
                await startRecording(tab, trigger)
                break
            }
            case 'stop-recording': {
                if (!(await getIsRecording())) return
                await stopRecording(trigger)
                break
            }
            case 'toggle-recording': {
                if (await getIsRecording()) {
                    await stopRecording(trigger)
                    return
                }
                if (!tab) return
                await startRecording(tab, trigger)
                break
            }
            case 'open-option-page': {
                await chrome.runtime.openOptionsPage()
                break
            }
        }
    } catch (e) {
        console.error(e)
        const msg: ExceptionMessage = {
            type: 'exception',
            data: e,
        }
        await chrome.runtime.sendMessage(msg)
    }
})

async function startRecording(tab: chrome.tabs.Tab, trigger: StartTrigger) {
    await createOffscreenDocument()

    // Get a MediaStream for the active tab.
    const streamId = await (chrome.tabCapture.getMediaStreamId as typeof getMediaStreamId)({
        targetTabId: tab.id
    })

    // Track screen size for preview functionality
    const screenSize = { width: tab.width ?? 0, height: tab.height ?? 0 }
    const startAtMs = Date.now()
    await setRecordingState({
        isRecording: true,
        startAtMs,
        screenSize,
    })

    // Send the stream ID to the offscreen document to start recording.
    const msg: StartRecordingMessage = {
        type: 'start-recording',
        trigger,
        data: {
            startAtMs: startAtMs,
            tabSize: screenSize,
            streamId,
        },
    }
    await chrome.runtime.sendMessage(msg)

    // Update recording state and broadcast to option pages
    await broadcastRecordingState()

    // Update context menu title
    await updateContextMenuTitle()
}

async function stopRecording(trigger: Trigger) {
    // Send stop-recording message to offscreen document
    const msg: StopRecordingMessage = {
        type: 'stop-recording',
        trigger,
    }
    await chrome.runtime.sendMessage(msg)

    // Update action icon
    await chrome.action.setIcon({ path: notRecordingIcon })

    await broadcastRecordingState()

    // Update context menu title
    await updateContextMenuTitle()

    // Open option page if need
    const config = await getConfiguration()
    if (config.openOptionPage) await chrome.runtime.openOptionsPage()

    // Close offscreen document
    await chrome.offscreen.closeDocument()
}

// Update context menu title based on recording state
async function updateContextMenuTitle() {
    try {
        await chrome.contextMenus.update(CONTEXT_MENU_ID, {
            title: (await getIsRecording()) ? 'Stop Recording' : 'Start Recording',
        })
    } catch (e) {
        console.error('Failed to update context menu:', e)
    }
}

// Broadcast recording state to all option pages
async function broadcastRecordingState() {
    const { screenSize } = await getRecordingState()
    const msg: RecordingStateMessage = {
        type: 'recording-state',
        isRecording: await getIsRecording(),
        screenSize,
    }
    try {
        await chrome.runtime.sendMessage(msg)
    } catch (e) {
        console.error('Failed to send recording state:', e)
    }
}

chrome.runtime.onMessage.addListener((message: Message, sender: chrome.runtime.MessageSender, sendResponse: (response?: Configuration) => void) => {
    (async () => {
        try {
            switch (message.type) {
                case 'resize-window':
                    if (typeof message.data !== 'object' || message.data == null) return
                    await resizeWindow(message.data)
                    return
                case 'update-recording-icon':
                    let path = recordingIcon
                    switch (message.icon) {
                        case 'video-only':
                            path = recordingVideoOnlyIcon
                            break
                        case 'audio-only':
                            path = recordingAudioOnlyIcon
                            break
                    }
                    await chrome.action.setIcon({ path })
                    return
                case 'tab-track-ended':
                    // Fire-and-forget: stopRecording closes the Offscreen Document,
                    // so it must not be awaited inside the message listener.
                    stopRecording('tab-track-ended').catch(async e => {
                        console.error(e)
                        const msg: ExceptionMessage = {
                            type: 'exception',
                            data: e,
                        }
                        await chrome.runtime.sendMessage(msg)
                    })
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
                case 'request-recording-state':
                    // Respond with current recording state
                    await broadcastRecordingState()
                    return
            }
        } catch (e) {
            console.error(e)
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

// ============================================================================
// REST API for Recording Storage
// ============================================================================

const recordingStorage = new OPFSStorage()
const API_PREFIX = '/api/'

// Fetch event listener for REST API
// Using type assertion since Service Worker global scope supports 'fetch' event
declare const self: ServiceWorkerGlobalScope
self.addEventListener('fetch', (event: FetchEvent) => {
    const url = new URL(event.request.url)

    // Only intercept /api/* requests from the same origin
    if (url.origin === location.origin && url.pathname.startsWith(API_PREFIX)) {
        event.respondWith((async () => {
            return handleApiRequest(event.request, recordingStorage, await getRecordingState())
        })())
    }
})
