/**
 * HTTP Range Request parsing (RFC 9110 Section 14.2)
 * https://www.rfc-editor.org/rfc/rfc9110.html#section-14.2
 */

/**
 * Parsed byte range spec from Range header
 */
export type ByteRangeSpec =
    | { type: 'int-range'; start: number; end: number }
    | { type: 'suffix-range'; suffixLength: number }
    | { type: 'open-range'; start: number }

/**
 * Result of parsing a Range header
 */
export type RangeParseResult =
    | { type: 'bytes'; ranges: ByteRangeSpec[] }
    | { type: 'unsupported' }

/**
 * Parse HTTP Range header value (RFC 9110 Section 14.2)
 *
 * Supports the bytes range-unit:
 *   Range: bytes=0-499
 *   Range: bytes=500-999
 *   Range: bytes=500-
 *   Range: bytes=-500
 *   Range: bytes=0-499,500-999
 *
 * Returns null if the header value is syntactically invalid.
 * Returns { type: 'unsupported' } for non-bytes range units.
 */
export function parseRangeHeader(header: string): RangeParseResult | null {
    const match = header.match(/^([a-zA-Z0-9!#$%&'*+\-.^_`|~]+)=(.+)$/)
    if (!match) return null

    const [, unit, rangeSet] = match
    if (unit !== 'bytes') {
        return { type: 'unsupported' }
    }

    const ranges: ByteRangeSpec[] = []
    const parts = rangeSet.split(',')

    for (const part of parts) {
        const trimmed = part.trim()
        if (trimmed === '') return null

        const rangeMatch = trimmed.match(/^(\d+)?-(\d+)?$/)
        if (!rangeMatch) return null

        const [, startStr, endStr] = rangeMatch

        if (startStr === undefined && endStr === undefined) {
            // "-" alone is invalid
            return null
        }

        if (startStr === undefined) {
            // Suffix range: -N (last N bytes)
            const suffixLength = parseInt(endStr!, 10)
            ranges.push({ type: 'suffix-range', suffixLength })
        } else if (endStr === undefined) {
            // Open-ended range: N-
            ranges.push({ type: 'open-range', start: parseInt(startStr, 10) })
        } else {
            const start = parseInt(startStr, 10)
            const end = parseInt(endStr, 10)
            if (start > end) return null
            ranges.push({ type: 'int-range', start, end })
        }
    }

    if (ranges.length === 0) return null
    return { type: 'bytes', ranges }
}

/**
 * Resolved byte range with concrete start and end positions (inclusive)
 */
export interface ResolvedRange {
    start: number
    end: number
}

/**
 * Resolve a byte range spec against actual content size.
 * Returns resolved [start, end] (inclusive) or null if unsatisfiable.
 *
 * Per RFC 9110 Section 14.1.2:
 * - int-range: start must be < size; end is clamped to size-1
 * - suffix-range: if suffixLength >= size, returns entire content
 * - open-range: start must be < size; end is size-1
 */
export function resolveByteRange(range: ByteRangeSpec, size: number): ResolvedRange | null {
    if (size === 0) return null

    switch (range.type) {
        case 'suffix-range': {
            if (range.suffixLength === 0) return null
            const start = Math.max(0, size - range.suffixLength)
            return { start, end: size - 1 }
        }
        case 'open-range': {
            if (range.start >= size) return null
            return { start: range.start, end: size - 1 }
        }
        case 'int-range': {
            if (range.start >= size) return null
            return { start: range.start, end: Math.min(range.end, size - 1) }
        }
    }
}
