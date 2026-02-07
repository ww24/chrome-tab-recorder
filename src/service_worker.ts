import { v7 as uuidv7 } from 'uuid'

import type { getMediaStreamId } from './type'
import type {
    Message,
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
import { getMimeTypeFromExtension } from './mime'

const recordingIcon = '/icons/recording.png'
const recordingVideoOnlyIcon = '/icons/recording-video-only.png'
const recordingAudioOnlyIcon = '/icons/recording-audio-only.png'
const notRecordingIcon = '/icons/not-recording.png'
const storage = new ExtensionSyncStorage()

// Track recording state for preview functionality
let isRecording = false
let currentScreenSize: Resolution | null = null

const CONTEXT_MENU_ID = 'start-recording'

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

    // Create context menu for starting recording
    chrome.contextMenus.create({
        id: CONTEXT_MENU_ID,
        title: 'Start Recording',
        contexts: ['page'],
    })
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
            await stopRecording(true)
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

// Context menu click handler
chrome.contextMenus.onClicked.addListener(async (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => {
    if (info.menuItemId !== CONTEXT_MENU_ID || !tab) return

    try {
        const recording = await getOrCreateOffscreenDocument()
        if (recording) {
            await stopRecording(true)
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

    // Track screen size for preview functionality
    currentScreenSize = { width: tab.width ?? 0, height: tab.height ?? 0 }

    // Send the stream ID to the offscreen document to start recording.
    const msg: StartRecordingMessage = {
        type: 'start-recording',
        data: {
            tabSize: currentScreenSize,
            streamId,
        },
    }
    await chrome.runtime.sendMessage(msg)

    // Update recording state and broadcast to option pages
    isRecording = true
    await broadcastRecordingState()

    // Update context menu title
    await updateContextMenuTitle()
}

async function stopRecording(sendMessage?: boolean) {
    if (sendMessage) {
        const msg: StopRecordingMessage = {
            type: 'stop-recording',
        }
        await chrome.runtime.sendMessage(msg)
    }
    await chrome.action.setIcon({ path: notRecordingIcon })

    // Update recording state and broadcast to option pages
    isRecording = false
    currentScreenSize = null
    await broadcastRecordingState()

    // Update context menu title
    await updateContextMenuTitle()

    const config = await getConfiguration()
    if (config.openOptionPage) await chrome.runtime.openOptionsPage()
}

// Update context menu title based on recording state
async function updateContextMenuTitle() {
    try {
        await chrome.contextMenus.update(CONTEXT_MENU_ID, {
            title: isRecording ? 'Stop Recording' : 'Start Recording',
        })
    } catch (e) {
        console.error('Failed to update context menu:', e)
    }
}

// Broadcast recording state to all option pages
async function broadcastRecordingState() {
    const msg: RecordingStateMessage = {
        type: 'recording-state',
        isRecording,
        screenSize: currentScreenSize ?? undefined,
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
                case 'complete-recording':
                    await stopRecording()
                    await chrome.offscreen.closeDocument()
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

/**
 * Parse API path and extract route information
 */
function parseApiPath(pathname: string): { route: string; name?: string } | null {
    if (!pathname.startsWith(API_PREFIX)) return null

    const path = pathname.slice(API_PREFIX.length)

    // GET /api/storage/estimate
    if (path === 'storage/estimate') {
        return { route: 'storage-estimate' }
    }

    // GET /api/recordings
    if (path === 'recordings') {
        return { route: 'recordings-list' }
    }

    // /api/recordings/:name
    const recordingMatch = path.match(/^recordings\/(.+)$/)
    if (recordingMatch) {
        const name = decodeURIComponent(recordingMatch[1])
        return { route: 'recording', name }
    }

    return null
}

/**
 * Handle API requests
 */
async function handleApiRequest(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const parsed = parseApiPath(url.pathname)

    if (!parsed) {
        return new Response(JSON.stringify({ error: 'Not Found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
        })
    }

    try {
        switch (parsed.route) {
            case 'storage-estimate': {
                if (request.method !== 'GET') {
                    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
                        status: 405,
                        headers: { 'Content-Type': 'application/json' },
                    })
                }
                const estimate = await recordingStorage.estimate()
                return new Response(JSON.stringify(estimate), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                })
            }

            case 'recordings-list': {
                if (request.method !== 'GET') {
                    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
                        status: 405,
                        headers: { 'Content-Type': 'application/json' },
                    })
                }
                // Parse sort query parameter
                const sortParam = url.searchParams.get('sort')
                const sort = sortParam === 'desc' ? 'desc' : 'asc'
                const recordings = await recordingStorage.list({ sort })
                return new Response(JSON.stringify(recordings), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                })
            }

            case 'recording': {
                const name = parsed.name!

                if (request.method === 'DELETE') {
                    await recordingStorage.delete(name)
                    return new Response(null, { status: 204 })
                }

                if (request.method !== 'GET') {
                    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
                        status: 405,
                        headers: { 'Content-Type': 'application/json' },
                    })
                }

                // GET /api/recordings/:name - return binary file
                const file = await recordingStorage.getFile(name)
                if (!file) {
                    return new Response(JSON.stringify({ error: 'Not Found' }), {
                        status: 404,
                        headers: { 'Content-Type': 'application/json' },
                    })
                }
                const mimeType = getMimeTypeFromExtension(name)
                const headers: Record<string, string> = {
                    'Content-Type': mimeType,
                    'Content-Length': file.size.toString(),
                }
                // Add Content-Disposition header only when download=true is specified
                if (url.searchParams.get('download') === 'true') {
                    const encodedName = encodeURIComponent(name).replace(/'/g, '%27')
                    headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodedName}`
                }
                return new Response(file, {
                    status: 200,
                    headers,
                })
            }

            default:
                return new Response(JSON.stringify({ error: 'Not Found' }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' },
                })
        }
    } catch (e) {
        console.error('API error:', e)
        return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        })
    }
}

// Fetch event listener for REST API
// Using type assertion since Service Worker global scope supports 'fetch' event
declare const self: ServiceWorkerGlobalScope
self.addEventListener('fetch', (event: FetchEvent) => {
    const url = new URL(event.request.url)

    // Only intercept /api/* requests from the same origin
    if (url.origin === location.origin && url.pathname.startsWith(API_PREFIX)) {
        event.respondWith(handleApiRequest(event.request))
    }
})
