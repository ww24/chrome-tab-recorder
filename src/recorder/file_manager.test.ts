jest.mock('mediabunny', () => ({
    canEncodeAudio: jest.fn().mockResolvedValue(true),
}))
jest.mock('@mediabunny/flac-encoder', () => ({
    registerFlacEncoder: jest.fn(),
}))

import { FileManager } from './file_manager'

// ---------- OPFS mocks ----------

const mockWritableStream = {
    write: jest.fn(),
    close: jest.fn(),
    abort: jest.fn(),
} as unknown as FileSystemWritableFileStream

const mockFileHandle = {
    createWritable: jest.fn().mockResolvedValue(mockWritableStream),
    getFile: jest.fn().mockResolvedValue(new File([], 'test.webm')),
} as unknown as FileSystemFileHandle

const mockDirHandle = {
    getFileHandle: jest.fn().mockResolvedValue(mockFileHandle),
} as unknown as FileSystemDirectoryHandle

// Mock navigator.storage
const origStorage = globalThis.navigator
beforeAll(() => {
    Object.defineProperty(globalThis, 'navigator', {
        value: {
            ...origStorage,
            storage: {
                getDirectory: jest.fn().mockResolvedValue(mockDirHandle),
                persisted: jest.fn().mockResolvedValue(true),
            },
        },
        configurable: true,
    })
})

beforeEach(() => {
    jest.clearAllMocks()
})

// ---------- FileManager ----------

describe('FileManager', () => {
    describe('createRecordingFile', () => {
        test('creates file with correct name for webm container', async () => {
            const fm = new FileManager()
            const result = await fm.createRecordingFile(1234567890, 'webm')

            expect(mockDirHandle.getFileHandle).toHaveBeenCalledWith('video-1234567890.webm', { create: true })
            expect(result).toBe(mockFileHandle)
        })

        test('creates file with correct name for mp4 container', async () => {
            const fm = new FileManager()
            const result = await fm.createRecordingFile(9999, 'mp4')

            expect(mockDirHandle.getFileHandle).toHaveBeenCalledWith('video-9999.mp4', { create: true })
            expect(result).toBe(mockFileHandle)
        })

        test('creates file with correct name for ogg container', async () => {
            const fm = new FileManager()
            const result = await fm.createRecordingFile(5555, 'ogg')

            expect(mockDirHandle.getFileHandle).toHaveBeenCalledWith('video-5555.ogg', { create: true })
            expect(result).toBe(mockFileHandle)
        })
    })

    describe('createAudioFile', () => {
        test('creates audio file with given fileName', async () => {
            const fm = new FileManager()
            const result = await fm.createAudioFile('video-1000-tab.ogg')

            expect(mockDirHandle.getFileHandle).toHaveBeenCalledWith('video-1000-tab.ogg', { create: true })
            expect(result).toBe(mockFileHandle)
        })
    })

    describe('directory caching', () => {
        test('calls getDirectory only once across multiple operations', async () => {
            const fm = new FileManager()
            await fm.createRecordingFile(1, 'webm')
            await fm.createAudioFile('test.ogg')

            expect(navigator.storage.getDirectory).toHaveBeenCalledTimes(1)
        })
    })
})
