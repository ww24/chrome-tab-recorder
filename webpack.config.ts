import path from 'path';
import webpack from 'webpack';

const config: webpack.Configuration = {
    entry: {
        offscreen: path.join(__dirname, 'src/offscreen.ts'),
        option: path.join(__dirname, 'src/option.ts'),
        service_worker: path.join(__dirname, 'src/service_worker.ts'),
        'element': [
            'src/element/confirm.ts',
            'src/element/recordList.ts',
            'src/element/settings.ts',
            'src/element/util.ts'
        ].map(e => path.join(__dirname, e)),
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
        path: path.join(__dirname, 'dist'),
        filename: '[name].js',
    },
    devtool: false,
    plugins: [new webpack.SourceMapDevToolPlugin({})],
};

export default config;
