import { readFileSync } from 'fs'
import path from 'path'
import { defineConfig, Plugin } from 'vite'
import { marked } from 'marked'

const docsDir = import.meta.dirname
const privacyMdFiles = {
    en: path.resolve(docsDir, 'PRIVACY.md'),
    ja: path.resolve(docsDir, 'PRIVACY_JA.md'),
}
const privacyTemplate = path.resolve(docsDir, 'privacy.html')

function loadPrivacy() {
    return {
        privacyEn: marked.parse(readFileSync(privacyMdFiles.en, 'utf-8')) as string,
        privacyJa: marked.parse(readFileSync(privacyMdFiles.ja, 'utf-8')) as string,
    }
}

const privacyPages = [
    { fileName: 'PRIVACY.html', lang: 'en', title: 'Privacy Policy', contentKey: 'privacyEn' as const },
    { fileName: 'PRIVACY_JA.html', lang: 'ja', title: 'プライバシーポリシー', contentKey: 'privacyJa' as const },
]

function renderPrivacyPage(templateHtml: string, page: (typeof privacyPages)[number], content: string): string {
    return templateHtml
        .replace(/<%=\s*lang\s*%>/g, () => page.lang)
        .replace(/<%=\s*title\s*%>/g, () => page.title)
        .replace(/<%=\s*content\s*%>/g, () => content)
}

function docsPlugin(): Plugin[] {
    const buildPlugin: Plugin = {
        name: 'docs-build',
        apply: 'build',
        transformIndexHtml: {
            order: 'pre',
            handler(html) {
                const vars = loadPrivacy()
                return html.replace(/<%=\s*(\w+)\s*%>/g, (_, key) => {
                    return (vars as Record<string, string>)[key] ?? ''
                })
            },
        },
        buildStart() {
            const vars = loadPrivacy()
            const templateHtml = readFileSync(privacyTemplate, 'utf-8')

            for (const page of privacyPages) {
                this.emitFile({
                    type: 'asset',
                    fileName: page.fileName,
                    source: renderPrivacyPage(templateHtml, page, vars[page.contentKey]),
                })
            }

            // Copy extension icon
            const iconData = readFileSync(path.resolve(docsDir, '..', 'extension/icons/icon128.png'))
            this.emitFile({ type: 'asset', fileName: 'icon128.png', source: iconData })
        },
    }

    const servePlugin: Plugin = {
        name: 'docs-serve',
        apply: 'serve',
        transformIndexHtml: {
            order: 'pre',
            handler(html) {
                const vars = loadPrivacy()
                return html.replace(/<%=\s*(\w+)\s*%>/g, (_, key) => {
                    return (vars as Record<string, string>)[key] ?? ''
                })
            },
        },
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                // Serve privacy pages
                const match = privacyPages.find(p => req.url === '/' + p.fileName)
                if (match) {
                    const vars = loadPrivacy()
                    const templateHtml = readFileSync(privacyTemplate, 'utf-8')
                    const html = renderPrivacyPage(templateHtml, match, vars[match.contentKey])
                    // Inject Vite HMR client for hot reload
                    const injected = html.replace(
                        '</head>',
                        '  <script type="module" src="/@vite/client"></script>\n</head>',
                    )
                    res.setHeader('Content-Type', 'text/html')
                    res.end(injected)
                    return
                }
                // Serve extension icon
                if (req.url === '/icon128.png') {
                    const iconData = readFileSync(path.resolve(docsDir, '..', 'extension/icons/icon128.png'))
                    res.setHeader('Content-Type', 'image/png')
                    res.end(iconData)
                    return
                }
                next()
            })
            // Watch markdown files and privacy template for reload
            server.watcher.add([privacyMdFiles.en, privacyMdFiles.ja, privacyTemplate])
            server.watcher.on('change', changedPath => {
                if (
                    changedPath === privacyMdFiles.en ||
                    changedPath === privacyMdFiles.ja ||
                    changedPath === privacyTemplate
                ) {
                    server.ws.send({ type: 'full-reload' })
                }
            })
        },
    }

    return [buildPlugin, servePlugin]
}

export default defineConfig({
    root: docsDir,
    server: {
        port: 8080,
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
    },
    plugins: [docsPlugin()],
    base: './',
})
