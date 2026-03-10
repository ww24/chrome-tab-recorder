import { parseApiPath, handleApiRequest } from './handler'
import type { RecordingStorage, RecordingMetadata, StorageEstimateInfo, ListRecordingsOptions } from './storage'

// ---------- helpers ----------

function createMockStorage(overrides: Partial<RecordingStorage> = {}): RecordingStorage {
    return {
        list: jest.fn<Promise<RecordingMetadata[]>, [ListRecordingsOptions?]>().mockResolvedValue([]),
        getFile: jest.fn<Promise<File | null>, [string]>().mockResolvedValue(null),
        delete: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
        estimate: jest.fn<Promise<StorageEstimateInfo>, []>().mockResolvedValue({ usage: 0, quota: 0 }),
        ...overrides,
    }
}

function createFile(content: string, name: string, type: string): File {
    return new File([content], name, { type })
}

// ---------- parseApiPath ----------

describe('parseApiPath', () => {
    it('should parse /api/storage/estimate', () => {
        expect(parseApiPath('/api/storage/estimate')).toEqual({ route: 'storage-estimate' })
    })

    it('should parse /api/recordings', () => {
        expect(parseApiPath('/api/recordings')).toEqual({ route: 'recordings-list' })
    })

    it('should parse /api/recordings/:name', () => {
        expect(parseApiPath('/api/recordings/test.webm')).toEqual({ route: 'recording', name: 'test.webm' })
    })

    it('should decode percent-encoded names', () => {
        expect(parseApiPath('/api/recordings/my%20video.mp4')).toEqual({ route: 'recording', name: 'my video.mp4' })
    })

    it('should return null for unknown paths', () => {
        expect(parseApiPath('/api/unknown')).toBeNull()
    })

    it('should return null for paths not starting with /api/', () => {
        expect(parseApiPath('/other/path')).toBeNull()
    })
})

// ---------- handleApiRequest – storage-estimate ----------

describe('handleApiRequest – storage-estimate', () => {
    it('should return storage estimate on GET', async () => {
        const storage = createMockStorage({
            estimate: jest.fn<Promise<StorageEstimateInfo>, []>().mockResolvedValue({ usage: 1024, quota: 1048576 }),
        })
        const req = new Request('https://ext.example/api/storage/estimate')
        const res = await handleApiRequest(req, storage)

        expect(res.status).toBe(200)
        expect(res.headers.get('Content-Type')).toBe('application/json')
        expect(await res.json()).toEqual({ usage: 1024, quota: 1048576 })
    })

    it('should return 405 for POST', async () => {
        const storage = createMockStorage()
        const req = new Request('https://ext.example/api/storage/estimate', { method: 'POST' })
        const res = await handleApiRequest(req, storage)

        expect(res.status).toBe(405)
    })
})

// ---------- handleApiRequest – recordings-list ----------

describe('handleApiRequest – recordings-list', () => {
    const recordings: RecordingMetadata[] = [
        { title: 'a.webm', size: 100, lastModified: 1, mimeType: 'video/webm', recordedAt: 1 },
        { title: 'b.webm', size: 200, lastModified: 2, mimeType: 'video/webm', recordedAt: 2 },
    ]

    it('should list recordings on GET', async () => {
        const storage = createMockStorage({
            list: jest.fn<Promise<RecordingMetadata[]>, [ListRecordingsOptions?]>().mockResolvedValue(recordings),
        })
        const req = new Request('https://ext.example/api/recordings')
        const res = await handleApiRequest(req, storage)

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual(recordings)
        expect(storage.list).toHaveBeenCalledWith({ sort: 'asc' })
    })

    it('should pass sort=desc parameter', async () => {
        const storage = createMockStorage({
            list: jest.fn<Promise<RecordingMetadata[]>, [ListRecordingsOptions?]>().mockResolvedValue(recordings),
        })
        const req = new Request('https://ext.example/api/recordings?sort=desc')
        const res = await handleApiRequest(req, storage)

        expect(res.status).toBe(200)
        expect(storage.list).toHaveBeenCalledWith({ sort: 'desc' })
    })

    it('should return 405 for DELETE', async () => {
        const storage = createMockStorage()
        const req = new Request('https://ext.example/api/recordings', { method: 'DELETE' })
        const res = await handleApiRequest(req, storage)

        expect(res.status).toBe(405)
    })
})

// ---------- handleApiRequest – recording (GET full) ----------

describe('handleApiRequest – recording GET (full response)', () => {
    it('should return 200 with file contents', async () => {
        const file = createFile('hello world', 'test.webm', 'video/webm')
        const storage = createMockStorage({
            getFile: jest.fn<Promise<File | null>, [string]>().mockResolvedValue(file),
        })
        const req = new Request('https://ext.example/api/recordings/test.webm')
        const res = await handleApiRequest(req, storage)

        expect(res.status).toBe(200)
        expect(res.headers.get('Content-Type')).toBe('video/webm')
        expect(res.headers.get('Content-Length')).toBe(file.size.toString())
        expect(res.headers.get('Accept-Ranges')).toBe('bytes')
        expect(res.headers.has('Content-Disposition')).toBe(false)
    })

    it('should add Content-Disposition when download=true', async () => {
        const file = createFile('data', 'my video.mp4', 'video/mp4')
        const storage = createMockStorage({
            getFile: jest.fn<Promise<File | null>, [string]>().mockResolvedValue(file),
        })
        const req = new Request('https://ext.example/api/recordings/my%20video.mp4?download=true')
        const res = await handleApiRequest(req, storage)

        expect(res.status).toBe(200)
        expect(res.headers.get('Content-Disposition')).toContain('attachment')
    })

    it('should return 404 when file not found', async () => {
        const storage = createMockStorage()
        const req = new Request('https://ext.example/api/recordings/missing.webm')
        const res = await handleApiRequest(req, storage)

        expect(res.status).toBe(404)
    })

    it('should return 405 for PUT', async () => {
        const storage = createMockStorage()
        const req = new Request('https://ext.example/api/recordings/test.webm', { method: 'PUT' })
        const res = await handleApiRequest(req, storage)

        expect(res.status).toBe(405)
    })
})

// ---------- handleApiRequest – recording DELETE ----------

describe('handleApiRequest – recording DELETE', () => {
    it('should return 204 on successful delete', async () => {
        const storage = createMockStorage()
        const req = new Request('https://ext.example/api/recordings/test.webm', { method: 'DELETE' })
        const res = await handleApiRequest(req, storage)

        expect(res.status).toBe(204)
        expect(storage.delete).toHaveBeenCalledWith('test.webm')
    })
})

// ---------- handleApiRequest – recording GET (range requests) ----------

describe('handleApiRequest – recording GET (Range Requests)', () => {
    // Create a 10-byte file for predictable byte content
    const content = '0123456789'
    let file: File
    let storage: RecordingStorage

    beforeEach(() => {
        file = createFile(content, 'test.webm', 'video/webm')
        storage = createMockStorage({
            getFile: jest.fn<Promise<File | null>, [string]>().mockResolvedValue(file),
        })
    })

    it('should return 206 for valid int-range', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm', {
            headers: { 'Range': 'bytes=0-4' },
        })
        const res = await handleApiRequest(req, storage)

        expect(res.status).toBe(206)
        expect(res.headers.get('Content-Range')).toBe(`bytes 0-4/${file.size}`)
        expect(res.headers.get('Content-Length')).toBe('5')
        expect(res.headers.get('Accept-Ranges')).toBe('bytes')
        expect(res.headers.get('Content-Type')).toBe('video/webm')

        const body = await res.text()
        expect(body).toBe('01234')
    })

    it('should return 206 for suffix-range', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm', {
            headers: { 'Range': 'bytes=-3' },
        })
        const res = await handleApiRequest(req, storage)

        expect(res.status).toBe(206)
        expect(res.headers.get('Content-Range')).toBe(`bytes 7-9/${file.size}`)
        expect(res.headers.get('Content-Length')).toBe('3')

        const body = await res.text()
        expect(body).toBe('789')
    })

    it('should return 206 for open-range', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm', {
            headers: { 'Range': 'bytes=5-' },
        })
        const res = await handleApiRequest(req, storage)

        expect(res.status).toBe(206)
        expect(res.headers.get('Content-Range')).toBe(`bytes 5-9/${file.size}`)
        expect(res.headers.get('Content-Length')).toBe('5')

        const body = await res.text()
        expect(body).toBe('56789')
    })

    it('should clamp end to file size for int-range', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm', {
            headers: { 'Range': 'bytes=0-99999' },
        })
        const res = await handleApiRequest(req, storage)

        expect(res.status).toBe(206)
        expect(res.headers.get('Content-Range')).toBe(`bytes 0-9/${file.size}`)
        expect(res.headers.get('Content-Length')).toBe(file.size.toString())
    })

    it('should return 416 for unsatisfiable range', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm', {
            headers: { 'Range': 'bytes=100-200' },
        })
        const res = await handleApiRequest(req, storage)

        expect(res.status).toBe(416)
        expect(res.headers.get('Content-Range')).toBe(`bytes */${file.size}`)
    })

    it('should return 200 for invalid Range header syntax', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm', {
            headers: { 'Range': 'invalid' },
        })
        const res = await handleApiRequest(req, storage)

        expect(res.status).toBe(200)
        expect(res.headers.get('Accept-Ranges')).toBe('bytes')
        expect(res.headers.get('Content-Length')).toBe(file.size.toString())
    })

    it('should return 200 for unsupported range unit', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm', {
            headers: { 'Range': 'items=0-5' },
        })
        const res = await handleApiRequest(req, storage)

        expect(res.status).toBe(200)
    })

    it('should include Content-Disposition with range response when download=true', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm?download=true', {
            headers: { 'Range': 'bytes=0-4' },
        })
        const res = await handleApiRequest(req, storage)

        expect(res.status).toBe(206)
        expect(res.headers.get('Content-Disposition')).toContain('attachment')
    })

    it('should handle single-byte range', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm', {
            headers: { 'Range': 'bytes=0-0' },
        })
        const res = await handleApiRequest(req, storage)

        expect(res.status).toBe(206)
        expect(res.headers.get('Content-Range')).toBe(`bytes 0-0/${file.size}`)
        expect(res.headers.get('Content-Length')).toBe('1')

        const body = await res.text()
        expect(body).toBe('0')
    })

    it('should handle last-byte range', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm', {
            headers: { 'Range': 'bytes=9-9' },
        })
        const res = await handleApiRequest(req, storage)

        expect(res.status).toBe(206)
        expect(res.headers.get('Content-Range')).toBe(`bytes 9-9/${file.size}`)
        expect(res.headers.get('Content-Length')).toBe('1')

        const body = await res.text()
        expect(body).toBe('9')
    })

    it('should use first range from multi-range header', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm', {
            headers: { 'Range': 'bytes=0-2,5-7' },
        })
        const res = await handleApiRequest(req, storage)

        expect(res.status).toBe(206)
        expect(res.headers.get('Content-Range')).toBe(`bytes 0-2/${file.size}`)
        expect(res.headers.get('Content-Length')).toBe('3')

        const body = await res.text()
        expect(body).toBe('012')
    })
})

// ---------- handleApiRequest – not found ----------

describe('handleApiRequest – not found', () => {
    it('should return 404 for unknown API path', async () => {
        const storage = createMockStorage()
        const req = new Request('https://ext.example/api/unknown')
        const res = await handleApiRequest(req, storage)

        expect(res.status).toBe(404)
    })
})

// ---------- handleApiRequest – internal error ----------

describe('handleApiRequest – internal error', () => {
    it('should return 500 when storage throws', async () => {
        const storage = createMockStorage({
            list: jest.fn<Promise<RecordingMetadata[]>, [ListRecordingsOptions?]>().mockRejectedValue(new Error('disk error')),
        })
        const req = new Request('https://ext.example/api/recordings')
        const res = await handleApiRequest(req, storage)

        expect(res.status).toBe(500)
        expect(await res.json()).toEqual({ error: 'Internal Server Error' })
    })
})
