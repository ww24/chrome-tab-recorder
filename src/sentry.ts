import {
    BrowserClient,
    defaultStackParser,
    getDefaultIntegrations,
    makeFetchTransport,
    Scope,
    logger,
    metrics,
} from '@sentry/browser'
import type { Event, ExceptionMetadata } from './sentry_event'
import { Settings } from './element/settings'
import { Configuration } from './configuration'

// filter integrations that use the global variable
const integrations = getDefaultIntegrations({}).filter(defaultIntegration => {
    return !['BrowserApiErrors', 'TryCatch', 'GlobalHandlers'].includes(
        defaultIntegration.name
    )
})

// ref. https://docs.sentry.io/platforms/javascript/best-practices/shared-environments/
const client = new BrowserClient({
    dsn: process.env.SENTRY_DSN,
    transport: makeFetchTransport,
    stackParser: defaultStackParser,
    integrations: integrations,
    enableLogs: true,
    environment: process.env.ENV_NAME,
})

const scope = new Scope()
scope.setClient(client)

client.init() // initializing has to be done after setting the client on the scope

function getScope(): Scope | undefined {
    const config = Settings.getConfiguration()
    if (!config.enableBugTracking) return
    scope.setUser({ id: config.userId })
    scope.setAttribute('version', process.env.VERSION)
    return scope
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
        const newKey = prefix ? `${prefix}.${key}` : key
        if (isRecord(value)) {
            Object.assign(result, flatten(value, newKey))
        } else {
            result[newKey] = value
        }
    }
    return result
}

export function sendException(e: unknown, meta: ExceptionMetadata) {
    const { exceptionSource } = meta
    getScope()?.captureException(e, { captureContext: { tags: { exceptionSource } } })
}

const METRICS = {
    START: 'recording.start',
    DURATION: 'recording.duration',
    FILESIZE: 'recording.filesize',
}

export function sendEvent(e: Event) {
    const scope = getScope()
    if (scope == null) return

    switch (e.type) {
        case 'start_recording':
            metrics.count(METRICS.START, 1, {
                scope, attributes: { ...flatten(e.tags) },
            })
            const config = Settings.getConfiguration()
            logger.info(e.type, {
                ...flatten(e.tags),
                ...flatten(Configuration.filterForReport(config), 'config')
            }, { scope })
            break

        case 'stop_recording':
            metrics.distribution(METRICS.DURATION, e.metrics.recording.durationSec, {
                scope, unit: 'second',
            })
            metrics.distribution(METRICS.FILESIZE, e.metrics.recording.filesize, {
                scope, unit: 'byte',
            })
            logger.info(e.type, { ...flatten(e.metrics) }, { scope })
            break

        case 'unexpected_stop':
            metrics.distribution(METRICS.DURATION, e.metrics.recording.durationSec, {
                scope, unit: 'second',
            })
            logger.info(e.type, { ...flatten(e.metrics) }, { scope })
            break
    }
}
