// @ts-check

'use strict'

const path = require('path')
const CopyWebpackPlugin = require('copy-webpack-plugin')

/** @type {import('webpack').Configuration} */
const extensionConfig = {
  target: 'node',

  context: path.join(__dirname),
  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.bundle.js',
    libraryTarget: 'commonjs2',
    devtoolModuleFilenameTemplate: '../../../[resource-path]'
  },
  devtool: 'source-map',
  externals: {
    vscode: 'commonjs vscode',
    canvas: 'commonjs canvas'
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [{
      test: /\.ts$/,
      exclude: /node_modules/,
      use: {
        loader: 'ts-loader'
      }
    }]
  }
}

/** @type {import('webpack').Configuration} */
const viewConfig = {
  context: path.join(__dirname),
  devtool: 'source-map',
  entry: {
    'toc-editor': './src/webview-js/toc-editor/toc-editor.jsx',
    'image-upload': './src/webview-js/image-upload/image-upload.ts',
    'cnxml-preview': './src/webview-js/cnxml-preview/cnxml-preview.js'
  },
  output: {
    path: path.resolve(__dirname, 'dist/static-resources/'),
    filename: '[name].bundle.js',
    devtoolModuleFilenameTemplate: '../../../[resource-path]'
  },
  resolve: {
    extensions: ['.js', '.ts'],
    alias: {
      '~common-api~': path.resolve(__dirname, '../common/src'),
      react: 'preact/compat',
      'react-dom/test-utils': 'preact/test-utils',
      'react-dom': 'preact/compat'
      // webutils: path.resolve(__dirname, 'src/webview-js')
    }
  },
  module: {
    rules: [{
      test: /\.m?tsx?$/,
      exclude: /node_modules/,
      use: {
        loader: 'ts-loader'
      }
    }, {
      test: /\.m?jsx?$/,
      exclude: /node_modules/,
      use: {
        loader: 'babel-loader',
        options: {
          plugins: [
            ['@babel/plugin-transform-react-jsx', {
              pragma: 'h',
              pragmaFrag: 'Fragment'
            }]
          ]
        }
      }
    }, {
      test: /\.css$/i,
      use: ['style-loader', 'css-loader']
    }, {
      test: /\.less$/i,
      use: ['style-loader', 'css-loader', 'less-loader']
    }]
  },
  plugins: [
    // @ts-ignore
    new CopyWebpackPlugin({
      patterns: [{
        from: 'static',
        globOptions: {
          ignore: ["**/*.patch"]
        }
      }]
    })
  ]
}

module.exports = [extensionConfig, viewConfig]