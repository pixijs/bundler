import fs from 'fs-extra';
import path from 'path';
import { execSync } from 'child_process';
import replaceInFiles from 'replace-in-files';

/** Represents a single package. */
class Package {
    constructor(parent, name, version, basePath) {
        this.parent = parent;
        this.name = name;
        this.version = version;
        this.basePath = basePath ?? path.resolve('node_modules', this.name);
        this.info = null;
        this.dependencies = null;
        this.external = !this.name.startsWith('@pixi/') && !this.name.startsWith('pixi.js');
        this.libPath = !this.external ? path.join(this.basePath, 'lib') : null;
        this.targetName = Package.aliases[this.name] || '';
        this.targetRelativeName = this.targetName.slice(this.targetName.indexOf('/') + 1);
        this.targetPath = this.targetRelativeName.replace(/\//g, '-');
    }
    async load() {
        this.info = await fs.readJson(path.join(this.basePath, 'package.json'));
        this.dependencies = await Promise.all(
            Object.keys(this.info.dependencies || {})
                .map(name => Package.create(this, name, this.info.dependencies[name]))
        );
    }

    /** Get the export inputs */
    getExports() {
        return { ['./' + this.targetRelativeName]: JSON.parse(
            JSON.stringify(this.info.exports['.'])
                .replace(/\/lib\//g, `/${this.targetPath}/`)
            )
        };
    }

    /** Copy the library the output destination */
    async copy(dest) {
        const targetPath = path.join(dest, this.targetPath);
        await fs.copy(this.libPath, targetPath);
        // Copy the global.d.ts file if we have it
        const globalPath = path.join(this.basePath, 'global.d.ts');
        if (await fs.pathExists(globalPath)) {
            await fs.copy(globalPath, path.join(targetPath, 'global.d.ts'));
            await replaceInFiles({
                files: [path.join(targetPath, 'index.d.ts')],
                from: '../global.d.ts',
                to: './global.d.ts',
            });
        }
    }

    /** The cache of all packages found in dependency tree */
    static packages = new Map();

    /** Map of old packages names to new package names */
    static aliases = null;

    /**
     * Create a new package data object.
     * @param {Package|null} parent - Parent reference
     * @param {string} packageName - Name of the package
     * @param {string} version - Version range required in package.json
     * @param {string} [basePath] - Base path directory auto resolved from node_modules if undefined
     * @returns 
     */
    static async create(parent, packageName, version, basePath) {
        if (!Package.aliases) {
            throw new Error('Package aliases not loaded');
        }
        if (!this.packages.has(packageName)) {
            const pkg = new Package(parent, packageName, version, basePath);
            await pkg.load();
            Package.packages.set(packageName, pkg);
        }
        return Package.packages.get(packageName);
    }
}

// Create the output directory
console.log('Create output directory');
const outputPath = path.resolve('dist');
await fs.remove(outputPath);
await fs.copy(path.resolve('src'), outputPath);
Package.aliases = await fs.readJson(path.resolve(outputPath, 'aliases.json'));

// Create a collection of packages
console.log('Source all packages');
await Package.create(null, '.', '*', process.cwd());

// Remove the root package
Package.packages.delete('.');

// Get the packages
const packages = Array.from(Package.packages.values());

// Generate all of the external dependencies
const dependencies = packages
    .filter(pkg => pkg.external && !pkg.parent.external)
    .reduce((acc, pkg) => ({...acc, [pkg.name]: pkg.version}), {});

const libraries = packages.filter(pkg => !pkg.external);

// Update the dist package.json
console.log('Generate package.json');
const defaultPackage = packages.find(pkg => pkg.name === 'pixi.js');
const publishInfo = await fs.readJson(path.resolve(outputPath, 'package.json'));
Object.assign(
    publishInfo, {
        dependencies,
        version: defaultPackage.info.version,
        exports: libraries
            .reduce((acc, pkg) => ({...acc, ...pkg.getExports() }),
            publishInfo.exports
        ),
        files: [...publishInfo.files, ...libraries.map(pkg => pkg.targetPath)].sort(),
    }
);
publishInfo.exports['.'] = publishInfo.exports['./browser'];

// Sort export alphabetically
publishInfo.exports = Object.keys(publishInfo.exports).sort()
    .reduce((acc, key) => ({ ...acc, [key]: publishInfo.exports[key] }), {});

// Create the public package.json
await fs.writeJSON(path.join(outputPath, 'package.json'), publishInfo, { spaces: 2 });

// Copy all the library folders
console.log('Copy all library files');
await Promise.all(libraries.map(pkg => pkg.copy(outputPath)));

const baseReplaceOptions = {
    files: outputPath + '/*/**/*.{mjs,js,ts,map}',
    optionsForFiles: {
        "ignore": [
            "package.json",
            "aliases.json",
            "README.md"
        ]
    }
};
// Replace internal package name requests
console.log('Patch internal package names');

// Convert @pixi/filter-alpha to pixijs/filter/alpha
await replaceInFiles({
    ...baseReplaceOptions,
    from: /@pixi\/filter-([\w-]+)/g,
    to: `${publishInfo.name}/filter/$1`,
});

// Convert @pixi/math-extras to pixijs/math/extras
await replaceInFiles({
    ...baseReplaceOptions,
    from: /@pixi\/(mesh|graphics|math)-(extras)/g,
    to: `${publishInfo.name}/$1/$2`,
});

// Convert @pixi/mixin-cache-as-bitmap to pixijs/display/cache-as-bitmap
await replaceInFiles({
    ...baseReplaceOptions,
    from: /@pixi\/mixin-([\w-]+)/g,
    to: `${publishInfo.name}/display/$1`,
});

// Convert @pixi/canvas-sprite to pixijs/sprite/canvas
await replaceInFiles({
    ...baseReplaceOptions,
    from: /@pixi\/(canvas)-([\w-]+)/g,
    to: `${publishInfo.name}/$2/$1`,
});

// Convert all other packages to pixijs using the same name
await replaceInFiles({
    ...baseReplaceOptions,
    from: /@pixi\//g,
    to: `${publishInfo.name}/`,
});

// Change pixi.js-legacy to new package
await replaceInFiles({
    ...baseReplaceOptions,
    from: /pixi.js-legacy/g,
    to: Package.aliases['pixi.js-legacy'],
});

// Change pixi.js to new package name
await replaceInFiles({
    ...baseReplaceOptions,
    from: /pixi.js/g,
    to: Package.aliases['pixi.js'],
});

console.log('Package output');
execSync('npm pack', { cwd: outputPath });

console.log('Done');