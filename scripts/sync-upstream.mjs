#!/usr/bin/env node
/**
 * Merges upstream (excalidraw/excalidraw) into this fork, keeping the
 * fork's customizations.
 *
 *   node scripts/sync-upstream.mjs [--ref upstream/master] [--check] [--no-branch]
 *
 * `--check` only reports what changed upstream and whether it touches files the
 * fork has modified — it never mutates the working tree.
 *
 * The merge is deliberately a plain `git merge`: the fork's changes live in
 * ordinary commits, so git's own three-way merge preserves them and surfaces
 * genuine conflicts instead of silently picking a side.
 */
import { execFileSync } from 'node:child_process';

import { ROOT, loadForkConfig } from './fork-utils.mjs';

const args = process.argv.slice(2);
const check = args.includes('--check');
const noBranch = args.includes('--no-branch');
const refArg = args.indexOf('--ref');
const ref = refArg !== -1 ? args[refArg + 1] : 'upstream/master';

/** Paths the fork owns outright — conflicts here are expected and resolvable in our favour. */
const FORK_OWNED = [
  'FORK.md',
  'fork.config.json',
  'scripts/fork-utils.mjs',
  'scripts/pack-fork.mjs',
  'scripts/publish-release.mjs',
  'scripts/sync-upstream.mjs',
  'scripts/set-fork-revision.mjs',
  'dist-packages/',
  '.github/workflows/fork-ci.yml',
  '.github/workflows/fork-release.yml',
  '.github/workflows/upstream-sync.yml',
];

function git(...gitArgs) {
  return execFileSync('git', gitArgs, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function gitLive(...gitArgs) {
  return execFileSync('git', gitArgs, { cwd: ROOT, stdio: 'inherit' });
}

const config = loadForkConfig();

// 1. Sanity checks
const remotes = git('remote').split('\n');
if (!remotes.includes('upstream')) {
  console.error('No "upstream" remote. Add it with:');
  console.error('  git remote add upstream https://github.com/excalidraw/excalidraw.git');
  process.exit(1);
}

const dirty = git('status', '--porcelain');
if (dirty && !check) {
  console.error('Working tree is not clean — commit or stash first:\n');
  console.error(dirty);
  process.exit(1);
}

console.log(`Fetching ${ref.split('/')[0]}…`);
git('fetch', 'upstream', '--tags', '--prune');

// 2. What changed upstream?
const mergeBase = git('merge-base', 'HEAD', ref);
const upstreamHead = git('rev-parse', ref);

if (mergeBase === upstreamHead) {
  console.log(`\n✔ Already up to date with ${ref}.`);
  process.exit(0);
}

const incoming = git('log', '--oneline', `${mergeBase}..${ref}`).split('\n').filter(Boolean);
const upstreamFiles = git('diff', '--name-only', `${mergeBase}..${ref}`).split('\n').filter(Boolean);
const forkFiles = git('diff', '--name-only', `${mergeBase}..HEAD`).split('\n').filter(Boolean);

const overlap = upstreamFiles.filter((file) => forkFiles.includes(file));

console.log(`\n${incoming.length} upstream commit(s) to merge:\n`);
for (const line of incoming.slice(0, 20)) console.log(`  ${line}`);
if (incoming.length > 20) console.log(`  … and ${incoming.length - 20} more`);

console.log(`\n${upstreamFiles.length} file(s) changed upstream.`);

if (overlap.length > 0) {
  console.log(`\n⚠ ${overlap.length} of them are also modified by this fork — expect conflicts:\n`);
  for (const file of overlap) {
    const owned = FORK_OWNED.some((p) => file === p || file.startsWith(p));
    console.log(`  ${file}${owned ? '   (fork-owned — keep ours)' : ''}`);
  }
} else {
  console.log('\n✔ No overlap with fork-modified files — the merge should be clean.');
}

// Upstream version bumps matter: they change what our tarball versions are based on
const versionBump = upstreamFiles.some((f) => f.endsWith('package.json'));
if (versionBump) {
  console.log('\nℹ package.json files changed upstream — check whether the version moved.');
  console.log('  After merging, reset the fork revision:  yarn fork:revision 1');
}

if (check) {
  console.log('\n(--check: nothing was modified)');
  process.exit(0);
}

// 3. Merge on a branch so master stays usable if it goes badly
const branch = `sync/upstream-${upstreamHead.slice(0, 7)}`;

if (!noBranch) {
  console.log(`\nCreating branch ${branch}`);
  git('checkout', '-b', branch);
}

console.log(`Merging ${ref}…\n`);

try {
  gitLive('merge', '--no-ff', ref, '-m', `chore: sync with upstream ${upstreamHead.slice(0, 7)}`);
} catch {
  console.log('\n⚠ Merge stopped with conflicts. Resolve them, then:\n');
  console.log('    git add <files> && git commit');
  console.log('    yarn build && yarn test:run');
  console.log('    yarn fork:pack\n');
  console.log('Fork-owned files listed above should keep OUR version:');
  console.log('    git checkout --ours <file>\n');
  process.exit(1);
}

console.log('\n✔ Merged cleanly.\n');
console.log('Next:');
console.log('  1. yarn install            # upstream may have changed dependencies');
console.log('  2. yarn build && yarn test:run');
console.log(`  3. yarn fork:revision <n>  # reset to 1 on a new upstream version, else bump`);
console.log('  4. yarn fork:pack');
console.log(`  5. git push -u origin ${noBranch ? config.branch : branch}`);
