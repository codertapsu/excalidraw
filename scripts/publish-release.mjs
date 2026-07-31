#!/usr/bin/env node
/**
 * Publishes the tarballs in `dist-packages/` as a GitHub release.
 *
 *   node scripts/publish-release.mjs [--draft] [--notes-only]
 *
 * The release tag is the single source of truth for a build: every tarball's
 * internal `@excalidraw/*` URLs point at `releases/download/<tag>/…`, so the assets
 * must be attached to exactly that tag or the cross-references 404.
 *
 * Refuses to overwrite an existing release — republishing a tag would serve
 * different bytes from URLs consumers have already pinned in their lockfile.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ROOT, loadForkConfig, run, tryRun } from './fork-utils.mjs';

const args = process.argv.slice(2);
const draft = args.includes('--draft');
const notesOnly = args.includes('--notes-only');

const config = loadForkConfig();
const outDir = join(ROOT, config.outDir);
const manifestPath = join(outDir, 'manifest.json');

if (!existsSync(manifestPath)) {
  console.error(`No ${config.outDir}/manifest.json — run \`yarn fork:pack\` first.`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const { releaseTag: tag, packages } = manifest;

if (manifest.revision !== config.revision) {
  console.error(`dist-packages/ was built for revision ${manifest.revision}, but fork.config.json says ${config.revision}.`);
  console.error('Run `yarn fork:pack` again.\n');
  process.exit(1);
}

// Every asset must exist, or the release would be missing cross-referenced tarballs
const assets = packages.map(({ tarball }) => join(outDir, tarball));
const missing = assets.filter((path) => !existsSync(path));

if (missing.length > 0) {
  console.error(`${missing.length} tarball(s) missing from ${config.outDir}/ — run \`yarn fork:pack\`:`);
  for (const path of missing.slice(0, 5)) console.error(`  ${path}`);
  process.exit(1);
}

if (!tryRun('gh', ['--version'])) {
  console.error('The GitHub CLI (`gh`) is required. See https://cli.github.com');
  process.exit(1);
}

const existing = tryRun('gh', ['release', 'view', tag, '--repo', config.repository, '--json', 'tagName']);
if (existing && !notesOnly) {
  console.error(`Release ${tag} already exists on ${config.repository}.`);
  console.error('Republishing would break installs that pinned its integrity hash.');
  console.error('Run `yarn fork:revision`, `yarn fork:pack`, then publish again.\n');
  process.exit(1);
}

// --- Release notes -----------------------------------------------------------

const previousTag = tryRun('git', ['describe', '--tags', '--abbrev=0', '--match', `${config.releaseTagPrefix ?? 'v'}*-${config.tag}.*`, 'HEAD^']);

const changelog = previousTag
  ? tryRun('git', ['log', '--no-merges', '--pretty=format:- %s', `${previousTag}..HEAD`])
  : tryRun('git', ['log', '--no-merges', '--pretty=format:- %s', '-15']);

const installBlock = packages
  .filter(({ name }) => name === '@excalidraw/excalidraw')
  .map(({ name, url }) => `  "${name}": "${url}"`)
  .join(',\n');

const notes = `Fork build of upstream **v${packages[0].upstreamVersion}**, revision \`${config.tag}.${config.revision}\`.

## Install

All ${packages.length} packages are attached to this release, but consumers only
need the top-level entry below — its intra-repo dependencies point at the
sibling tarballs by URL and npm follows them automatically.

\`\`\`json
${installBlock}
\`\`\`

You also need \`react\` and \`react-dom\` in your own dependencies — they are peers.

**Never republish a release tag.** npm caches by URL and lockfiles pin an integrity
hash — a changed asset behind an existing URL fails installs with \`EINTEGRITY\`.
Bump the revision (\`yarn fork:revision\`) instead.

These URLs are immutable: release assets cannot be silently replaced the way a
\`raw.githubusercontent.com/<branch>/…\` path can.

## Changes${previousTag ? ` since ${previousTag}` : ''}

${changelog || '- (no commits recorded)'}

---

Built from \`${(manifest.commit ?? '').slice(0, 7)}\`. See
[FORK.md](https://github.com/${config.repository}/blob/${config.branch ?? 'master'}/FORK.md)
for the release and upstream-sync workflow.
`;

const notesPath = join(outDir, 'RELEASE_NOTES.md');
writeFileSync(notesPath, notes);

if (notesOnly) {
  console.log(notes);
  console.log(`\n(notes written to ${config.outDir}/RELEASE_NOTES.md — nothing published)`);
  process.exit(0);
}

// --- Publish -----------------------------------------------------------------

console.log(`\nPublishing ${tag} to ${config.repository} with ${assets.length} assets…\n`);

run('gh', [
  'release',
  'create',
  tag,
  '--repo',
  config.repository,
  '--target',
  config.branch ?? 'master',
  '--title',
  `${tag} — Excalidraw fork`,
  '--notes-file',
  notesPath,
  ...(draft ? ['--draft'] : []),
  ...assets,
]);

console.log(`\n✔ https://github.com/${config.repository}/releases/tag/${tag}\n`);
