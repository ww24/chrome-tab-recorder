import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseRecordedAt, RecordingDB, type RecordingRecord } from '../src/recording_db'
import type { RecordingMetadata } from '../src/storage'

// ---------------------------------------------------------------------------
// parseRecordedAt (pure function)
// ---------------------------------------------------------------------------

describe('parseRecordedAt', () => {
    it('extracts timestamp from standard main file name', () => {
        expect(parseRecordedAt('video-1714000000000.webm')).toBe(1714000000000)
    })

    it('extracts timestamp from .flac extension', () => {
        expect(parseRecordedAt('video-1714000000000.flac')).toBe(1714000000000)
    })

    it('extracts timestamp from .crswap swap file', () => {
        // "video-123.webm.crswap" still starts with "video-<digits>." so timestampRegex matches
        expect(parseRecordedAt('video-1714000000000.webm.crswap')).toBe(1714000000000)
    })

    it('returns undefined for sub-file names (tab/mic)', () => {
        // Sub-files like "video-123-tab.flac" still match timestampRegex
        // because the regex is /^video-([0-9]+)\./ — but sub-files have a hyphen before tab/mic,
        // so they actually match as "video-123" with the rest being "-tab.flac" which does NOT
        // start with a dot → no match
        expect(parseRecordedAt('video-1714000000000-tab.flac')).toBeUndefined()
        expect(parseRecordedAt('video-1714000000000-mic.flac')).toBeUndefined()
    })

    it('returns undefined for unexpected prefix', () => {
        expect(parseRecordedAt('audio-1714000000000.webm')).toBeUndefined()
    })

    it('returns undefined for empty string', () => {
        expect(parseRecordedAt('')).toBeUndefined()
    })

    it('returns undefined for name with no timestamp digits', () => {
        expect(parseRecordedAt('video-abc.webm')).toBeUndefined()
    })

    it('returns undefined for bare filename without video- prefix', () => {
        expect(parseRecordedAt('1714000000000.webm')).toBeUndefined()
    })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<RecordingRecord> & { recordedAt: number }): RecordingRecord {
    return {
        mainFilePath: `video-${overrides.recordedAt}.webm`,
        mimeType: 'video/webm',
        title: `video-${overrides.recordedAt}.webm`,
        status: 'completed',
        durationMs: null,
        fileSize: 1024,
        subFiles: [],
        ...overrides,
    }
}

function makeMeta(title: string, opts?: Partial<RecordingMetadata>): RecordingMetadata {
    return {
        title,
        size: opts?.size ?? 1024,
        lastModified: Date.now(),
        mimeType: opts?.mimeType ?? 'video/webm',
        isTemporary: opts?.isTemporary ?? false,
    }
}

function mockOpfsStorage(files: RecordingMetadata[]) {
    return {
        list: vi.fn().mockResolvedValue(files),
        getFile: vi.fn(),
        delete: vi.fn(),
        estimate: vi.fn(),
    }
}

// ---------------------------------------------------------------------------
// needsMigration
// ---------------------------------------------------------------------------

describe('RecordingDB.needsMigration', () => {
    let db: RecordingDB

    beforeEach(() => {
        db = new RecordingDB()
    })

    it('returns needed:false when IDB count >= OPFS main files', async () => {
        vi.spyOn(db, 'count').mockResolvedValue(2)
        const storage = mockOpfsStorage([makeMeta('video-100.webm'), makeMeta('video-200.webm')])

        const result = await db.needsMigration(storage)
        expect(result).toEqual({ needed: false })
    })

    it('returns needed:true when IDB count < OPFS main files', async () => {
        vi.spyOn(db, 'count').mockResolvedValue(0)
        const storage = mockOpfsStorage([makeMeta('video-100.webm'), makeMeta('video-200.webm')])

        const result = await db.needsMigration(storage)
        expect(result).toEqual({ needed: true, opfsMainFileCount: 2, idbRecordCount: 0 })
    })

    it('excludes temporary files from main file count', async () => {
        vi.spyOn(db, 'count').mockResolvedValue(0)
        const storage = mockOpfsStorage([makeMeta('video-100.webm'), makeMeta('video-200.webm', { isTemporary: true })])

        const result = await db.needsMigration(storage)
        expect(result).toEqual({ needed: true, opfsMainFileCount: 1, idbRecordCount: 0 })
    })

    it('excludes sub-files (tab/mic) from main file count', async () => {
        vi.spyOn(db, 'count').mockResolvedValue(0)
        const storage = mockOpfsStorage([
            makeMeta('video-100.webm'),
            makeMeta('video-100-tab.flac'),
            makeMeta('video-100-mic.flac'),
        ])

        const result = await db.needsMigration(storage)
        expect(result).toEqual({ needed: true, opfsMainFileCount: 1, idbRecordCount: 0 })
    })

    it('excludes files with unexpected names from main file count', async () => {
        vi.spyOn(db, 'count').mockResolvedValue(0)
        const storage = mockOpfsStorage([
            makeMeta('video-100.webm'),
            makeMeta('random-file.txt'),
            makeMeta('audio-200.webm'),
        ])

        const result = await db.needsMigration(storage)
        expect(result).toEqual({ needed: true, opfsMainFileCount: 1, idbRecordCount: 0 })
    })

    it('returns needed:false for empty OPFS', async () => {
        vi.spyOn(db, 'count').mockResolvedValue(0)
        const storage = mockOpfsStorage([])

        const result = await db.needsMigration(storage)
        expect(result).toEqual({ needed: false })
    })

    it('excludes .crswap swap files from main file count', async () => {
        vi.spyOn(db, 'count').mockResolvedValue(0)
        const storage = mockOpfsStorage([makeMeta('video-100.webm.crswap')])

        const result = await db.needsMigration(storage)
        expect(result).toEqual({ needed: false })
    })

    it('excludes .crswap files even when marked as non-temporary', async () => {
        vi.spyOn(db, 'count').mockResolvedValue(0)
        const storage = mockOpfsStorage([makeMeta('video-100.webm'), makeMeta('video-100.webm.crswap')])

        const result = await db.needsMigration(storage)
        // Only the main file should count, not the .crswap
        expect(result).toEqual({ needed: true, opfsMainFileCount: 1, idbRecordCount: 0 })
    })
})

// ---------------------------------------------------------------------------
// migrateFromOPFS
// ---------------------------------------------------------------------------

describe('RecordingDB.migrateFromOPFS', () => {
    let db: RecordingDB
    let putSpy: ReturnType<typeof vi.spyOn>
    let listSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        db = new RecordingDB()
        putSpy = vi.spyOn(db, 'put').mockResolvedValue(undefined)
        listSpy = vi.spyOn(db, 'list').mockResolvedValue([])
    })

    it('inserts main files as completed records', async () => {
        const storage = mockOpfsStorage([makeMeta('video-100.webm', { size: 2048, mimeType: 'video/webm' })])

        const inserted = await db.migrateFromOPFS(storage)
        expect(inserted).toBe(1)
        expect(putSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                recordedAt: 100,
                mainFilePath: 'video-100.webm',
                mimeType: 'video/webm',
                title: 'video-100.webm',
                status: 'completed',
                durationMs: null,
                fileSize: 2048,
                subFiles: [],
            }),
        )
    })

    it('groups sub-files with their main file', async () => {
        const storage = mockOpfsStorage([
            makeMeta('video-100.webm', { size: 2048 }),
            makeMeta('video-100-tab.flac', { size: 512 }),
            makeMeta('video-100-mic.flac', { size: 256 }),
        ])

        const inserted = await db.migrateFromOPFS(storage)
        expect(inserted).toBe(1)
        expect(putSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                recordedAt: 100,
                subFiles: expect.arrayContaining([
                    { path: 'video-100-tab.flac', type: 'tab', fileSize: 512 },
                    { path: 'video-100-mic.flac', type: 'mic', fileSize: 256 },
                ]),
            }),
        )
    })

    it('skips temporary files', async () => {
        const storage = mockOpfsStorage([makeMeta('video-100.webm', { isTemporary: true })])

        const inserted = await db.migrateFromOPFS(storage)
        expect(inserted).toBe(0)
        expect(putSpy).not.toHaveBeenCalled()
    })

    it('skips files with non-matching names', async () => {
        const storage = mockOpfsStorage([makeMeta('random-file.txt'), makeMeta('audio-100.webm')])

        const inserted = await db.migrateFromOPFS(storage)
        expect(inserted).toBe(0)
        expect(putSpy).not.toHaveBeenCalled()
    })

    it('is idempotent — skips records already in IndexedDB', async () => {
        listSpy.mockResolvedValue([makeRecord({ recordedAt: 100 })])
        const storage = mockOpfsStorage([makeMeta('video-100.webm')])

        const inserted = await db.migrateFromOPFS(storage)
        expect(inserted).toBe(0)
        expect(putSpy).not.toHaveBeenCalled()
    })

    it('inserts only missing records when some already exist', async () => {
        listSpy.mockResolvedValue([makeRecord({ recordedAt: 100 })])
        const storage = mockOpfsStorage([makeMeta('video-100.webm'), makeMeta('video-200.webm')])

        const inserted = await db.migrateFromOPFS(storage)
        expect(inserted).toBe(1)
        expect(putSpy).toHaveBeenCalledTimes(1)
        expect(putSpy).toHaveBeenCalledWith(expect.objectContaining({ recordedAt: 200 }))
    })

    it('skips .crswap swap files', async () => {
        const storage = mockOpfsStorage([
            makeMeta('video-100.webm', { size: 2048 }),
            makeMeta('video-100.webm.crswap', { size: 0 }),
        ])

        const inserted = await db.migrateFromOPFS(storage)
        expect(inserted).toBe(1)
        expect(putSpy).toHaveBeenCalledWith(expect.objectContaining({ recordedAt: 100 }))
    })

    it('handles multiple main files with their respective sub-files', async () => {
        const storage = mockOpfsStorage([
            makeMeta('video-100.webm', { size: 1000 }),
            makeMeta('video-100-tab.flac', { size: 100 }),
            makeMeta('video-200.webm', { size: 2000 }),
            makeMeta('video-200-mic.flac', { size: 200 }),
        ])

        const inserted = await db.migrateFromOPFS(storage)
        expect(inserted).toBe(2)
        expect(putSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                recordedAt: 100,
                subFiles: [{ path: 'video-100-tab.flac', type: 'tab', fileSize: 100 }],
            }),
        )
        expect(putSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                recordedAt: 200,
                subFiles: [{ path: 'video-200-mic.flac', type: 'mic', fileSize: 200 }],
            }),
        )
    })

    it('orphaned sub-files without main file are ignored', async () => {
        const storage = mockOpfsStorage([makeMeta('video-100-tab.flac'), makeMeta('video-100-mic.flac')])

        const inserted = await db.migrateFromOPFS(storage)
        expect(inserted).toBe(0)
        expect(putSpy).not.toHaveBeenCalled()
    })

    it('returns 0 for empty OPFS', async () => {
        const storage = mockOpfsStorage([])

        const inserted = await db.migrateFromOPFS(storage)
        expect(inserted).toBe(0)
    })
})

// ---------------------------------------------------------------------------
// markStaleRecordingAsCanceled
// ---------------------------------------------------------------------------

describe('RecordingDB.markStaleRecordingAsCanceled', () => {
    let db: RecordingDB
    let putSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        db = new RecordingDB()
        putSpy = vi.spyOn(db, 'put').mockResolvedValue(undefined)
    })

    it('marks the most recent "recording" record as "canceled"', async () => {
        vi.spyOn(db, 'list').mockResolvedValue([
            makeRecord({ recordedAt: 200, status: 'recording' }),
            makeRecord({ recordedAt: 100, status: 'completed' }),
        ])

        await db.markStaleRecordingAsCanceled()
        expect(putSpy).toHaveBeenCalledWith(expect.objectContaining({ recordedAt: 200, status: 'canceled' }))
    })

    it('does nothing when no record has status "recording"', async () => {
        vi.spyOn(db, 'list').mockResolvedValue([
            makeRecord({ recordedAt: 200, status: 'completed' }),
            makeRecord({ recordedAt: 100, status: 'canceled' }),
        ])

        await db.markStaleRecordingAsCanceled()
        expect(putSpy).not.toHaveBeenCalled()
    })

    it('does nothing when list is empty', async () => {
        vi.spyOn(db, 'list').mockResolvedValue([])

        await db.markStaleRecordingAsCanceled()
        expect(putSpy).not.toHaveBeenCalled()
    })

    it('only marks the first (most recent in desc order) stale recording', async () => {
        vi.spyOn(db, 'list').mockResolvedValue([
            makeRecord({ recordedAt: 300, status: 'recording' }),
            makeRecord({ recordedAt: 200, status: 'recording' }),
            makeRecord({ recordedAt: 100, status: 'completed' }),
        ])

        await db.markStaleRecordingAsCanceled()
        expect(putSpy).toHaveBeenCalledTimes(1)
        expect(putSpy).toHaveBeenCalledWith(expect.objectContaining({ recordedAt: 300, status: 'canceled' }))
    })
})
