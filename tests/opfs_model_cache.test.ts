import { describe, it, expect, vi, afterEach } from 'vitest'
import { OPFSModelCache } from '../src/transcription/opfs_model_cache'
import { REQUIRED_MODEL_FILES, getModelFileUrl, type RequiredModelFile } from '../src/transcription/model_files'

function setupMockStorage(mockFiles: Map<string, number> | null) {
    if (mockFiles === null) {
        Object.defineProperty(globalThis, 'navigator', {
            value: { storage: undefined },
            writable: true,
            configurable: true,
        })
        return
    }

    const cacheDirHandle: Partial<FileSystemDirectoryHandle> = {
        getFileHandle: vi.fn(async (name: string) => {
            if (!mockFiles.has(name)) {
                throw new Error(`File not found: ${name}`)
            }
            const size = mockFiles.get(name)!
            const fileHandle: Partial<FileSystemFileHandle> = {
                getFile: async () => ({ size }) as unknown as File,
            }
            return fileHandle as FileSystemFileHandle
        }),
    }

    const rootHandle: Partial<FileSystemDirectoryHandle> = {
        getDirectoryHandle: vi.fn(async (name: string) => {
            if (name === 'transcription-model-cache') {
                return cacheDirHandle as FileSystemDirectoryHandle
            }
            throw new Error(`Directory not found: ${name}`)
        }),
    }

    Object.defineProperty(globalThis, 'navigator', {
        value: {
            storage: {
                getDirectory: vi.fn(async () => rootHandle as FileSystemDirectoryHandle),
            },
        },
        writable: true,
        configurable: true,
    })
}

describe('OPFSModelCache.hasCache', () => {
    const originalNavigator = globalThis.navigator

    afterEach(() => {
        Object.defineProperty(globalThis, 'navigator', {
            value: originalNavigator,
            writable: true,
            configurable: true,
        })
    })

    it('returns false when storage.getDirectory is not supported', async () => {
        setupMockStorage(null)
        const cache = new OPFSModelCache()
        const result = await cache.hasCache()
        expect(result).toBe(false)
    })

    it('returns false when directory has only one file left behind from failed download', async () => {
        const cache = new OPFSModelCache()
        const files = new Map<string, number>()

        // Add only the first file
        const firstFile = REQUIRED_MODEL_FILES[0]
        const fileName = await cache.getCacheFileName(getModelFileUrl(firstFile))
        files.set(fileName, firstFile.size)

        setupMockStorage(files)
        const result = await cache.hasCache()
        expect(result).toBe(false)
    })

    it('returns false when some files exist but not all required artifacts', async () => {
        const cache = new OPFSModelCache()
        const files = new Map<string, number>()

        // Add half of the files
        for (let i = 0; i < Math.floor(REQUIRED_MODEL_FILES.length / 2); i++) {
            const file = REQUIRED_MODEL_FILES[i]
            const fileName = await cache.getCacheFileName(getModelFileUrl(file))
            files.set(fileName, file.size)
        }

        setupMockStorage(files)
        const result = await cache.hasCache()
        expect(result).toBe(false)
    })

    it('returns false when all files exist but one has incorrect size (truncated download)', async () => {
        const cache = new OPFSModelCache()
        const files = new Map<string, number>()

        for (const file of REQUIRED_MODEL_FILES) {
            const fileName = await cache.getCacheFileName(getModelFileUrl(file))
            files.set(fileName, file.size)
        }

        // Corrupt the size of the large encoder model
        const encoderFile = REQUIRED_MODEL_FILES.find(f => f.name.includes('encoder'))!
        const encoderFileName = await cache.getCacheFileName(getModelFileUrl(encoderFile))
        files.set(encoderFileName, 1024) // incomplete size

        setupMockStorage(files)
        const result = await cache.hasCache()
        expect(result).toBe(false)
    })

    it('returns true when every required artifact exists with its expected size', async () => {
        const cache = new OPFSModelCache()
        const files = new Map<string, number>()

        for (const file of REQUIRED_MODEL_FILES) {
            const fileName = await cache.getCacheFileName(getModelFileUrl(file))
            files.set(fileName, file.size)
        }

        setupMockStorage(files)
        const result = await cache.hasCache()
        expect(result).toBe(true)
    })

    it('returns false when requiredFiles is empty array', async () => {
        const cache = new OPFSModelCache()
        setupMockStorage(new Map())
        const result = await cache.hasCache([])
        expect(result).toBe(false)
    })

    it('works with custom requiredFiles list', async () => {
        const cache = new OPFSModelCache()
        const customFiles: RequiredModelFile[] = [
            { repo: 'custom/repo', revision: 'rev1', name: 'model.bin', size: 1000 },
        ]
        const files = new Map<string, number>()
        const fileName = await cache.getCacheFileName(getModelFileUrl(customFiles[0]))
        files.set(fileName, 1000)

        setupMockStorage(files)
        expect(await cache.hasCache(customFiles)).toBe(true)

        // Change size to mismatch
        files.set(fileName, 999)
        expect(await cache.hasCache(customFiles)).toBe(false)
    })
})
