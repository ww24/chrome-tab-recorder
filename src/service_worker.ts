import type { getMediaStreamId } from './type';
import type { Message, Resolution, OffscreenStartRecordingMessage, OffscreenStopRecordingMessage } from './message';

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
        const msg: OffscreenStopRecordingMessage = {
            type: 'stop-recording',
            target: 'offscreen'
        };
        await chrome.runtime.sendMessage(msg);
        await chrome.action.setIcon({ path: notRecordingIcon });
        return;
    }

    // Get a MediaStream for the active tab.
    const streamId = await (chrome.tabCapture.getMediaStreamId as typeof getMediaStreamId)({
        targetTabId: tab.id
    });

    // Send the stream ID to the offscreen document to start recording.
    const msg: OffscreenStartRecordingMessage = {
        type: 'start-recording',
        target: 'offscreen',
        data: streamId,
    };
    await chrome.runtime.sendMessage(msg);

    await chrome.action.setIcon({ path: recordingIcon });
});

chrome.runtime.onMessage.addListener(async (message: Message) => {
    if (message.target !== 'background') return;
    switch (message.type) {
        case 'resize-window':
            if (typeof message.data !== "object" || message.data == null) return;
            await resizeWindow(message.data);
            return;
        case 'stop-recording':
            await chrome.action.setIcon({ path: notRecordingIcon });
            return;
    }
});

async function resizeWindow({ width, height }: Resolution) {
    const window = await chrome.windows.getCurrent();
    if (window.id == null) return;
    const updateInfo: chrome.windows.UpdateInfo = {
        width,
        height,
        state: 'normal',
    };
    await chrome.windows.update(window.id, updateInfo);
}
