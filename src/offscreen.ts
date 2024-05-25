import fixWebmDuration from 'fix-webm-duration';
import { Settings } from './element/settings';
import type { Message, BackgroundStopRecordingMessage } from './message';
import { getScope, sendEvent } from './sentry';

const timeslice = 1000; // 1s

chrome.runtime.onMessage.addListener(async (message: Message) => {
    try {
        if (message.target !== 'offscreen') return;
        switch (message.type) {
            case 'start-recording':
                await startRecording(message.data);
                return;
            case 'stop-recording':
                await stopRecording();
                return;
            case 'exception':
                throw message.data;
        }
    } catch (e) {
        getScope()?.captureException(e);
        throw e;
    }
});

let recorder: MediaRecorder | undefined;

async function startRecording(streamId: string) {
    if (recorder?.state === 'recording') {
        throw new Error('Called startRecording while recording is in progress.');
    }

    if (! await navigator.storage.persist()) {
        throw new Error('OPFS persist: permission denied');
    }

    const dirHandle = await navigator.storage.getDirectory();
    const fileBaseName = `video-${Date.now()}`;
    const backupFileName = `${fileBaseName}.bk.webm`;
    const backupFileHandle = await dirHandle.getFileHandle(backupFileName, { create: true });
    const writableStream = await backupFileHandle.createWritable();

    const size = Settings.getScreenRecordingSize();
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
    });

    // Continue to play the captured audio to the user.
    const output = new AudioContext();
    const source = output.createMediaStreamSource(media);
    source.connect(output.destination);

    const mimeType = 'video/webm;codecs=av1';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
        throw new Error('unsupported MIME type: ' + mimeType);
    }

    // Start recording.
    recorder = new MediaRecorder(media, {
        mimeType,
        audioBitsPerSecond: 256 * 1000, // 256Kbps
        videoBitsPerSecond: 8 * size.width * size.height,
    });
    recorder.addEventListener('dataavailable', async event => {
        await writableStream.write(event.data);
    });
    const startTime = Date.now();
    recorder.addEventListener('stop', async () => {
        const duration = Date.now() - startTime;
        console.log(`stopped: duration=${duration / 1000}s`);

        sendEvent({
            type: 'stop_recording',
            tags: {
                duration: duration / 1000,
                mimeType: recorder?.mimeType,
                videoBitRate: recorder?.videoBitsPerSecond,
                audioBitRate: recorder?.audioBitsPerSecond,
                recordingResolution: `${size.width}x${size.height}`,
            },
        });

        await writableStream.close();

        // workaround: fix video duration
        const file = await backupFileHandle.getFile();
        const fixed = await fixWebmDuration(file, duration, { logger: false });
        const fixedFileHandle = await dirHandle.getFileHandle(`${fileBaseName}.webm`, { create: true });
        const fixedWritableStream = await fixedFileHandle.createWritable();
        await fixedWritableStream.write(fixed);
        await fixedWritableStream.close();
        if (fixed.size > file.size) {
            await dirHandle.removeEntry(backupFileName);
        }

        recorder = undefined;
        window.location.hash = '';
        const msg: BackgroundStopRecordingMessage = {
            type: 'stop-recording',
            target: 'background',
        };
        await chrome.runtime.sendMessage(msg);
    });
    recorder.start(timeslice);

    console.log('mimeType:', recorder.mimeType);
    console.log('videoBitRate:', recorder.videoBitsPerSecond);
    console.log('audioBitRate:', recorder.audioBitsPerSecond);

    // Record the current state in the URL. This provides a very low-bandwidth
    // way of communicating with the service worker (the service worker can check
    // the URL of the document and see the current recording state). We can't
    // store that directly in the service worker as it may be terminated while
    // recording is in progress. We could write it to storage but that slightly
    // increases the risk of things getting out of sync.
    window.location.hash = 'recording';
}

async function stopRecording() {
    if (recorder == null) {
        window.location.hash = '';
        return;
    }

    recorder.stop();

    // Stopping the tracks makes sure the recording icon in the tab is removed.
    recorder.stream.getTracks().forEach(t => t.stop());

    // Update current state in URL
    window.location.hash = '';
}
