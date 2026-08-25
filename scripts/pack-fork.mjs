#!/usr/bin/env node
/**
 * Builds every publishable @excalidraw package and packs it into
 * `dist-packages/` as a tarball installable directly from a URL — no registry.
 *
 *   node scripts/pack-fork.mjs [--skip-build] [--dry-run] [--allow-dirty] [--only a,b]
 *
 * What it does beyond plain `npm pack`:
 *
 *   1. Versions get the fork suffix on their OWN upstream base
 *      (excalidraw 0.18.0-codertapsu.N, fractional-indexing 3.3.0-codertapsu.N)
 *      — applied ephemerally at pack time. Workspace package.json files keep
 *      the pristine upstream versions, so upstream merges never conflict on
 *      version lines. Every rebuild needs a fresh revision: npm caches by URL
 *      and lockfiles pin an integrity hash (EINTEGRITY on mismatch).
 *
 *   2. Intra-repo `@excalidraw/*` dependencies are rewritten to the matching
 *      tarball URLs, so a consumer declares only `@excalidraw/excalidraw` and
 *      npm follows the URLs for the rest. External @excalidraw packages that
 *      live in other repos (laser-pointer, mermaid-to-excalidraw,
 *      random-username) are left pointing at the registry.
 *
 *   3. Provenance (upstream version, fork revision, source commit) is recorded
 *      under `excalidrawFork`, and repository/bugs point at the fork.
 *
 * package.json edits are made in place and always reverted, so a failed run
 * leaves the working tree clean.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import {
  BUILD_COMMANDS,
  ROOT,
  forkVersion,
  gitInfo,
  listPackages,
  loadForkConfig,
  releaseTag,
  run,
  tarballFileName,
  tarballUrl,
  tryRun,
} from './fork-utils.mjs';

const args = process.argv.slice(2);
const skipBuild = args.includes('--skip-build');
const dryRun = args.includes('--dry-run');
const allowDirty = args.includes('--allow-dirty');
const onlyArg = args.indexOf('--only');
const only = onlyArg !== -1 ? (args[onlyArg + 1] ?? '').split(',').filter(Boolean) : null;

const config = loadForkConfig();
const outDir = join(ROOT, config.outDir);

const allPackages = listPackages();
const packages = only ? allPackages.filter((p) => only.includes(p.name)) : allPackages;

if (packages.length === 0) {
  console.error(`No packages matched${only ? ` --only ${only.join(',')}` : ''}.`);
  process.exit(1);
}

const tag = releaseTag(config, allPackages);
const git = gitInfo();

/** name -> forked version, needed to build URLs for cross-package deps */
const versions = new Map(allPackages.map((p) => [p.name, forkVersion(p.version, config)]));

console.log(`\nFork tag     : ${config.tag}`);
console.log(`Revision     : ${config.revision}`);
console.log(`Release tag  : ${tag}`);
console.log(`URL strategy : ${config.urlStrategy}`);
console.log(`Example URL  : ${tarballUrl('@excalidraw/excalidraw', versions.get('@excalidraw/excalidraw'), config, tag)}`);
console.log(`Source       : ${git.shortCommit ?? 'unknown'}${git.dirty ? ' (dirty)' : ''}`);
console.log(`Packages     : ${packages.length}${only ? ` (filtered from ${allPackages.length})` : ''}\n`);

// --- Guards ------------------------------------------------------------------

if (git.dirty && !allowDirty && !dryRun) {
  console.error('Working tree is dirty. Tarballs should be reproducible from a commit.');
  console.error('Commit your changes, or pass --allow-dirty for a local test build.\n');
  process.exit(1);
}

// Republishing an existing tag would serve different bytes from URLs consumers
// have already pinned. Bump the revision instead.
if (!dryRun && config.urlStrategy === 'release') {
  const existing = tryRun('gh', ['release', 'view', tag, '--repo', config.repository, '--json', 'tagName']);
  if (existing) {
    console.error(`Release ${tag} already exists on ${config.repository}.`);
    console.error('Republishing it would break installs that pinned its integrity hash.');
    console.error('Run `yarn fork:revision` to bump, then pack again.\n');
    process.exit(1);
  }
}

// --- Build -------------------------------------------------------------------

if (!skipBuild) {
  console.log('Building packages (root build:packages chain, then utils)\n');
  for (const [command, commandArgs] of BUILD_COMMANDS) {
    run(command, commandArgs);
  }
} else {
  console.log('Skipping build (--skip-build)\n');
}

// --- Pack --------------------------------------------------------------------

/** Rewrites a dependency block, pointing intra-repo packages at their tarballs. */
function rewriteDeps(block) {
  if (!block) return { next: block, changed: [] };

  const next = { ...block };
  const changed = [];

  for (const [dep, range] of Object.entries(block)) {
    if (!versions.has(dep)) continue; // external @excalidraw/* stay on the registry
    next[dep] = tarballUrl(dep, versions.get(dep), config, tag);
    changed.push(`${dep}: ${range} -> tarball`);
  }

  return { next, changed };
}

const backups = new Map();
const manifest = [];

function restoreAll() {
  for (const [file, contents] of backups) writeFileSync(file, contents);
  backups.clear();
}

process.on('SIGINT', () => {
  restoreAll();
  process.exit(130);
});

try {
  if (!dryRun) {
    // Wiping the whole directory would delete the revision-7 tarballs restored
    // in 52ecc7f7, which seven release branches (v4.0.0 - v5.3.0) still pin by
    // raw URL. `dist-packages/*.tgz` is gitignored, so their loss would surface
    // only as five deletions inside a bot release commit — and the branches
    // would fail `npm install` again on a cold cache. Keep anything git tracks
    // and clear the rest.
    const tracked = new Set(
      execFileSync('git', ['ls-files', outDir], { cwd: ROOT, encoding: 'utf8' })
        .trim()
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((rel) => basename(rel)),
    );

    if (existsSync(outDir)) {
      for (const entry of readdirSync(outDir)) {
        if (tracked.has(entry)) continue;
        rmSync(join(outDir, entry), { recursive: true, force: true });
      }
    }
    mkdirSync(outDir, { recursive: true });
  }

  for (const { dir, file, pkg, name } of packages) {
    const absFile = join(ROOT, file);
    backups.set(absFile, readFileSync(absFile, 'utf8'));

    const version = versions.get(name);
    const deps = rewriteDeps(pkg.dependencies);
    const peers = rewriteDeps(pkg.peerDependencies);

    const forked = { ...pkg, version };
    if (deps.next) forked.dependencies = deps.next;
    if (peers.next) forked.peerDependencies = peers.next;

    // Point consumers at the fork, not upstream
    forked.repository = { type: 'git', url: `git+https://github.com/${config.repository}.git` };
    forked.bugs = `https://github.com/${config.repository}/issues`;

    // Publish-time hooks would re-run builds or fail outside the upstream
    // release pipeline; this script builds explicitly above instead.
    if (forked.scripts?.prepublishOnly || forked.scripts?.prepack || forked.scripts?.prepare) {
      forked.scripts = { ...forked.scripts };
      delete forked.scripts.prepublishOnly;
      delete forked.scripts.prepack;
      delete forked.scripts.prepare;
    }

    forked.excalidrawFork = {
      tag: config.tag,
      revision: config.revision,
      releaseTag: tag,
      upstreamVersion: pkg.version,
      upstreamRepository: config.upstreamRepository ?? null,
      builtFrom: config.repository,
      commit: git.commit,
    };

    const rewrites = [...deps.changed, ...peers.changed];
    console.log(`• ${name}@${version}`);
    for (const line of rewrites) console.log(`    ${line}`);

    const entry = {
      name,
      version,
      upstreamVersion: pkg.version,
      tarball: tarballFileName(name, version),
      url: tarballUrl(name, version, config, tag),
    };

    if (dryRun) {
      manifest.push(entry);
      continue;
    }

    writeFileSync(absFile, `${JSON.stringify(forked, null, 2)}\n`);
    run('npm', ['pack', '--silent', '--pack-destination', outDir], { cwd: join(ROOT, dir) });
    manifest.push(entry);
  }
} finally {
  restoreAll();
}

if (dryRun) {
  console.log('\nDry run — nothing written.');
  process.exit(0);
}

// --- Metadata ----------------------------------------------------------------

// Consumers only need the top-level package; npm follows the rewritten URLs
// for the rest of the graph.
const dependencies = { '@excalidraw/excalidraw': manifest.find((m) => m.name === '@excalidraw/excalidraw')?.url };
const allUrls = Object.fromEntries(manifest.map(({ name, url }) => [name, url]));

writeFileSync(
  join(outDir, 'manifest.json'),
  `${JSON.stringify(
    {
      tag: config.tag,
      revision: config.revision,
      releaseTag: tag,
      urlStrategy: config.urlStrategy,
      repository: config.repository,
      commit: git.commit,
      packages: manifest,
    },
    null,
    2,
  )}\n`,
);

writeFileSync(join(outDir, 'dependencies.json'), `${JSON.stringify({ dependencies, allUrls }, null, 2)}\n`);

writeFileSync(
  join(outDir, 'README.md'),
  `# Excalidraw fork packages — \`${tag}\`

Generated by \`yarn fork:pack\` — do not edit by hand.

Built at commit \`${git.shortCommit ?? 'unknown'}\`.

## Install

Only the top-level package needs to be declared — its intra-repo dependencies
point at the sibling tarballs by URL and npm follows them:

\`\`\`json
"@excalidraw/excalidraw": "${dependencies['@excalidraw/excalidraw'] ?? ''}"
\`\`\`

The tarballs are published as assets on the
[\`${tag}\`](https://github.com/${config.repository}/releases/tag/${tag}) release —
they are deliberately **not** committed to git (revisions 1-7 added ~575 MB of
binaries to history that way).

## Rules

- **Never republish a release tag.** Bump \`revision\` in \`fork.config.json\`
  instead — npm caches by URL and lockfiles pin an integrity hash.
- When upgrading, replace the URL and reinstall; every intra-repo dependency
  moves with it automatically.
`,
);

console.log(`\n✔ ${manifest.length} tarballs written to ${config.outDir}/`);
console.log(`\nNext: yarn fork:publish   # creates release ${tag} with these assets\n`);
