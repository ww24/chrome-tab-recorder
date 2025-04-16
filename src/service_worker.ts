import { v7 as uuidv7 } from 'uuid'

import type { getMediaStreamId } from './type'
import type { Message, StartRecordingMessage, StopRecordingMessage, SaveConfigLocalMessage, ExceptionMessage } from './message'
import { Configuration, Resolution } from './configuration'
import { ExtensionSyncStorage } from './storage'
import { deepMerge } from './element/util'

const recordingIcon = '/icons/recording.png'
const recordingVideoOnlyIcon = '/icons/recording-video-only.png'
const recordingAudioOnlyIcon = '/icons/recording-audio-only.png'
const notRecordingIcon = '/icons/not-recording.png'
const storage = new ExtensionSyncStorage()

// Add a Map to track all recording tasks
const recordingTasks = new Map<string, number>(); // taskId -> tabId

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

    await chrome.offscreen.closeDocument()
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
        // Check if the current tab is already being recorded
        if (tab.id && Array.from(recordingTasks.values()).includes(tab.id)) {
            // If the current tab is being recorded, stop this specific tab's recording
            const taskId = Array.from(recordingTasks.entries())
                .find(([_, tabId]) => tabId === tab.id)?.[0];
            
            if (taskId) {
                await stopRecording(taskId);
                return;
            }
        }
        
        // Start a new recording, regardless of whether other recording tasks are in progress
        await getOrCreateOffscreenDocument()
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
    if (!tab.id) {
        throw new Error('Tab ID is undefined.')
    }
    
    // Generate unique task ID
    const taskId = uuidv7();
    
    // Get media stream ID
    const streamId = await (chrome.tabCapture.getMediaStreamId as typeof getMediaStreamId)({
        targetTabId: tab.id
    })

    // Add task to tracking list
    recordingTasks.set(taskId, tab.id);
    
    // Send start recording message to offscreen page
    const msg: StartRecordingMessage = {
        type: 'start-recording',
        taskId,
        data: {
            tabSize: { width: tab.width ?? 0, height: tab.height ?? 0 },
            streamId,
            tabId: tab.id
        },
    }
    await chrome.runtime.sendMessage(msg)
    
    console.log(`Started recording task ${taskId} for tab ${tab.id}`);
}

async function stopRecording(taskId?: string) {
    if (!taskId) {
        // If no taskId specified, stop all recordings
        const allTaskIds = Array.from(recordingTasks.keys());
        for (const id of allTaskIds) {
            await stopRecordingTask(id);
        }
        return;
    }
    
    await stopRecordingTask(taskId);
}

async function stopRecordingTask(taskId: string) {
    const tabId = recordingTasks.get(taskId);
    if (!tabId) {
        console.warn(`Task ${taskId} not found in recording tasks.`);
        return;
    }
    
    const msg: StopRecordingMessage = {
        type: 'stop-recording',
        taskId
    }
    await chrome.runtime.sendMessage(msg)
    
    // If all tasks have stopped, update the icon
    if (recordingTasks.size === 0) {
        await chrome.action.setIcon({ path: notRecordingIcon })
    }
    
    console.log(`Stopped recording task ${taskId} for tab ${tabId}`);
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
                case 'complete-recording':
                    // Remove completed task from task list
                    if (message.taskId) {
                        recordingTasks.delete(message.taskId);
                        console.log(`Removed completed task ${message.taskId}, remaining tasks: ${recordingTasks.size}`);
                    }
                    
                    // Only close the offscreen document when all tasks are completed
                    if (recordingTasks.size === 0) {
                        await chrome.action.setIcon({ path: notRecordingIcon })
                        await chrome.offscreen.closeDocument()
                    }
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
