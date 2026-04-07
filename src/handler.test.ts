import { parseApiPath, handleApiRequest } from './handler'
import { RecordingState } from './handler'
import type { RecordingStorage, RecordingMetadata } from './storage'

// ---------- helpers ----------

function createMockStorage(overrides: Partial<RecordingStorage> = {}): RecordingStorage {
    return {
        list: vi.fn().mockResolvedValue([]),
        getFile: vi.fn().mockResolvedValue(null),
        delete: vi.fn().mockResolvedValue(undefined),
        estimate: vi.fn().mockResolvedValue({ usage: 0, quota: 0 }),
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

    it('should return null for malformed percent-encoding', () => {
        expect(parseApiPath('/api/recordings/%E0%A4%A')).toBeNull()
    })

    it('should return null for names with encoded forward slash', () => {
        expect(parseApiPath('/api/recordings/foo%2Fbar.webm')).toBeNull()
    })

    it('should return null for names with encoded backslash', () => {
        expect(parseApiPath('/api/recordings/foo%5Cbar.webm')).toBeNull()
    })
})

// ---------- handleApiRequest – storage-estimate ----------

describe('handleApiRequest – storage-estimate', () => {
    it('should return storage estimate on GET', async () => {
        const storage = createMockStorage({
            estimate: vi.fn().mockResolvedValue({ usage: 1024, quota: 1048576 }),
        })
        const req = new Request('https://ext.example/api/storage/estimate')
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState)

        expect(res.status).toBe(200)
        expect(res.headers.get('Content-Type')).toBe('application/json')
        expect(await res.json()).toEqual({ usage: 1024, quota: 1048576 })
    })

    it('should return 405 for POST', async () => {
        const storage = createMockStorage()
        const req = new Request('https://ext.example/api/storage/estimate', { method: 'POST' })
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState)

        expect(res.status).toBe(405)
    })
})

// ---------- handleApiRequest – recordings-list ----------

describe('handleApiRequest – recordings-list', () => {
    const recordings: RecordingMetadata[] = [
        { title: 'a.webm', size: 100, lastModified: 1, mimeType: 'video/webm', recordedAt: 1, isTemporary: false },
        { title: 'b.webm', size: 200, lastModified: 2, mimeType: 'video/webm', recordedAt: 2, isTemporary: false },
        { title: 'c.webm', size: 0, lastModified: 3, mimeType: 'video/webm', recordedAt: 3, isTemporary: false },
        { title: 'c.webm.crswap', size: 0, lastModified: 3, mimeType: 'video/webm', recordedAt: 3, isTemporary: true },
    ]
    const recordingState: RecordingState = { isRecording: true, startAtMs: 3 }
    const expected: RecordingMetadata[] = [
        { title: 'a.webm', size: 100, lastModified: 1, mimeType: 'video/webm', recordedAt: 1, isTemporary: false, isRecording: false },
        { title: 'b.webm', size: 200, lastModified: 2, mimeType: 'video/webm', recordedAt: 2, isTemporary: false, isRecording: false },
        { title: 'c.webm', size: 0, lastModified: 3, mimeType: 'video/webm', recordedAt: 3, isTemporary: false, isRecording: true },
        { title: 'c.webm.crswap', size: 0, lastModified: 3, mimeType: 'video/webm', recordedAt: 3, isTemporary: true, isRecording: true },
    ]

    it('should list recordings on GET', async () => {
        const storage = createMockStorage({
            list: vi.fn().mockResolvedValue(recordings),
        })
        const req = new Request('https://ext.example/api/recordings')
        const res = await handleApiRequest(req, storage, recordingState)

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual(expected)
        expect(storage.list).toHaveBeenCalledWith({ sort: 'asc' })
    })

    it('should pass sort=desc parameter', async () => {
        const storage = createMockStorage({
            list: vi.fn().mockResolvedValue(recordings),
        })
        const req = new Request('https://ext.example/api/recordings?sort=desc')
        const res = await handleApiRequest(req, storage, recordingState)

        expect(res.status).toBe(200)
        expect(storage.list).toHaveBeenCalledWith({ sort: 'desc' })
    })

    it('should return 405 for DELETE', async () => {
        const storage = createMockStorage()
        const req = new Request('https://ext.example/api/recordings', { method: 'DELETE' })
        const res = await handleApiRequest(req, storage, recordingState)

        expect(res.status).toBe(405)
    })
})

// ---------- handleApiRequest – recording (GET full) ----------

describe('handleApiRequest – recording GET (full response)', () => {
    it('should return 200 with file contents', async () => {
        const file = createFile('hello world', 'test.webm', 'video/webm')
        const storage = createMockStorage({
            getFile: vi.fn().mockResolvedValue(file),
        })
        const req = new Request('https://ext.example/api/recordings/test.webm')
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState)

        expect(res.status).toBe(200)
        expect(res.headers.get('Content-Type')).toBe('video/webm')
        expect(res.headers.get('Content-Length')).toBe(file.size.toString())
        expect(res.headers.get('Accept-Ranges')).toBe('bytes')
        expect(res.headers.has('Content-Disposition')).toBe(false)
    })

    it('should add Content-Disposition when download=true', async () => {
        const file = createFile('data', 'my video.mp4', 'video/mp4')
        const storage = createMockStorage({
            getFile: vi.fn().mockResolvedValue(file),
        })
        const req = new Request('https://ext.example/api/recordings/my%20video.mp4?download=true')
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState)

        expect(res.status).toBe(200)
        expect(res.headers.get('Content-Disposition')).toContain('attachment')
    })

    it('should return 404 when file not found', async () => {
        const storage = createMockStorage()
        const req = new Request('https://ext.example/api/recordings/missing.webm')
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState)

        expect(res.status).toBe(404)
    })

    it('should return 405 for PUT', async () => {
        const storage = createMockStorage()
        const req = new Request('https://ext.example/api/recordings/test.webm', { method: 'PUT' })
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState)

        expect(res.status).toBe(405)
    })
})

// ---------- handleApiRequest – recording DELETE ----------

describe('handleApiRequest – recording DELETE', () => {
    it('should return 204 on successful delete', async () => {
        const storage = createMockStorage()
        const req = new Request('https://ext.example/api/recordings/test.webm', { method: 'DELETE' })
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState)

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
            getFile: vi.fn().mockResolvedValue(file),
        })
    })

    it('should return 206 for valid int-range', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm', {
            headers: { 'Range': 'bytes=0-4' },
        })
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState)

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
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState)

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
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState)

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
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState)

        expect(res.status).toBe(206)
        expect(res.headers.get('Content-Range')).toBe(`bytes 0-9/${file.size}`)
        expect(res.headers.get('Content-Length')).toBe(file.size.toString())
    })

    it('should return 416 for unsatisfiable range', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm', {
            headers: { 'Range': 'bytes=100-200' },
        })
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState)

        expect(res.status).toBe(416)
        expect(res.headers.get('Content-Range')).toBe(`bytes */${file.size}`)
    })

    it('should return 200 for invalid Range header syntax', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm', {
            headers: { 'Range': 'invalid' },
        })
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState)

        expect(res.status).toBe(200)
        expect(res.headers.get('Accept-Ranges')).toBe('bytes')
        expect(res.headers.get('Content-Length')).toBe(file.size.toString())
    })

    it('should return 200 for unsupported range unit', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm', {
            headers: { 'Range': 'items=0-5' },
        })
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState)

        expect(res.status).toBe(200)
    })

    it('should include Content-Disposition with range response when download=true', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm?download=true', {
            headers: { 'Range': 'bytes=0-4' },
        })
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState)

        expect(res.status).toBe(206)
        expect(res.headers.get('Content-Disposition')).toContain('attachment')
    })

    it('should handle single-byte range', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm', {
            headers: { 'Range': 'bytes=0-0' },
        })
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState)

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
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState)

        expect(res.status).toBe(206)
        expect(res.headers.get('Content-Range')).toBe(`bytes 9-9/${file.size}`)
        expect(res.headers.get('Content-Length')).toBe('1')

        const body = await res.text()
        expect(body).toBe('9')
    })

    it('should return 206 with multipart/byteranges for multi-range header', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm', {
            headers: { 'Range': 'bytes=0-2,5-7' },
        })
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState)

        expect(res.status).toBe(206)
        const contentType = res.headers.get('Content-Type')!
        expect(contentType).toMatch(/^multipart\/byteranges; boundary=/)
        const boundary = contentType.split('boundary=')[1]

        const body = await res.text()
        // Verify multipart structure
        expect(body).toContain(`--${boundary}\r\n`)
        expect(body).toContain(`--${boundary}--\r\n`)

        // Verify first part
        expect(body).toContain('Content-Type: video/webm\r\n')
        expect(body).toContain(`Content-Range: bytes 0-2/${file.size}\r\n`)
        expect(body).toContain('012')

        // Verify second part
        expect(body).toContain(`Content-Range: bytes 5-7/${file.size}\r\n`)
        expect(body).toContain('567')
    })

    it('should return 206 with multipart/byteranges for three ranges', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm', {
            headers: { 'Range': 'bytes=0-1,4-5,8-9' },
        })
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState)

        expect(res.status).toBe(206)
        const contentType = res.headers.get('Content-Type')!
        expect(contentType).toMatch(/^multipart\/byteranges; boundary=/)
        const boundary = contentType.split('boundary=')[1]

        const body = await res.text()
        // Count boundary occurrences (3 part boundaries + 1 closing)
        const partBoundaries = body.split(`--${boundary}`).length - 1
        expect(partBoundaries).toBe(4) // 3 parts + 1 closing

        expect(body).toContain(`Content-Range: bytes 0-1/${file.size}\r\n`)
        expect(body).toContain(`Content-Range: bytes 4-5/${file.size}\r\n`)
        expect(body).toContain(`Content-Range: bytes 8-9/${file.size}\r\n`)
    })

    it('should return 416 when all ranges in multi-range are unsatisfiable', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm', {
            headers: { 'Range': 'bytes=100-200,300-400' },
        })
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState)

        expect(res.status).toBe(416)
        expect(res.headers.get('Content-Range')).toBe(`bytes */${file.size}`)
    })

    it('should skip unsatisfiable ranges and serve only satisfiable ones in multipart', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm', {
            headers: { 'Range': 'bytes=0-2,100-200,7-9' },
        })
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState)

        expect(res.status).toBe(206)
        const contentType = res.headers.get('Content-Type')!
        expect(contentType).toMatch(/^multipart\/byteranges; boundary=/)

        const body = await res.text()
        expect(body).toContain(`Content-Range: bytes 0-2/${file.size}\r\n`)
        expect(body).toContain(`Content-Range: bytes 7-9/${file.size}\r\n`)
        // The unsatisfiable range 100-200 should not appear
        expect(body).not.toContain('Content-Range: bytes 100-')
    })

    it('should return single-range 206 when multi-range has only one satisfiable range', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm', {
            headers: { 'Range': 'bytes=0-2,100-200' },
        })
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState)

        expect(res.status).toBe(206)
        // Should be a single-range response, not multipart
        expect(res.headers.get('Content-Type')).toBe('video/webm')
        expect(res.headers.get('Content-Range')).toBe(`bytes 0-2/${file.size}`)
        expect(res.headers.get('Content-Length')).toBe('3')

        const body = await res.text()
        expect(body).toBe('012')
    })

    it('should include Accept-Ranges in multipart response', async () => {
        const req = new Request('https://ext.example/api/recordings/test.webm', {
            headers: { 'Range': 'bytes=0-2,5-7' },
        })
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState)

        expect(res.status).toBe(206)
        expect(res.headers.get('Accept-Ranges')).toBe('bytes')
    })
})

// ---------- handleApiRequest – not found ----------

describe('handleApiRequest – not found', () => {
    it('should return 404 for unknown API path', async () => {
        const storage = createMockStorage()
        const req = new Request('https://ext.example/api/unknown')
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState)

        expect(res.status).toBe(404)
    })
})

// ---------- handleApiRequest – internal error ----------

describe('handleApiRequest – internal error', () => {
    it('should return 500 when storage throws', async () => {
        const storage = createMockStorage({
            list: vi.fn().mockRejectedValue(new Error('disk error')),
        })
        const req = new Request('https://ext.example/api/recordings')
        const recordingState: RecordingState = { isRecording: false, startAtMs: 0 }
        const res = await handleApiRequest(req, storage, recordingState)

        expect(res.status).toBe(500)
        expect(await res.json()).toEqual({ error: 'Internal Server Error' })
    })
})
