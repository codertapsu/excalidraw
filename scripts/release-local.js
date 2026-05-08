#!/usr/bin/env node

/**
 * release-local.js
 *
 * Local-release workflow for the codertapsu/excalidraw fork. Mirrors the
 * Yoopta-Editor scripts/release-local.js pattern but adapted for yarn
 * workspaces (no lerna).
 *
 * Steps:
 *   1. Build all @excalidraw packages at the current versions
 *   2. Bump every package.json (and cross-package deps) to <new-version>
 *   3. Pack each package into dist-packages/
 *   4. Commit dist-packages and the bumped package.json files
 *   5. Push to the `secondary` git remote
 *
 * Usage:
 *   node scripts/release-local.js <new-version>
 *
 * Example:
 *   node scripts/release-local.js 0.18.0-codertapsu.1
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const PACKAGES = [
  "common",
  "fractional-indexing",
  "math",
  "element",
  "utils",
  "excalidraw",
];

const REPO_ROOT = path.resolve(__dirname, "..");
const PACKAGES_DIR = path.join(REPO_ROOT, "packages");
const SECONDARY_REMOTE = "secondary";

function run(command, opts = {}) {
  console.log(`\n> ${command}`);
  execSync(command, {
    encoding: "utf8",
    stdio: "inherit",
    cwd: REPO_ROOT,
    ...opts,
  });
}

function runCapture(command, opts = {}) {
  return execSync(command, {
    encoding: "utf8",
    cwd: REPO_ROOT,
    ...opts,
  }).trim();
}

function pkgJsonPath(name) {
  return path.join(PACKAGES_DIR, name, "package.json");
}

function bumpVersions(version) {
  const pending = new Map();

  for (const name of PACKAGES) {
    const filePath = pkgJsonPath(name);
    const pkg = JSON.parse(fs.readFileSync(filePath, "utf8"));

    pkg.version = version;

    for (const depKey of ["dependencies", "devDependencies", "peerDependencies"]) {
      const deps = pkg[depKey];
      if (!deps) continue;
      for (const sibling of PACKAGES) {
        const fullName = `@excalidraw/${sibling}`;
        if (deps[fullName] !== undefined) {
          deps[fullName] = version;
        }
      }
    }

    pending.set(filePath, JSON.stringify(pkg, null, 2) + "\n");
  }

  // Write only after every file has been parsed/transformed successfully.
  for (const [filePath, content] of pending) {
    fs.writeFileSync(filePath, content, "utf8");
  }
}

function buildPackages() {
  // build:packages covers common, fractional-indexing, math, element, excalidraw.
  // utils builds independently via its own build:esm script.
  run("yarn build:packages");
  run("yarn --cwd ./packages/utils build:esm");
}

function gitRemoteExists(name) {
  try {
    runCapture(`git remote get-url ${name}`);
    return true;
  } catch {
    return false;
  }
}

function gitHasChanges(pathSpec) {
  const status = runCapture(`git status --porcelain -- ${pathSpec}`);
  return status.length > 0;
}

function main() {
  const version = process.argv[2];

  if (!version) {
    console.error("\nVersion argument is required.\n");
    console.log("Usage:");
    console.log("  node scripts/release-local.js <new-version>\n");
    console.log("Example:");
    console.log("  node scripts/release-local.js 0.18.0-codertapsu.1\n");
    process.exit(1);
  }

  if (!gitRemoteExists(SECONDARY_REMOTE)) {
    console.error(
      `\nGit remote "${SECONDARY_REMOTE}" not found. Add it with:\n  git remote add ${SECONDARY_REMOTE} <url>\n`,
    );
    process.exit(1);
  }

  const branch = runCapture("git rev-parse --abbrev-ref HEAD");

  console.log("==============================================");
  console.log(" Excalidraw fork - local release workflow");
  console.log("==============================================");
  console.log(`Target version : ${version}`);
  console.log(`Push remote    : ${SECONDARY_REMOTE}`);
  console.log(`Push branch    : ${branch}`);

  console.log("\n--- Step 1/5: Building packages ---");
  buildPackages();

  console.log("\n--- Step 2/5: Bumping package versions ---");
  bumpVersions(version);
  console.log("Updated version + cross-deps in all 6 package.json files");

  console.log("\n--- Step 3/5: Packing into dist-packages/ ---");
  run("node scripts/pack-all.js");

  console.log("\n--- Step 4/5: Committing changes ---");
  run("git add dist-packages packages/*/package.json");

  if (gitHasChanges("dist-packages packages/*/package.json")) {
    const message = `chore(release): @excalidraw/* ${version}`;
    run(`git commit -m "${message}"`);
  } else {
    console.log("Nothing to commit (already up-to-date).");
  }

  console.log(`\n--- Step 5/5: Pushing to ${SECONDARY_REMOTE}/${branch} ---`);
  run(`git push ${SECONDARY_REMOTE} HEAD`);

  console.log("\n==============================================");
  console.log(`Release ${version} complete.`);
  console.log("==============================================\n");
  console.log("Tarballs are in dist-packages/.");
  console.log("Consumers can install via raw GitHub URLs, e.g.:\n");
  console.log("  // package.json");
  for (const name of PACKAGES) {
    const fullName = `@excalidraw/${name}`;
    const tarballName = `excalidraw-${name}-${version}.tgz`;
    const url = `https://raw.githubusercontent.com/codertapsu/excalidraw/${branch}/dist-packages/${tarballName}`;
    console.log(`  "${fullName}": "${url}",`);
  }
  console.log(
    "\nNote: every @excalidraw/* package must be declared in the consumer's",
  );
  console.log(
    "package.json with the matching tarball URL, since the packed bundles",
  );
  console.log(
    "leave cross-package deps as external (they will not auto-resolve from npm",
  );
  console.log("when the version contains a fork suffix).\n");
}

try {
  main();
} catch (err) {
  console.error("\nRelease failed:", err.message);
  process.exit(1);
}
