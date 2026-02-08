import path from 'path'
import { readFileSync } from 'fs'
import webpack from 'webpack'
import HtmlWebpackPlugin from 'html-webpack-plugin'
import CopyWebpackPlugin from 'copy-webpack-plugin'
import { marked } from 'marked'

function loadMarkdown(filePath: string): string {
    const markdown = readFileSync(filePath, 'utf-8')
    return marked.parse(markdown) as string
}

const privacyEn = loadMarkdown(path.join(__dirname, 'PRIVACY.md'))
const privacyJa = loadMarkdown(path.join(__dirname, 'PRIVACY_JA.md'))

const config: webpack.Configuration = {
    entry: path.join(__dirname, 'src/site.ts'),
    output: {
        path: path.join(__dirname, 'dist'),
        filename: 'site.js',
        clean: true,
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                use: {
                    loader: 'ts-loader',
                    options: {
                        configFile: path.join(__dirname, 'tsconfig.json'),
                    },
                },
            },
        ],
    },
    resolve: {
        extensions: ['.ts', '.js'],
    },
    plugins: [
        new HtmlWebpackPlugin({
            template: path.join(__dirname, 'index.html'),
            templateParameters: {
                privacyEn,
                privacyJa,
            },
            inject: 'body',
            minify: false,
        }),
        new HtmlWebpackPlugin({
            template: path.join(__dirname, 'privacy.html'),
            filename: 'PRIVACY.html',
            templateParameters: {
                lang: 'en',
                title: 'Privacy Policy',
                content: privacyEn,
            },
            inject: false,
            minify: false,
        }),
        new HtmlWebpackPlugin({
            template: path.join(__dirname, 'privacy.html'),
            filename: 'PRIVACY_JA.html',
            templateParameters: {
                lang: 'ja',
                title: 'プライバシーポリシー',
                content: privacyJa,
            },
            inject: false,
            minify: false,
        }),
        new CopyWebpackPlugin({
            patterns: [
                { from: path.join(__dirname, '..', 'extension/icons/icon128.png'), to: 'icon128.png' },
            ],
        }),
    ],
    devtool: false,
}

export default config
