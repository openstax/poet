const path = require('path');

module.exports = {
  // mode: 'development',
  mode: 'production',
  entry: './src/toc-editor.jsx',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'toc-editor.bundle.js'
  },
  resolve: { 
    alias: { 
      "react": "preact/compat",
      "react-dom/test-utils": "preact/test-utils",
      "react-dom": "preact/compat",
    },
  },
  module: {
    rules: [
      {
        test: /\.m?jsx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            plugins: [
              ["@babel/plugin-transform-react-jsx", {
                pragma: "h",
                pragmaFrag: "Fragment"
              }],
            ]
          }
        }
      },
      {
        test: /\.css$/i,
        use: ["style-loader", "css-loader"],
      },
    ]
  }
};