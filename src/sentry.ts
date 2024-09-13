import {
    BrowserClient,
    defaultStackParser,
    getDefaultIntegrations,
    makeFetchTransport,
    Scope,
    metrics,
} from '@sentry/browser'
import { Settings } from './element/settings'
import { VideoRecordingMode } from './configuration'

// filter integrations that use the global variable
const integrations = getDefaultIntegrations({}).filter(defaultIntegration => {
    return !['BrowserApiErrors', 'TryCatch', 'Breadcrumbs', 'GlobalHandlers'].includes(
        defaultIntegration.name
    )
})

const client = new BrowserClient({
    dsn: process.env.SENTRY_DSN,
    transport: makeFetchTransport,
    stackParser: defaultStackParser,
    integrations: integrations,
})

const scope = new Scope()
scope.setClient(client)

client.init() // initializing has to be done after setting the client on the scope

function getScope(): Scope | undefined {
    if (!Settings.getEnableBugTracking()) return
    scope.setUser({ id: Settings.getUserId() })
    return scope
}

type Event = StopRecordingEvent;

interface StopRecordingEvent {
    type: 'stop_recording';
    tags: {
        mimeType?: string;
        videoBitRate?: number;
        audioBitRate?: number;
        recordingResolution?: string;
        recordingMode?: VideoRecordingMode;
        version?: string;
    };
    metrics: {
        duration?: number;
    };
};

export function sendException(e: unknown) {
    getScope()?.captureException(e, {
        captureContext: {
            tags: {
                version: process.env.VERSION,
            },
        },
    })
}

export function sendEvent(e: Event) {
    const scope = getScope()
    if (scope == null) return

    e.tags.version = process.env.VERSION
    scope.captureEvent({
        message: e.type,
        level: 'info',
        tags: e.tags,
    })

    const userId = Settings.getUserId()
    const tags = { ...e.tags, userId }
    if (e.metrics.duration != null) {
        metrics.distribution(e.type + '_duration', e.metrics.duration, {
            tags,
            client,
        })
    }
}
