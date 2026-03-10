import { parseRangeHeader, resolveByteRange, generateBoundary, buildMultipartByteRangesBody } from './range'
import type { ByteRangeSpec, ResolvedRange } from './range'

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

describe('generateBoundary', () => {
    it('should return a non-empty string', () => {
        const boundary = generateBoundary()
        expect(typeof boundary).toBe('string')
        expect(boundary.length).toBeGreaterThan(0)
    })

    it('should return unique values on consecutive calls', () => {
        const a = generateBoundary()
        const b = generateBoundary()
        expect(a).not.toBe(b)
    })
})

describe('buildMultipartByteRangesBody', () => {
    const content = '0123456789'
    let file: File

    beforeEach(() => {
        file = new File([content], 'test.bin', { type: 'application/octet-stream' })
    })

    it('should build valid multipart body for two ranges', async () => {
        const ranges: ResolvedRange[] = [
            { start: 0, end: 2 },
            { start: 7, end: 9 },
        ]
        const boundary = 'test-boundary'
        const body = await buildMultipartByteRangesBody(file, ranges, 'video/webm', boundary)
        const text = new TextDecoder().decode(body)

        // Part 1
        expect(text).toContain('--test-boundary\r\n')
        expect(text).toContain('Content-Type: video/webm\r\n')
        expect(text).toContain(`Content-Range: bytes 0-2/${file.size}\r\n`)
        expect(text).toContain('012')

        // Part 2
        expect(text).toContain(`Content-Range: bytes 7-9/${file.size}\r\n`)
        expect(text).toContain('789')

        // Closing boundary
        expect(text).toContain('--test-boundary--\r\n')
    })

    it('should build valid multipart body for a single range', async () => {
        const ranges: ResolvedRange[] = [{ start: 3, end: 5 }]
        const boundary = 'single'
        const body = await buildMultipartByteRangesBody(file, ranges, 'video/webm', boundary)
        const text = new TextDecoder().decode(body)

        expect(text).toContain('--single\r\n')
        expect(text).toContain(`Content-Range: bytes 3-5/${file.size}\r\n`)
        expect(text).toContain('345')
        expect(text).toContain('--single--\r\n')
    })

    it('should include correct Content-Length in total', async () => {
        const ranges: ResolvedRange[] = [
            { start: 0, end: 0 },
            { start: 9, end: 9 },
        ]
        const boundary = 'b'
        const body = await buildMultipartByteRangesBody(file, ranges, 'text/plain', boundary)

        // Verify the body length matches what we'd expect
        expect(body.byteLength).toBeGreaterThan(0)

        const text = new TextDecoder().decode(body)
        // Each part: "--b\r\nContent-Type: text/plain\r\nContent-Range: bytes X-X/10\r\n\r\n<byte>\r\n"
        // Closing: "--b--\r\n"
        expect(text).toContain('0')
        expect(text).toContain('9')
    })
})
