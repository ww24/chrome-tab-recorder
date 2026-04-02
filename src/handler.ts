/**
 * REST API handler for recording storage
 *
 * Extracted from service_worker.ts for testability.
 * Implements HTTP Range Requests per RFC 9110 Section 14.
 */

import type { RecordingStorage } from './storage'
import { getMimeTypeFromExtension } from './mime'
import { parseRangeHeader, resolveByteRange, generateBoundary, buildMultipartByteRangesBody } from './range'
import type { ResolvedRange } from './range'
import type { Resolution, VideoRecordingMode } from './configuration'

const API_PREFIX = '/api/'

/**
 * Parse API path and extract route information
 */
export function parseApiPath(pathname: string): { route: string; name?: string } | null {
    if (!pathname.startsWith(API_PREFIX)) return null

    const path = pathname.slice(API_PREFIX.length)

    // GET /api/storage/estimate
    if (path === 'storage/estimate') {
        return { route: 'storage-estimate' }
    }

    // GET /api/recordings
    if (path === 'recordings') {
        return { route: 'recordings-list' }
    }

    // /api/recordings/:name
    const recordingMatch = path.match(/^recordings\/(.+)$/)
    if (recordingMatch) {
        let name: string
        try {
            name = decodeURIComponent(recordingMatch[1])
        } catch {
            // Malformed percent-encoding in recording name
            return null
        }

        // Reject decoded names containing path separators
        if (name.includes('/') || name.includes('\\')) {
            return null
        }
        return { route: 'recording', name }
    }

    return null
}

export interface RecordingState {
    isRecording: boolean;
    startAtMs?: number;
    screenSize?: Resolution;
    recordingMode?: VideoRecordingMode;
    micEnabled?: boolean;
    stopAtMs?: number;
}

/**
 * Handle API requests for recording storage
 *
 * Supports:
 * - GET  /api/storage/estimate       - Storage quota info
 * - GET  /api/recordings             - List recordings
 * - GET  /api/recordings/:name       - Download recording (with Range Request support)
 * - DELETE /api/recordings/:name     - Delete recording
 */
export async function handleApiRequest(request: Request, storage: RecordingStorage, state: RecordingState): Promise<Response> {
    const url = new URL(request.url)
    const parsed = parseApiPath(url.pathname)

    if (!parsed) {
        return new Response(JSON.stringify({ error: 'Not Found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
        })
    }

    try {
        switch (parsed.route) {
            case 'storage-estimate': {
                if (request.method !== 'GET') {
                    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
                        status: 405,
                        headers: { 'Content-Type': 'application/json' },
                    })
                }
                const estimate = await storage.estimate()
                return new Response(JSON.stringify(estimate), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                })
            }

            case 'recordings-list': {
                if (request.method !== 'GET') {
                    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
                        status: 405,
                        headers: { 'Content-Type': 'application/json' },
                    })
                }
                // Parse sort query parameter
                const sortParam = url.searchParams.get('sort')
                const sort = sortParam === 'desc' ? 'desc' : 'asc'
                const recordings = (await storage.list({ sort })).map(r => ({
                    ...r,
                    isRecording: state.isRecording && state.startAtMs != null && r.recordedAt === state.startAtMs,
                }))
                return new Response(JSON.stringify(recordings), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                })
            }

            case 'recording': {
                const name = parsed.name!

                if (request.method === 'DELETE') {
                    await storage.delete(name)
                    return new Response(null, { status: 204 })
                }

                if (request.method !== 'GET') {
                    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
                        status: 405,
                        headers: { 'Content-Type': 'application/json' },
                    })
                }

                // GET /api/recordings/:name - return binary file
                const file = await storage.getFile(name)
                if (!file) {
                    return new Response(JSON.stringify({ error: 'Not Found' }), {
                        status: 404,
                        headers: { 'Content-Type': 'application/json' },
                    })
                }
                const mimeType = getMimeTypeFromExtension(name)
                const headers: Record<string, string> = {
                    'Content-Type': mimeType,
                    'Accept-Ranges': 'bytes',
                }
                // Add Content-Disposition header only when download=true is specified
                if (url.searchParams.get('download') === 'true') {
                    const encodedName = encodeURIComponent(name).replace(/'/g, '%27')
                    headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodedName}`
                }

                // Handle Range requests (RFC 9110 Section 14)
                const rangeHeader = request.headers.get('Range')
                if (rangeHeader) {
                    const rangeResult = parseRangeHeader(rangeHeader)
                    if (rangeResult && rangeResult.type === 'bytes' && rangeResult.ranges.length > 0) {
                        // Resolve all ranges; collect satisfiable ones
                        const resolvedRanges: ResolvedRange[] = []
                        for (const spec of rangeResult.ranges) {
                            const resolved = resolveByteRange(spec, file.size)
                            if (resolved) {
                                resolvedRanges.push(resolved)
                            }
                        }

                        if (resolvedRanges.length === 0) {
                            // No satisfiable ranges (RFC 9110 Section 15.3.7)
                            return new Response(null, {
                                status: 416,
                                headers: {
                                    ...headers,
                                    'Content-Range': `bytes */${file.size}`,
                                },
                            })
                        }

                        if (resolvedRanges.length === 1) {
                            // Single satisfiable range
                            const { start, end } = resolvedRanges[0]
                            const contentLength = end - start + 1
                            headers['Content-Range'] = `bytes ${start}-${end}/${file.size}`
                            headers['Content-Length'] = contentLength.toString()
                            return new Response(file.slice(start, end + 1), {
                                status: 206,
                                headers,
                            })
                        }

                        // Multiple satisfiable ranges → multipart/byteranges (RFC 9110 Section 14.6)
                        const boundary = generateBoundary()
                        const body = await buildMultipartByteRangesBody(file, resolvedRanges, mimeType, boundary)
                        return new Response(body.buffer, {
                            status: 206,
                            headers: {
                                ...headers,
                                'Content-Type': `multipart/byteranges; boundary=${boundary}`,
                                'Content-Length': body.byteLength.toString(),
                            },
                        })
                    }
                    // If range is syntactically invalid or unsupported unit,
                    // ignore and return full response (RFC 9110 Section 14.2)
                }

                // Full response
                headers['Content-Length'] = file.size.toString()
                return new Response(file, {
                    status: 200,
                    headers,
                })
            }

            default:
                return new Response(JSON.stringify({ error: 'Not Found' }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' },
                })
        }
    } catch (e) {
        console.error('API error:', e)
        return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        })
    }
}
