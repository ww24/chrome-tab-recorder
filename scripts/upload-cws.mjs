// Upload extension package to Chrome Web Store using the Chrome Web Store API v2.
// Requires Node.js v22+ (per package.json engines) and the following environment variables:
//   CWS_PUBLISHER_ID - Chrome Web Store publisher ID
//   CWS_ITEM_ID      - Chrome Web Store extension item ID
// Authentication is handled via Application Default Credentials (e.g., google-github-actions/auth).

import fs from 'node:fs'
import { chromewebstore } from '@googleapis/chromewebstore'
import { GoogleAuth } from 'google-auth-library'

const REQUIRED_ENV = ['CWS_PUBLISHER_ID', 'CWS_ITEM_ID']
for (const key of REQUIRED_ENV) {
    if (!process.env[key]) {
        console.error(`Error: environment variable ${key} is required`)
        process.exit(1)
    }
}

const publisherId = process.env.CWS_PUBLISHER_ID
const itemId = process.env.CWS_ITEM_ID
const name = `publishers/${publisherId}/items/${itemId}`
const zipPath = 'extension.zip'

if (!fs.existsSync(zipPath)) {
    console.error(`Error: ${zipPath} not found. Run "npm run build:prod" first.`)
    process.exit(1)
}

const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/chromewebstore'],
})

const cws = chromewebstore({ version: 'v2', auth })

// Upload the extension package
console.log(`Uploading ${zipPath} to Chrome Web Store (item: ${itemId})...`)
const uploadRes = await cws.media.upload({
    name,
    media: {
        mimeType: 'application/zip',
        body: fs.createReadStream(zipPath),
    },
})

console.log('Upload response:', JSON.stringify(uploadRes.data, null, 2))

let { uploadState } = uploadRes.data

// Poll for completion if upload is still in progress
const MAX_POLL = parseInt(process.env.CWS_UPLOAD_MAX_POLL ?? '30', 10)
const POLL_INTERVAL_MS = parseInt(process.env.CWS_UPLOAD_POLL_INTERVAL_MS ?? '5000', 10)

for (let i = 0; i < MAX_POLL && uploadState === 'IN_PROGRESS'; i++) {
    console.log(`Upload in progress, polling status (${i + 1}/${MAX_POLL})...`)
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))

    const statusRes = await cws.publishers.items.fetchStatus({ name })
    console.log('Status response:', JSON.stringify(statusRes.data, null, 2))
    uploadState = statusRes.data.lastAsyncUploadState
}

if (uploadState === 'SUCCEEDED') {
    console.log('Upload completed successfully.')
} else if (uploadState === 'IN_PROGRESS') {
    console.error(
        `Error: upload still in progress after ${MAX_POLL} attempts (${(MAX_POLL * POLL_INTERVAL_MS) / 1000}s). ` +
            'Consider increasing CWS_UPLOAD_MAX_POLL or CWS_UPLOAD_POLL_INTERVAL_MS.',
    )
    process.exit(2)
} else {
    console.error(`Upload failed with state: ${uploadState}`)
    process.exit(1)
}
