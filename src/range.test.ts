import { parseRangeHeader } from './range'

describe('parseRangeHeader', () => {
    const fileSize = 1000

    describe('returns null for non-bytes units or syntactically invalid input', () => {
        it('returns null for unknown range unit', () => {
            expect(parseRangeHeader('items=0-100', fileSize)).toBeNull()
        })

        it('returns null for empty string', () => {
            expect(parseRangeHeader('', fileSize)).toBeNull()
        })

        it('returns null for missing bytes= prefix', () => {
            expect(parseRangeHeader('0-100', fileSize)).toBeNull()
        })

        it('returns null when a range part has invalid syntax', () => {
            expect(parseRangeHeader('bytes=abc-def', fileSize)).toBeNull()
        })

        it('returns null for bytes=- (both start and end missing)', () => {
            expect(parseRangeHeader('bytes=-', fileSize)).toBeNull()
        })
    })

    describe('returns unsatisfiable when all ranges are outside the file', () => {
        it('returns unsatisfiable for start beyond file size', () => {
            expect(parseRangeHeader('bytes=1000-1999', fileSize)).toEqual({ type: 'unsatisfiable' })
        })

        it('returns unsatisfiable for start equal to file size', () => {
            expect(parseRangeHeader('bytes=1000-', fileSize)).toEqual({ type: 'unsatisfiable' })
        })

        it('returns unsatisfiable for suffix of 0 bytes', () => {
            expect(parseRangeHeader('bytes=-0', fileSize)).toEqual({ type: 'unsatisfiable' })
        })

        it('returns unsatisfiable when multiple ranges are all beyond file size', () => {
            expect(parseRangeHeader('bytes=1000-1999,2000-2999', fileSize)).toEqual({ type: 'unsatisfiable' })
        })
    })

    describe('single range', () => {
        it('parses explicit start-end range', () => {
            expect(parseRangeHeader('bytes=0-499', fileSize)).toEqual({
                type: 'ranges',
                ranges: [{ start: 0, end: 499 }],
            })
        })

        it('parses open-ended range (bytes=500-)', () => {
            expect(parseRangeHeader('bytes=500-', fileSize)).toEqual({
                type: 'ranges',
                ranges: [{ start: 500, end: 999 }],
            })
        })

        it('parses suffix range (bytes=-200)', () => {
            expect(parseRangeHeader('bytes=-200', fileSize)).toEqual({
                type: 'ranges',
                ranges: [{ start: 800, end: 999 }],
            })
        })

        it('clamps end to last byte when end exceeds file size', () => {
            expect(parseRangeHeader('bytes=0-9999', fileSize)).toEqual({
                type: 'ranges',
                ranges: [{ start: 0, end: 999 }],
            })
        })

        it('parses range for the entire file', () => {
            expect(parseRangeHeader('bytes=0-999', fileSize)).toEqual({
                type: 'ranges',
                ranges: [{ start: 0, end: 999 }],
            })
        })

        it('parses single-byte range (bytes=0-0)', () => {
            expect(parseRangeHeader('bytes=0-0', fileSize)).toEqual({
                type: 'ranges',
                ranges: [{ start: 0, end: 0 }],
            })
        })

        it('parses last byte (bytes=999-999)', () => {
            expect(parseRangeHeader('bytes=999-999', fileSize)).toEqual({
                type: 'ranges',
                ranges: [{ start: 999, end: 999 }],
            })
        })

        it('handles suffix range larger than file size (clamps to full file)', () => {
            expect(parseRangeHeader('bytes=-9999', fileSize)).toEqual({
                type: 'ranges',
                ranges: [{ start: 0, end: 999 }],
            })
        })
    })

    describe('multiple ranges', () => {
        it('parses two explicit ranges', () => {
            expect(parseRangeHeader('bytes=0-0,2-3', fileSize)).toEqual({
                type: 'ranges',
                ranges: [
                    { start: 0, end: 0 },
                    { start: 2, end: 3 },
                ],
            })
        })

        it('parses three ranges', () => {
            expect(parseRangeHeader('bytes=0-99,200-299,500-599', fileSize)).toEqual({
                type: 'ranges',
                ranges: [
                    { start: 0, end: 99 },
                    { start: 200, end: 299 },
                    { start: 500, end: 599 },
                ],
            })
        })

        it('handles spaces around commas', () => {
            expect(parseRangeHeader('bytes=0-0, 2-3', fileSize)).toEqual({
                type: 'ranges',
                ranges: [
                    { start: 0, end: 0 },
                    { start: 2, end: 3 },
                ],
            })
        })

        it('skips unsatisfiable ranges among satisfiable ones', () => {
            expect(parseRangeHeader('bytes=0-99,1000-1999', fileSize)).toEqual({
                type: 'ranges',
                ranges: [{ start: 0, end: 99 }],
            })
        })

        it('skips invalid (start > end) sub-ranges', () => {
            expect(parseRangeHeader('bytes=0-99,200-100', fileSize)).toEqual({
                type: 'ranges',
                ranges: [{ start: 0, end: 99 }],
            })
        })

        it('returns unsatisfiable when all ranges in multi-range are unsatisfiable', () => {
            expect(parseRangeHeader('bytes=1000-1099,2000-2099', fileSize)).toEqual({
                type: 'unsatisfiable',
            })
        })

        it('returns null when one part has invalid syntax in a multi-range request', () => {
            expect(parseRangeHeader('bytes=0-99,abc-def', fileSize)).toBeNull()
        })
    })
})
