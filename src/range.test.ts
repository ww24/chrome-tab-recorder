import { parseRangeHeader, resolveByteRange } from './range'
import type { ByteRangeSpec } from './range'

describe('parseRangeHeader', () => {
    describe('valid byte ranges', () => {
        it('should parse int-range: bytes=0-499', () => {
            const result = parseRangeHeader('bytes=0-499')
            expect(result).toEqual({
                type: 'bytes',
                ranges: [{ type: 'int-range', start: 0, end: 499 }],
            })
        })

        it('should parse int-range: bytes=500-999', () => {
            const result = parseRangeHeader('bytes=500-999')
            expect(result).toEqual({
                type: 'bytes',
                ranges: [{ type: 'int-range', start: 500, end: 999 }],
            })
        })

        it('should parse open-range: bytes=500-', () => {
            const result = parseRangeHeader('bytes=500-')
            expect(result).toEqual({
                type: 'bytes',
                ranges: [{ type: 'open-range', start: 500 }],
            })
        })

        it('should parse suffix-range: bytes=-500', () => {
            const result = parseRangeHeader('bytes=-500')
            expect(result).toEqual({
                type: 'bytes',
                ranges: [{ type: 'suffix-range', suffixLength: 500 }],
            })
        })

        it('should parse range starting at 0: bytes=0-0', () => {
            const result = parseRangeHeader('bytes=0-0')
            expect(result).toEqual({
                type: 'bytes',
                ranges: [{ type: 'int-range', start: 0, end: 0 }],
            })
        })

        it('should parse multiple ranges: bytes=0-499,500-999', () => {
            const result = parseRangeHeader('bytes=0-499,500-999')
            expect(result).toEqual({
                type: 'bytes',
                ranges: [
                    { type: 'int-range', start: 0, end: 499 },
                    { type: 'int-range', start: 500, end: 999 },
                ],
            })
        })

        it('should parse multiple ranges with spaces: bytes=0-499, 500-999', () => {
            const result = parseRangeHeader('bytes=0-499, 500-999')
            expect(result).toEqual({
                type: 'bytes',
                ranges: [
                    { type: 'int-range', start: 0, end: 499 },
                    { type: 'int-range', start: 500, end: 999 },
                ],
            })
        })

        it('should parse mixed range types: bytes=0-499,-500', () => {
            const result = parseRangeHeader('bytes=0-499,-500')
            expect(result).toEqual({
                type: 'bytes',
                ranges: [
                    { type: 'int-range', start: 0, end: 499 },
                    { type: 'suffix-range', suffixLength: 500 },
                ],
            })
        })

        it('should parse open-range starting at 0: bytes=0-', () => {
            const result = parseRangeHeader('bytes=0-')
            expect(result).toEqual({
                type: 'bytes',
                ranges: [{ type: 'open-range', start: 0 }],
            })
        })
    })

    describe('unsupported range units', () => {
        it('should return unsupported for non-bytes unit', () => {
            const result = parseRangeHeader('items=0-499')
            expect(result).toEqual({ type: 'unsupported' })
        })
    })

    describe('invalid range headers', () => {
        it('should return null for empty string', () => {
            expect(parseRangeHeader('')).toBeNull()
        })

        it('should return null for missing equals sign', () => {
            expect(parseRangeHeader('bytes 0-499')).toBeNull()
        })

        it('should return null for reversed range (start > end)', () => {
            expect(parseRangeHeader('bytes=999-500')).toBeNull()
        })

        it('should return null for bare dash', () => {
            expect(parseRangeHeader('bytes=-')).toBeNull()
        })

        it('should return null for non-numeric values', () => {
            expect(parseRangeHeader('bytes=abc-def')).toBeNull()
        })

        it('should return null for empty range-set part', () => {
            expect(parseRangeHeader('bytes=0-499,')).toBeNull()
        })

        it('should return null for just unit with equals', () => {
            expect(parseRangeHeader('bytes=')).toBeNull()
        })
    })
})

describe('resolveByteRange', () => {
    describe('int-range', () => {
        it('should resolve within bounds', () => {
            const range: ByteRangeSpec = { type: 'int-range', start: 0, end: 499 }
            expect(resolveByteRange(range, 10000)).toEqual({ start: 0, end: 499 })
        })

        it('should clamp end to size - 1', () => {
            const range: ByteRangeSpec = { type: 'int-range', start: 0, end: 99999 }
            expect(resolveByteRange(range, 10000)).toEqual({ start: 0, end: 9999 })
        })

        it('should return null if start >= size', () => {
            const range: ByteRangeSpec = { type: 'int-range', start: 10000, end: 20000 }
            expect(resolveByteRange(range, 10000)).toBeNull()
        })

        it('should resolve last byte', () => {
            const range: ByteRangeSpec = { type: 'int-range', start: 9999, end: 9999 }
            expect(resolveByteRange(range, 10000)).toEqual({ start: 9999, end: 9999 })
        })

        it('should resolve first byte', () => {
            const range: ByteRangeSpec = { type: 'int-range', start: 0, end: 0 }
            expect(resolveByteRange(range, 10000)).toEqual({ start: 0, end: 0 })
        })
    })

    describe('suffix-range', () => {
        it('should resolve last N bytes', () => {
            const range: ByteRangeSpec = { type: 'suffix-range', suffixLength: 500 }
            expect(resolveByteRange(range, 10000)).toEqual({ start: 9500, end: 9999 })
        })

        it('should return entire content if suffixLength >= size', () => {
            const range: ByteRangeSpec = { type: 'suffix-range', suffixLength: 20000 }
            expect(resolveByteRange(range, 10000)).toEqual({ start: 0, end: 9999 })
        })

        it('should return null if suffixLength is 0', () => {
            const range: ByteRangeSpec = { type: 'suffix-range', suffixLength: 0 }
            expect(resolveByteRange(range, 10000)).toBeNull()
        })
    })

    describe('open-range', () => {
        it('should resolve from start to end', () => {
            const range: ByteRangeSpec = { type: 'open-range', start: 500 }
            expect(resolveByteRange(range, 10000)).toEqual({ start: 500, end: 9999 })
        })

        it('should resolve from 0 to end', () => {
            const range: ByteRangeSpec = { type: 'open-range', start: 0 }
            expect(resolveByteRange(range, 10000)).toEqual({ start: 0, end: 9999 })
        })

        it('should return null if start >= size', () => {
            const range: ByteRangeSpec = { type: 'open-range', start: 10000 }
            expect(resolveByteRange(range, 10000)).toBeNull()
        })
    })

    describe('zero-size content', () => {
        it('should return null for int-range on empty content', () => {
            const range: ByteRangeSpec = { type: 'int-range', start: 0, end: 0 }
            expect(resolveByteRange(range, 0)).toBeNull()
        })

        it('should return null for suffix-range on empty content', () => {
            const range: ByteRangeSpec = { type: 'suffix-range', suffixLength: 500 }
            expect(resolveByteRange(range, 0)).toBeNull()
        })

        it('should return null for open-range on empty content', () => {
            const range: ByteRangeSpec = { type: 'open-range', start: 0 }
            expect(resolveByteRange(range, 0)).toBeNull()
        })
    })
})
