#!/usr/bin/env node
/**
 * Sets or bumps the fork revision in fork.config.json.
 *
 *   yarn fork:revision        # bump by one
 *   yarn fork:revision 1      # set explicitly (use after an upstream version bump)
 *
 * Every rebuild of the same upstream version needs a fresh revision: consumers
 * pin tarball URLs in their lockfile along with an integrity hash, so changing
 * the bytes behind an existing URL breaks their install with EINTEGRITY.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ROOT, listPackages, loadForkConfig } from './fork-utils.mjs';

const [input] = process.argv.slice(2);
const config = loadForkConfig();

let next;
if (input === undefined) {
  next = config.revision + 1;
} else {
  next = Number(input);
  if (!Number.isInteger(next) || next < 1) {
    console.error(`Revision must be an integer >= 1, got "${input}"`);
    process.exit(1);
  }
}

const file = join(ROOT, 'fork.config.json');
const raw = readFileSync(file, 'utf8');
const parsed = JSON.parse(raw);
parsed.revision = next;
writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`);

const upstreamVersion = listPackages().find((p) => p.name === '@excalidraw/excalidraw')?.version ?? '?';

console.log(`Revision ${config.revision} -> ${next}`);
console.log(`Packages will be published as ${upstreamVersion}-${config.tag}.${next}`);
console.log('\nRun `yarn fork:pack` to rebuild the tarballs.');
