import { describe, it, expect, vi, beforeEach } from 'vitest'
import { metrics, logger } from '@sentry/browser'
import { sendEvent } from '../src/sentry'
import type { ModelDownloadCompleteEvent } from '../src/sentry_event'

vi.mock('@sentry/browser', async importOriginal => {
    const actual = await importOriginal<typeof import('@sentry/browser')>()
    return {
        ...actual,
        metrics: {
            ...actual.metrics,
            distribution: vi.fn(),
            count: vi.fn(),
        },
        logger: {
            ...actual.logger,
            info: vi.fn(),
        },
    }
})

describe('sentry sendEvent', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('records model_download.total distribution metric and logs to Sentry on model_download_complete', () => {
        const event: ModelDownloadCompleteEvent = {
            type: 'model_download_complete',
            metrics: {
                totalMs: 12500,
            },
        }

        sendEvent(event)

        expect(metrics.distribution).toHaveBeenCalledWith('model_download.total', 12500, {
            scope: expect.anything(),
            unit: 'millisecond',
        })
        expect(logger.info).toHaveBeenCalledWith(
            'model_download_complete',
            {
                totalMs: 12500,
            },
            {
                scope: expect.anything(),
            },
        )
    })
})
