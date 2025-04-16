import { MediaRecorderWebMDurationWorkaround } from './fix_webm_duration'
import { Settings } from './element/settings'
import type { Message, StartRecording, UpdateRecordingIconMessage, CompleteRecordingMessage } from './message'
import { sendEvent, sendException } from './sentry'
import { MIMEType } from './mime'

const timeslice = 3000 // 3s

// Using Map to store multiple recording tasks
interface RecordingTask {
    recorder: MediaRecorder;
    writableStream: FileSystemWritableFileStream;
    fixWebM?: MediaRecorderWebMDurationWorkaround;
    startTime: number;
    fileName: string;
    backupFileName?: string;
    regularFileName: string;
    recordFileHandle: FileSystemFileHandle;
    dirHandle: FileSystemDirectoryHandle;
    size: { width: number, height: number };
}

const recordingTasks = new Map<string, RecordingTask>();

chrome.runtime.onMessage.addListener((message: Message, sender: chrome.runtime.MessageSender, sendResponse: () => void) => {
    (async () => {
        try {
            switch (message.type) {
                case 'start-recording':
                    await startRecording(message.data, message.taskId)
                    return
                case 'stop-recording':
                    await stopRecording(message.taskId)
                    return
                case 'save-config-local':
                    Settings.setConfiguration(message.data)
                    return
                case 'exception':
                    throw message.data
            }
        } catch (e) {
            sendException(e)
            console.error(e)
        } finally {
            sendResponse()
        }
    })()
    return true // asynchronous flag
})

async function startRecording(startRecording: StartRecording, taskId: string) {
    if (recordingTasks.has(taskId)) {
        throw new Error(`Recording task ${taskId} already exists.`)
    }

    if (! await navigator.storage.persisted()) {
        console.warn('OPFS persist: permission denied')
    }

    const videoFormat = Settings.getVideoFormat()
    if (!MediaRecorder.isTypeSupported(videoFormat.mimeType)) {
        throw new Error('unsupported MIME type: ' + videoFormat.mimeType)
    }
    const mimeType = new MIMEType(videoFormat.mimeType)

    // update recording icon
    const msg: UpdateRecordingIconMessage = {
        type: 'update-recording-icon',
        icon: videoFormat.recordingMode,
        tabId: startRecording.tabId
    }
    await chrome.runtime.sendMessage(msg)

    const dirHandle = await navigator.storage.getDirectory()
    const fileBaseName = `video-${taskId}-${Date.now()}`
    const backupFileName = `${fileBaseName}.bk${mimeType.extension()}`
    const regularFileName = `${fileBaseName}${mimeType.extension()}`
    const recordFileName = mimeType.is(MIMEType.webm) ? backupFileName : regularFileName
    const recordFileHandle = await dirHandle.getFileHandle(recordFileName, { create: true })
    const writableStream = await recordFileHandle.createWritable()

    const size = Settings.getScreenRecordingSize(startRecording.tabSize)
    const media = await navigator.mediaDevices.getUserMedia({
        audio: videoFormat.recordingMode === 'video-only' ? undefined : {
            mandatory: {
                chromeMediaSource: 'tab',
                chromeMediaSourceId: startRecording.streamId,
            }
        },
        video: videoFormat.recordingMode === 'audio-only' ? undefined : {
            mandatory: {
                chromeMediaSource: 'tab',
                chromeMediaSourceId: startRecording.streamId,
                maxWidth: size.width,
                maxHeight: size.height,
                maxFrameRate: videoFormat.frameRate,
            },
        }
    })

    // Check if tab audio should be muted
    const config = Settings.getConfiguration();
    if (media.getAudioTracks().length > 0) {
        if (config.muteOnRecording) {
            // Mute tab audio - don't connect to output
            console.log(`Task ${taskId}: Muting tab audio as per user settings`);
        } else {
            // Continue playing captured audio to user
            const output = new AudioContext()
            const source = output.createMediaStreamSource(media)
            source.connect(output.destination)
        }
    }

    // Start recording.
    const recorder = new MediaRecorder(media, {
        mimeType: videoFormat.mimeType,
        audioBitsPerSecond: videoFormat.recordingMode === 'video-only' ? undefined : videoFormat.audioBitrate,
        videoBitsPerSecond: videoFormat.recordingMode === 'audio-only' ? undefined : videoFormat.videoBitrate,
    })

    let fixWebM: MediaRecorderWebMDurationWorkaround | undefined
    if (mimeType.is(MIMEType.webm)) {
        fixWebM = new MediaRecorderWebMDurationWorkaround()
    }
    
    // Create recording task and store it
    const task: RecordingTask = {
        recorder,
        writableStream,
        fixWebM,
        startTime: Date.now(),
        fileName: recordFileName,
        backupFileName: mimeType.is(MIMEType.webm) ? backupFileName : undefined,
        regularFileName,
        recordFileHandle,
        dirHandle,
        size
    };
    
    recordingTasks.set(taskId, task);
    
    recorder.addEventListener('dataavailable', async event => {
        try {
            const task = recordingTasks.get(taskId);
            if (!task) return;
            
            await task.writableStream.write(event.data)
            if (task.fixWebM != null) {
                await task.fixWebM.write(event.data)
            }
        } catch (e) {
            sendException(e)
            console.error(e)
        }
    })
    
    recorder.addEventListener('stop', async () => {
        try {
            const task = recordingTasks.get(taskId);
            if (!task) return;
            
            const duration = Date.now() - task.startTime;
            console.log(`Task ${taskId} stopped: duration=${duration / 1000}s`);

            if (recorder.stream.active) {
                console.log(`Task ${taskId}: unexpected stop, retrying`)
                recorder.start(timeslice)
                return
            }

            sendEvent({
                type: 'stop_recording',
                tags: {
                    mimeType: recorder.mimeType,
                    videoBitRate: recorder.videoBitsPerSecond,
                    audioBitRate: recorder.audioBitsPerSecond,
                    recordingResolution: `${task.size.width}x${task.size.height}`,
                    recordingMode: videoFormat.recordingMode,
                },
                metrics: {
                    duration: duration / 1000,
                },
            })

            await task.writableStream.close()

            if (task.fixWebM != null) {
                // workaround: fix video duration
                task.fixWebM.close()
                const fixWebMDuration = task.fixWebM.duration()
                console.debug(`Task ${taskId} fixWebM: duration=${fixWebMDuration / 1000}s`)

                const fixedFileHandle = await task.dirHandle.getFileHandle(task.regularFileName, { create: true })
                const fixedWritableStream = await fixedFileHandle.createWritable()
                const file = await task.recordFileHandle.getFile()
                const fixed = task.fixWebM.fixMetadata(file)

                try {
                    await fixed.stream().pipeTo(fixedWritableStream)
                    if (fixed.size >= file.size && Math.abs(duration - fixWebMDuration) < 5000) {
                        await task.dirHandle.removeEntry(task.fileName)
                    }
                } catch (e) {
                    await fixedWritableStream.close()
                    throw e
                }
            }
            
            // Task completed, remove from records
            recordingTasks.delete(taskId);
            
            // If no more recording tasks, update hash
            if (recordingTasks.size === 0) {
                window.location.hash = ''
            }
            
            // Notify service worker that task is complete
            const completeMsg: CompleteRecordingMessage = {
                type: 'complete-recording',
                taskId
            }
            await chrome.runtime.sendMessage(completeMsg)
            
        } catch (e) {
            sendException(e)
            console.error(e)

            try {
                const task = recordingTasks.get(taskId);
                if (task) {
                // close backup file writable stream
                    await task.writableStream.close();
                    // 从记录中移除
                    recordingTasks.delete(taskId);
                }
            } catch (e) {
                console.error(e)
            }
            
            // Notify service worker that task is complete
            const completeMsg: CompleteRecordingMessage = {
                type: 'complete-recording',
                taskId
            }
            await chrome.runtime.sendMessage(completeMsg)
        }
    })
    
    recorder.start(timeslice)

    console.log(`Task ${taskId} started:`)
    console.log('mimeType:', recorder.mimeType)
    console.log('videoBitRate:', recorder.videoBitsPerSecond)
    console.log('audioBitRate:', recorder.audioBitsPerSecond)

    // Update page hash to indicate recording in progress
    if (window.location.hash !== '#recording') {
    window.location.hash = 'recording'
}
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
    const task = recordingTasks.get(taskId);
    if (!task) {
        console.log(`Task ${taskId} not found.`);
        return;
    }

    task.recorder.stop();

    // Stopping the tracks makes sure the recording icon in the tab is removed.
    task.recorder.stream.getTracks().forEach(t => t.stop());
}

