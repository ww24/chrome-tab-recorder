import type { RecordingSortOrder } from './configuration'

abstract class ConfigStorage {
    abstract set(key: string, value: object): void
    abstract get(key: string): object | null
}

/**
 * Recording metadata for storage layer abstraction
 */
export interface RecordingMetadata {
    title: string
    size: number
    lastModified: number
    mimeType: string
    recordedAt?: number
}

/**
 * Storage estimate information
 */
export interface StorageEstimateInfo {
    usage: number
    quota: number
}

/**
 * Options for listing recordings
 */
export interface ListRecordingsOptions {
    /**
     * Sort order by recordedAt (default: 'asc')
     */
    sort?: RecordingSortOrder
}

/**
 * Abstract interface for recording storage
 * This allows swapping OPFS for IndexedDB or other storage backends
 */
export interface RecordingStorage {
    /**
     * List all recordings
     * @param options - Optional listing options including sort order
     */
    list(options?: ListRecordingsOptions): Promise<RecordingMetadata[]>

    /**
     * Get the file blob for a recording
     */
    getFile(name: string): Promise<File | null>

    /**
     * Delete a recording (idempotent - succeeds if already deleted)
     */
    delete(name: string): Promise<void>

    /**
     * Get storage estimate
     */
    estimate(): Promise<StorageEstimateInfo>
}

export class ExtensionSyncStorage extends ConfigStorage {
    public constructor() {
        super()
    }

    public async set(key: string, value: object) {
        await chrome.storage.sync.set({ [key]: value })
    }

    public async get(key: string): Promise<object | null> {
        return (await chrome.storage.sync.get(key))[key] as (object | null)
    }
}

export class WebLocalStorage extends ConfigStorage {
    public constructor() {
        super()
    }

    public set(key: string, value: object) {
        const data = JSON.stringify(value)
        localStorage.setItem(key, data)
    }

    public get(key: string): object | null {
        const data = localStorage.getItem(key)
        if (data == null) return null
        return JSON.parse(data)
    }
}
