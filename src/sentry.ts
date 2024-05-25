import {
    BrowserClient,
    defaultStackParser,
    getDefaultIntegrations,
    makeFetchTransport,
    Scope,
} from '@sentry/browser';
import { Settings } from './element/settings';

// filter integrations that use the global variable
const integrations = getDefaultIntegrations({}).filter(defaultIntegration => {
    return !['BrowserApiErrors', 'TryCatch', 'Breadcrumbs', 'GlobalHandlers'].includes(
        defaultIntegration.name
    );
});

const client = new BrowserClient({
    dsn: process.env.SENTRY_DSN,
    transport: makeFetchTransport,
    stackParser: defaultStackParser,
    integrations: integrations,
});

const scope = new Scope();
scope.setClient(client);

client.init(); // initializing has to be done after setting the client on the scope

export function getScope(): Scope | undefined {
    if (!Settings.getEnableBugTracking()) return;
    return scope;
};

type Event = StopRecordingEvent;

interface StopRecordingEvent {
    type: 'stop_recording';
    tags: {
        duration?: number;
        mimeType?: string;
        videoBitRate?: number;
        audioBitRate?: number;
        recordingResolution?: string;
    };
};

export function sendEvent(e: Event) {
    getScope()?.captureEvent({
        message: e.type,
        level: 'info',
        tags: e.tags,
    });
};
