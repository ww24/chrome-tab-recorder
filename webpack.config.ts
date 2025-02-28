import path from 'path'
import webpack from 'webpack'
import Dotenv from 'dotenv-webpack'
import pkg from './package.json'

const config: webpack.Configuration = {
    entry: {
        offscreen: path.join(__dirname, 'src/offscreen.ts'),
        option: path.join(__dirname, 'src/option.ts'),
        service_worker: path.join(__dirname, 'src/service_worker.ts'),
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
        alias: {
            ebml: 'ebml/lib/ebml.esm.js',
        }
    },
    output: {
        path: path.join(__dirname, 'extension/dist'),
        filename: '[name].js',
    },
    devtool: false,
    plugins: [
        new webpack.SourceMapDevToolPlugin({}),
        new Dotenv(),
        new webpack.DefinePlugin({
            'process.env.VERSION': `"${pkg.version}"`,
        }),
    ],
}

export default config
