const { DefinePlugin } = require("webpack");

console.log('服务地址: ', process.env.SERVER);

module.exports = {
  entry: './src/index.ts',
  target: 'node',
  mode: "production",
  output: {
    filename: 'index.js',
    path: __dirname + '/dist',
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/
      }
    ]
  },
  plugins: [
    new DefinePlugin({
      'process.env.SERVER': JSON.stringify(process.env.SERVER || '127.0.0.1:3000')
    })
  ]
}