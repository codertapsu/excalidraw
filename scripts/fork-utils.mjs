import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The package whose version defines the release tag for the whole set. */
export const CANONICAL_PACKAGE = '@excalidraw/excalidraw';

export function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function loadForkConfig() {
  const config = readJSON(join(ROOT, 'fork.config.json'));

  for (const key of ['tag', 'revision', 'repository', 'outDir', 'urlStrategy']) {
    if (config[key] === undefined) {
      throw new Error(`fork.config.json is missing "${key}"`);
    }
  }

  if (!/^[a-z0-9][a-z0-9-]*$/.test(config.tag)) {
    throw new Error(`fork.config.json "tag" must be a lowercase npm-safe identifier, got "${config.tag}"`);
  }

  if (!Number.isInteger(config.revision) || config.revision < 1) {
    throw new Error(`fork.config.json "revision" must be an integer >= 1, got ${config.revision}`);
  }

  if (!['release', 'raw'].includes(config.urlStrategy)) {
    throw new Error(`fork.config.json "urlStrategy" must be "release" or "raw", got "${config.urlStrategy}"`);
  }

  if (config.urlStrategy === 'raw' && !config.branch) {
    throw new Error('fork.config.json needs "branch" when urlStrategy is "raw"');
  }

  return config;
}

/**
 * Build commands, in dependency order. The root `build:packages` script covers
 * the chain common -> fractional-indexing -> math -> element -> excalidraw;
 * utils has its own build and is not part of that chain.
 */
export const BUILD_COMMANDS = [
  ['yarn', ['build:packages']],
  ['yarn', ['--cwd', './packages/utils', 'build:esm']],
];

/** Publishable workspace packages (private: false under packages/). */
export function listPackages() {
  const packagesDir = join(ROOT, 'packages');

  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = join('packages', entry.name);
      const file = join(dir, 'package.json');
      if (!existsSync(join(ROOT, file))) return null;
      const pkg = readJSON(join(ROOT, file));
      return { dir, file, pkg, name: pkg.name, version: pkg.version };
    })
    .filter(Boolean)
    .filter(({ pkg }) => !pkg.private && pkg.name?.startsWith('@excalidraw/'))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** `@excalidraw/fractional-indexing` -> `excalidraw-fractional-indexing` */
export function tarballBaseName(packageName) {
  return packageName.replace(/^@/, '').replace(/\//g, '-');
}

export function forkVersion(baseVersion, config) {
  // Strip any previously applied fork suffix so re-runs stay idempotent
  const upstreamVersion = baseVersion.split(`-${config.tag}.`)[0];
  return `${upstreamVersion}-${config.tag}.${config.revision}`;
}

export function tarballFileName(packageName, version) {
  return `${tarballBaseName(packageName)}-${version}.tgz`;
}

/**
 * The git tag / GitHub release name for this build, derived from the canonical
 * package so every tarball in a release shares one identifier even though the
 * packages have different base versions.
 */
export function releaseTag(config, packages = listPackages()) {
  const canonical = packages.find((p) => p.name === CANONICAL_PACKAGE);
  if (!canonical) {
    throw new Error(`Cannot derive a release tag: ${CANONICAL_PACKAGE} not found`);
  }

  return `${config.releaseTagPrefix ?? 'v'}${forkVersion(canonical.version, config)}`;
}

export function tarballUrl(packageName, version, config, tag) {
  const file = tarballFileName(packageName, version);

  if (config.urlStrategy === 'raw') {
    return `https://raw.githubusercontent.com/${config.repository}/${config.branch}/${config.outDir}/${file}`;
  }

  return `https://github.com/${config.repository}/releases/download/${tag}/${file}`;
}

export function gitInfo() {
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

  try {
    return {
      commit: git('rev-parse', 'HEAD'),
      shortCommit: git('rev-parse', '--short', 'HEAD'),
      dirty: git('status', '--porcelain').length > 0,
    };
  } catch {
    return { commit: null, shortCommit: null, dirty: false };
  }
}

export function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: ROOT,
    stdio: options.capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
    ...options,
  });
}

/** Runs a command, returning null instead of throwing when it fails. */
export function tryRun(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      cwd: ROOT,
      stdio: 'pipe',
      encoding: 'utf8',
      ...options,
    }).trim();
  } catch {
    return null;
  }
}
