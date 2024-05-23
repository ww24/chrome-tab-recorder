import type { getMediaStreamId } from './type';

type Message = AnyMessage | StopRecordingMessage | WindowMessage;
interface AnyMessage {
    type: string;
    target: string;
    data: unknown;
}
interface BackgroundMessage {
    target: 'background';
}
interface StopRecordingMessage extends BackgroundMessage {
    type: 'stop-recording';
}
interface WindowMessage extends BackgroundMessage {
    type: 'resize-window';
    data: WindowSize;
}
interface WindowSize {
    width: number;
    height: number;
}

const recordingIcon = '/icons/recording.png';
const notRecordingIcon = '/icons/not-recording.png';

chrome.action.onClicked.addListener(async (tab: chrome.tabs.Tab) => {
    const existingContexts = await chrome.runtime.getContexts({});
    const offscreenDocument = existingContexts.find(
        c => c.contextType === 'OFFSCREEN_DOCUMENT'
    );

    // If an offscreen document is not already open, create one.
    let recording = false;
    if (!offscreenDocument) {
        await chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: [chrome.offscreen.Reason.USER_MEDIA],
            justification: 'Recording from chrome.tabCapture API'
        });
    } else {
        recording = (offscreenDocument.documentUrl?.endsWith('#recording') ?? false);
    }

    if (recording) {
        chrome.runtime.sendMessage({
            type: 'stop-recording',
            target: 'offscreen'
        });
        chrome.action.setIcon({ path: notRecordingIcon });
        return;
    }

    // Get a MediaStream for the active tab.
    const streamId = await (chrome.tabCapture.getMediaStreamId as typeof getMediaStreamId)({
        targetTabId: tab.id
    });

    // Send the stream ID to the offscreen document to start recording.
    chrome.runtime.sendMessage({
        type: 'start-recording',
        target: 'offscreen',
        data: streamId
    });

    chrome.action.setIcon({ path: recordingIcon });
});

chrome.runtime.onMessage.addListener(async (message: Message) => {
    if (message.target !== 'background') {
        return
    }
    switch (message.type) {
        case 'resize-window':
            if (typeof message.data !== "object" || message.data == null) return;
            await resizeWindow(message.data as WindowSize);
            return;
        case 'stop-recording':
            chrome.action.setIcon({ path: notRecordingIcon });
            return;
        default:
            throw new Error(`Unrecognized message: ${message.type}`);
    }
});

async function resizeWindow({ width, height }: WindowSize) {
    const window = await chrome.windows.getCurrent();
    if (window.id == null) return;
    const updateInfo: chrome.windows.UpdateInfo = {
        width,
        height,
        state: 'normal',
    };
    await chrome.windows.update(window.id, updateInfo);
}
