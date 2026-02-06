import type { RecordingMetadata, StorageEstimateInfo, ListRecordingsOptions } from './storage'

const API_BASE = '/api'

/**
 * API client for recording storage operations
 * Communicates with Service Worker via fetch interception
 */
export class RecordingApiClient {
    /**
     * List all recordings
     * @param options - Optional listing options including sort order
     */
    async listRecordings(options?: ListRecordingsOptions): Promise<RecordingMetadata[]> {
        const params = new URLSearchParams()
        if (options?.sort) {
            params.set('sort', options.sort)
        }
        const query = params.toString()
        const url = query ? `${API_BASE}/recordings?${query}` : `${API_BASE}/recordings`
        const response = await fetch(url)
        if (!response.ok) {
            throw new Error(`Failed to list recordings: ${response.status}`)
        }
        return response.json()
    }

    /**
     * Get the file blob for a recording
     */
    async getRecordingFile(name: string): Promise<Blob | null> {
        const encodedName = encodeURIComponent(name)
        const response = await fetch(`${API_BASE}/recordings/${encodedName}`)
        if (response.status === 404) {
            return null
        }
        if (!response.ok) {
            throw new Error(`Failed to get recording file: ${response.status}`)
        }
        return response.blob()
    }

    /**
     * Delete a recording (idempotent)
     */
    async deleteRecording(name: string): Promise<void> {
        const encodedName = encodeURIComponent(name)
        const response = await fetch(`${API_BASE}/recordings/${encodedName}`, {
            method: 'DELETE',
        })
        if (response.status === 204) {
            return
        }
        if (!response.ok) {
            throw new Error(`Failed to delete recording: ${response.status}`)
        }
    }

    /**
     * Get storage estimate
     */
    async getStorageEstimate(): Promise<StorageEstimateInfo> {
        const response = await fetch(`${API_BASE}/storage/estimate`)
        if (!response.ok) {
            throw new Error(`Failed to get storage estimate: ${response.status}`)
        }
        return response.json()
    }
}

/**
 * Default API client instance
 */
export const recordingApi = new RecordingApiClient()
