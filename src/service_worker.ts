import type { getMediaStreamId } from './type';
import type { Message, Resolution, OffscreenStartRecordingMessage, OffscreenStopRecordingMessage, ExceptionMessage } from './message';

const recordingIcon = '/icons/recording.png';
const notRecordingIcon = '/icons/not-recording.png';

chrome.action.onClicked.addListener(async (tab: chrome.tabs.Tab) => {
    try {
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
            await stopRecording();
            return;
        }

        await startRecording(tab);
    } catch (e) {
        const msg: ExceptionMessage = {
            target: 'offscreen',
            type: 'exception',
            data: e,
        };
        await chrome.runtime.sendMessage(msg);
    }
});

async function startRecording(tab: chrome.tabs.Tab) {
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
};

async function stopRecording() {
    const msg: OffscreenStopRecordingMessage = {
        type: 'stop-recording',
        target: 'offscreen'
    };
    await chrome.runtime.sendMessage(msg);
    await chrome.action.setIcon({ path: notRecordingIcon });
};

chrome.runtime.onMessage.addListener(async (message: Message) => {
    try {
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
    } catch (e) {
        const msg: ExceptionMessage = {
            target: 'offscreen',
            type: 'exception',
            data: e,
        };
        await chrome.runtime.sendMessage(msg);
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
};
