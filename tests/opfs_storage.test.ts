import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OPFSStorage } from '../src/opfs_storage'

describe('OPFSStorage.delete', () => {
    let storage: OPFSStorage
    let removeEntryMock: any
    let getDirectoryMock: any

    beforeEach(() => {
        storage = new OPFSStorage()
        removeEntryMock = vi.fn().mockResolvedValue(undefined)
        getDirectoryMock = vi.fn().mockResolvedValue({
            removeEntry: removeEntryMock,
        })
        vi.stubGlobal('navigator', {
            storage: {
                getDirectory: getDirectoryMock,
            },
        })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('successfully deletes an entry', async () => {
        await storage.delete('test.vtt')
        expect(removeEntryMock).toHaveBeenCalledWith('test.vtt')
        expect(removeEntryMock).toHaveBeenCalledTimes(1)
    })

    it('silently ignores NotFoundError', async () => {
        const notFound = new DOMException('Not found', 'NotFoundError')
        removeEntryMock.mockRejectedValueOnce(notFound)

        await expect(storage.delete('nonexistent.vtt')).resolves.toBeUndefined()
        expect(removeEntryMock).toHaveBeenCalledTimes(1)
    })

    it('retries on NoModificationAllowedError and succeeds', async () => {
        const lockError = new DOMException('Locked', 'NoModificationAllowedError')
        removeEntryMock.mockRejectedValueOnce(lockError).mockResolvedValueOnce(undefined)

        await expect(storage.delete('locked.vtt')).resolves.toBeUndefined()
        expect(removeEntryMock).toHaveBeenCalledTimes(2)
    })

    it('throws when NoModificationAllowedError persists after max retries', async () => {
        const lockError = new DOMException('Locked', 'NoModificationAllowedError')
        removeEntryMock.mockRejectedValue(lockError)

        await expect(storage.delete('always-locked.vtt')).rejects.toThrow(lockError)
        expect(removeEntryMock).toHaveBeenCalledTimes(3)
    })

    it('throws immediately on unexpected error', async () => {
        const otherError = new DOMException('Security error', 'SecurityError')
        removeEntryMock.mockRejectedValueOnce(otherError)

        await expect(storage.delete('test.vtt')).rejects.toThrow(otherError)
        expect(removeEntryMock).toHaveBeenCalledTimes(1)
    })
})
