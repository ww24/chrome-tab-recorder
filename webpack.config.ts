import fs from 'fs'
import path from 'path'
import webpack from 'webpack'
import Dotenv from 'dotenv-webpack'
import pkg from './package.json' with { type: 'json' }
import manifest from './extension/manifest.json' with { type: 'json' }

const manifestPath = path.join(import.meta.dirname, 'extension/manifest.json')
if (manifest.version !== pkg.version) {
    manifest.version = pkg.version
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 4) + '\n')
    console.log(`Updated manifest.json version to ${pkg.version}`)
}

const envName = process.env.ENV_NAME === 'production' ? 'production' : 'develop'
console.log(`${envName} build`)

const config: webpack.Configuration = {
    entry: {
        offscreen: path.join(import.meta.dirname, 'src/offscreen.ts'),
        option: path.join(import.meta.dirname, 'src/option.ts'),
        service_worker: path.join(import.meta.dirname, 'src/service_worker.ts'),
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                use: 'ts-loader',
            }
        ]
    },
    resolve: {
        extensions: ['.ts', '.js'],
    },
    output: {
        path: path.join(import.meta.dirname, 'extension/dist'),
        filename: '[name].js',
        clean: true,
    },
    devtool: false,
    plugins: [
        new webpack.SourceMapDevToolPlugin({}),
        new Dotenv(),
        new webpack.DefinePlugin({
            'process.env.PKG_NAME': JSON.stringify(pkg.name),
            'process.env.VERSION': JSON.stringify(pkg.version),
            'process.env.ENV_NAME': JSON.stringify(envName),
            'process.env.APP_NAME': JSON.stringify(manifest.name),
            'process.env.DEFAULT_TITLE': JSON.stringify(manifest.action.default_title),
        }),
    ],
}

export default config
