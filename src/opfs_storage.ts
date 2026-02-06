import type { ListRecordingsOptions, RecordingMetadata, RecordingStorage, StorageEstimateInfo } from './storage'
import { getMimeTypeFromExtension } from './mime'

const timestampRegex = /^video-([0-9]+)\./

/**
 * OPFS (Origin Private File System) implementation of RecordingStorage
 */
export class OPFSStorage implements RecordingStorage {
    async list(options?: ListRecordingsOptions): Promise<RecordingMetadata[]> {
        const opfsRoot = await navigator.storage.getDirectory()
        const result: RecordingMetadata[] = []

        for await (const [name, handle] of opfsRoot.entries()) {
            if (handle.kind !== 'file') continue
            const file = await (handle as FileSystemFileHandle).getFile()
            const metadata = this.fileToMetadata(name, file)
            result.push(metadata)
        }

        // Sort by recordedAt (default: ascending)
        const sortOrder = options?.sort ?? 'asc'
        if (sortOrder === 'desc') {
            result.sort((a, b) => (b.recordedAt ?? 0) - (a.recordedAt ?? 0))
        } else {
            result.sort((a, b) => (a.recordedAt ?? 0) - (b.recordedAt ?? 0))
        }
        return result
    }

    async getFile(name: string): Promise<File | null> {
        try {
            const opfsRoot = await navigator.storage.getDirectory()
            const handle = await opfsRoot.getFileHandle(name)
            return await handle.getFile()
        } catch (e) {
            if (e instanceof DOMException && e.name === 'NotFoundError') {
                return null
            }
            throw e
        }
    }

    async delete(name: string): Promise<void> {
        try {
            const opfsRoot = await navigator.storage.getDirectory()
            await opfsRoot.removeEntry(name)
        } catch (e) {
            // Idempotent: succeed silently if already deleted
            if (e instanceof DOMException && e.name === 'NotFoundError') {
                return
            }
            throw e
        }
    }

    async estimate(): Promise<StorageEstimateInfo> {
        const estimate = await navigator.storage.estimate()
        return {
            usage: estimate.usage ?? 0,
            quota: estimate.quota ?? 0,
        }
    }

    private fileToMetadata(name: string, file: File): RecordingMetadata {
        let recordedAt: number | undefined
        const matched = name.match(timestampRegex)
        if (matched != null && matched.length >= 2) {
            recordedAt = Number.parseInt(matched[1], 10)
        }

        return {
            title: name,
            size: file.size,
            lastModified: file.lastModified,
            mimeType: getMimeTypeFromExtension(name),
            recordedAt,
        }
    }
}
