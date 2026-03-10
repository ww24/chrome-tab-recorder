export type RangeParseResult =
    | { type: 'ranges'; ranges: Array<{ start: number; end: number }> }
    | { type: 'unsatisfiable' }

/**
 * Parse Range header and return resolved byte ranges.
 * Supports single and multiple byte-ranges (e.g. bytes=0-1023, bytes=500-, bytes=-500, bytes=0-0,2-3).
 * Returns null for headers with unknown range units or syntactically invalid byte-range sets
 * (callers should ignore the Range header and return a full 200 response).
 * Returns { type: 'unsatisfiable' } when the unit is "bytes" but all ranges fall outside the file
 * (callers should return 416).
 */
export function parseRangeHeader(rangeHeader: string, fileSize: number): RangeParseResult | null {
    if (!rangeHeader.startsWith('bytes=')) return null

    const rangesStr = rangeHeader.slice('bytes='.length)
    const parts = rangesStr.split(',')
    const ranges: Array<{ start: number; end: number }> = []

    for (const part of parts) {
        const trimmed = part.trim()
        const match = trimmed.match(/^(\d+)?-(\d+)?$/)
        if (!match) return null

        const [, startStr, endStr] = match
        let start: number
        let end: number

        if (startStr != null && endStr != null) {
            // bytes=start-end
            start = parseInt(startStr, 10)
            end = parseInt(endStr, 10)
            if (start > end) continue
        } else if (startStr != null) {
            // bytes=start-
            start = parseInt(startStr, 10)
            end = fileSize - 1
        } else if (endStr != null) {
            // bytes=-suffix (last N bytes)
            const suffix = parseInt(endStr, 10)
            if (suffix === 0) continue
            start = Math.max(0, fileSize - suffix)
            end = fileSize - 1
        } else {
            return null
        }

        // Skip unsatisfiable ranges
        if (start < 0 || start >= fileSize) continue

        // Clamp end to file size
        if (end >= fileSize) end = fileSize - 1

        ranges.push({ start, end })
    }

    if (ranges.length === 0) {
        return { type: 'unsatisfiable' }
    }

    return { type: 'ranges', ranges }
}
