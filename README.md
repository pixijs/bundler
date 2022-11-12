# pixijs bundler

The purpose of this script is to generate a single PixiJS packages that can be published. 
This completely circumvents all the issues having to import various packages.

## Building

```
npm run build
```

## Bundles

* `pixijs/browser` (default browser import, aka `pixi.js`)
* `pixijs/browser-legacy` (WebGL and Canvas, aka `pixi.js-legacy`)
* `pixijs/webworker` (WebWorker, aka `@pixi/webworker`)
* `pixijs/node` (node.js, aka `@pixi/node`)

## Supported

* Webpack 5+
* Parcel 2+
* Node.js 16+
