import fixWebmDuration from 'fix-webm-duration';
import { Settings } from './element/settings';
import type { Message, BackgroundStopRecordingMessage } from './message';

const timeslice = 1000; // 1s

chrome.runtime.onMessage.addListener(async (message: Message) => {
    if (message.target !== 'offscreen') return;
    switch (message.type) {
        case 'start-recording':
            startRecording(message.data);
            return;
        case 'stop-recording':
            stopRecording();
            return;
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
    const fileHandle = await dirHandle.getFileHandle(`${fileBaseName}.webm`, { create: true });
    const writableStream = await fileHandle.createWritable();

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
        videoBitsPerSecond: 8 * 1000 * 1000, // 8Mbps
    });
    recorder.addEventListener('dataavailable', async event => {
        await writableStream.write(event.data);
    });
    const startTime = Date.now();
    recorder.addEventListener('stop', async () => {
        const duration = Date.now() - startTime;
        console.log(`stopped: duration=${duration / 1000}s`);

        await writableStream.close();

        // fix video duration
        const file = await fileHandle.getFile();
        const fixed = await fixWebmDuration(file, duration, { logger: false });
        const fixedFileHandle = await dirHandle.getFileHandle(`${fileBaseName}.fixed.webm`, { create: true });
        const fixedWritableStream = await fixedFileHandle.createWritable();
        fixedWritableStream.write(fixed);
        await fixedWritableStream.close();

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
