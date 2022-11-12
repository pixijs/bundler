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
        this.targetName = !this.external ? Package.replacements[this.name] ?? this.name.replace('@pixi/', '') : null;
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
        return { ['./' + this.targetName]: JSON.parse(
            JSON.stringify(this.info.exports['.'])
                .replace(/\/lib\//g, `/${this.targetName}/`)
            )
        };
    }

    /** Copy the library the output destination */
    async copy(dest) {
        const targetPath = path.join(dest, this.targetName);
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

    static replacements = {
        'pixi.js': 'browser',
        'pixi.js-legacy': 'browser-legacy',
    };
    static packages = new Map();

    /**
     * Create a new package data object.
     * @param {Package|null} parent - Parent reference
     * @param {string} packageName - Name of the package
     * @param {string} version - Version range required in package.json
     * @param {string} [basePath] - Base path directory auto resolved from node_modules if undefined
     * @returns 
     */
    static async create(parent, packageName, version, basePath) {
        if (!this.packages.has(packageName)) {
            const pkg = new Package(parent, packageName, version, basePath);
            await pkg.load();
            Package.packages.set(packageName, pkg);
        }
        return Package.packages.get(packageName);
    }
}

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

// Create the output directory
console.log('Create output directory');
const outputPath = path.resolve('dist');
await fs.remove(outputPath);
await fs.copy(path.resolve('src'), outputPath);

const libraries = packages.filter(pkg => !pkg.external);

// Update the dist package.json
console.log('Generate package.json');
const defaultPackage = packages.find(pkg => pkg.name === 'pixi.js');
const publishInfo = Object.assign(
    await fs.readJson(path.resolve(outputPath, 'package.json')), {
        dependencies,
        version: defaultPackage.info.version,
        exports: libraries.reduce((acc, pkg) => ({...acc, ...pkg.getExports() }), {}),
        files: libraries.map(pkg => pkg.targetName),
    }
);

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
            "README.md"
        ]
    }
};
// Replace internal package name requests
console.log('Patch internal package names');
await replaceInFiles({
    ...baseReplaceOptions,
    from: /@pixi\//g,
    to: `${publishInfo.name}/`,
});

// Change pixi.js-legacy to new package
await replaceInFiles({
    ...baseReplaceOptions,
    from: /pixi.js-legacy/g,
    to: `${publishInfo.name}/${Package.replacements['pixi.js-legacy']}`,
});

// Change pixi.js to new package name
await replaceInFiles({
    ...baseReplaceOptions,
    from: /pixi.js/g,
    to: `${publishInfo.name}/${Package.replacements['pixi.js']}`,
});

console.log('Package output');
execSync('npm pack', { cwd: outputPath });

console.log('Done');