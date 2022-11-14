# pixijs bundler

The purpose of this script is to generate a single PixiJS packages that can be published. 
This completely circumvents all the issues having to import various packages like various dependency resolutions.

## Running

Generate a local bundle. This will generate a `*.tgz` package in the `./dist` folder which can be imported into a project's package.json (e.g., `"pixijs": "file:./pixijs-[version].tgz`).

```
npm test
```

## Publishing

```
npm run bundle
```

### Flags

* `--version` - Override the version, helpful for doing prerelease (e.g. `7.0.0-alpha`)
* `--dryrun` - Enable to use `npm pack` to generate tarball, otherwise, will publish
* `--tag` - Use a dist-tag pass-through for `npm publish`
