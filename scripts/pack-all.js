#!/usr/bin/env node

/**
 * pack-all.js
 *
 * Packs every @excalidraw workspace package listed in PACKAGES into a .tgz
 * bundle and moves it into dist-packages/. Assumes the packages have already
 * been built (dist/ present in each package directory).
 *
 * Cross-package dependency rewriting:
 *   Before each `npm pack`, the package.json of each package is rewritten so
 *   that any @excalidraw/<sibling> dep listed in PACKAGES points to the raw
 *   GitHub URL of the sibling tarball, e.g.
 *
 *     "@excalidraw/common":
 *       "https://raw.githubusercontent.com/<owner>/<repo>/<branch>/dist-packages/excalidraw-common-<ver>.tgz"
 *
 *   This way a consumer only needs to declare the top-level package(s) it
 *   uses; npm follows the URL deps recursively.
 *
 *   The on-disk package.json files are restored after packing (try/finally),
 *   so the local yarn-workspace dev flow continues to work as before.
 *
 * Usage:
 *   node scripts/pack-all.js
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
const DIST_PACKAGES_DIR = path.join(REPO_ROOT, "dist-packages");
const SECONDARY_REMOTE = "secondary";

function run(command, cwd) {
  console.log(`\n> ${command}`);
  return execSync(command, { encoding: "utf8", stdio: "inherit", cwd });
}

function runCapture(command, cwd) {
  return execSync(command, { encoding: "utf8", cwd }).trim();
}

function pkgJsonPath(name) {
  return path.join(PACKAGES_DIR, name, "package.json");
}

function getSecondaryRepoSlug() {
  let url;
  try {
    url = runCapture(`git remote get-url ${SECONDARY_REMOTE}`, REPO_ROOT);
  } catch {
    throw new Error(
      `Cannot read git remote "${SECONDARY_REMOTE}". Add it with:\n  git remote add ${SECONDARY_REMOTE} <url>`,
    );
  }
  // Matches both https://github.com/owner/repo[.git] and git@github.com:owner/repo[.git]
  const match = url.match(/github\.com[:/](.+?)(?:\.git)?\/?$/);
  if (!match) {
    throw new Error(
      `Cannot parse a "<owner>/<repo>" slug from secondary remote URL: ${url}`,
    );
  }
  return match[1];
}

function readVersions() {
  const versions = new Map();
  for (const name of PACKAGES) {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath(name), "utf8"));
    versions.set(name, pkg.version);
  }
  return versions;
}

function buildTarballUrl(slug, branch, name, version) {
  return `https://raw.githubusercontent.com/${slug}/${branch}/dist-packages/excalidraw-${name}-${version}.tgz`;
}

/**
 * Rewrites @excalidraw/<sibling> deps in `name`'s package.json to GitHub raw
 * tarball URLs. Returns the original file contents for restoration, or null
 * if no rewrite was needed.
 */
function rewritePackageDeps(name, slug, branch, versions) {
  const filePath = pkgJsonPath(name);
  const original = fs.readFileSync(filePath, "utf8");
  const pkg = JSON.parse(original);

  let modified = false;
  for (const depKey of ["dependencies", "peerDependencies"]) {
    const deps = pkg[depKey];
    if (!deps) continue;
    for (const sibling of PACKAGES) {
      const fullName = `@excalidraw/${sibling}`;
      if (deps[fullName] !== undefined) {
        deps[fullName] = buildTarballUrl(
          slug,
          branch,
          sibling,
          versions.get(sibling),
        );
        modified = true;
      }
    }
  }

  if (!modified) return null;

  fs.writeFileSync(filePath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
  return original;
}

function packPackage(name, index, total) {
  const packageDir = path.join(PACKAGES_DIR, name);
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath(name), "utf8"));

  const distDir = path.join(packageDir, "dist");
  if (!fs.existsSync(distDir)) {
    throw new Error(
      `Missing dist/ for ${pkg.name}. Build packages before packing.`,
    );
  }

  console.log(`\n[${index + 1}/${total}] Packing ${pkg.name}@${pkg.version}`);

  // npm pack prints the tarball filename as the last stdout line.
  const packOutput = runCapture("npm pack", packageDir);
  const tarballName = packOutput.split("\n").pop().trim();

  if (!tarballName.endsWith(".tgz")) {
    throw new Error(
      `Unexpected npm pack output for ${pkg.name}:\n${packOutput}`,
    );
  }

  const tarballSrc = path.join(packageDir, tarballName);
  const tarballDest = path.join(DIST_PACKAGES_DIR, tarballName);

  if (!fs.existsSync(tarballSrc)) {
    throw new Error(`Tarball not found at ${tarballSrc}`);
  }

  if (fs.existsSync(tarballDest)) {
    fs.unlinkSync(tarballDest);
  }
  fs.renameSync(tarballSrc, tarballDest);
  console.log(`  -> dist-packages/${tarballName}`);
}

function main() {
  console.log("Packing @excalidraw packages...");

  if (!fs.existsSync(DIST_PACKAGES_DIR)) {
    fs.mkdirSync(DIST_PACKAGES_DIR, { recursive: true });
    console.log(`Created ${DIST_PACKAGES_DIR}`);
  }

  const slug = getSecondaryRepoSlug();
  const branch = runCapture("git rev-parse --abbrev-ref HEAD", REPO_ROOT);
  if (branch === "HEAD") {
    throw new Error(
      "Detached HEAD detected. Check out a branch before packing so the rewritten URLs point somewhere real.",
    );
  }

  const versions = readVersions();

  console.log(`Repo slug : ${slug}`);
  console.log(`Branch    : ${branch}`);
  console.log(
    `Cross-deps will be rewritten to https://raw.githubusercontent.com/${slug}/${branch}/dist-packages/...`,
  );

  // Rewrite cross-deps in every package.json before packing. Originals are
  // captured here and unconditionally restored in finally{} below.
  const originals = new Map();

  try {
    for (const name of PACKAGES) {
      const original = rewritePackageDeps(name, slug, branch, versions);
      if (original !== null) originals.set(name, original);
    }

    PACKAGES.forEach((name, i) => packPackage(name, i, PACKAGES.length));
  } finally {
    for (const [name, original] of originals) {
      fs.writeFileSync(pkgJsonPath(name), original, "utf8");
    }
  }

  const tarballs = fs
    .readdirSync(DIST_PACKAGES_DIR)
    .filter((f) => f.endsWith(".tgz"))
    .sort();

  console.log(
    `\nDone. dist-packages/ now holds ${tarballs.length} tarball(s).`,
  );
}

try {
  main();
} catch (err) {
  console.error("\nPack failed:", err.message);
  process.exit(1);
}
