#!/usr/bin/env node

/**
 * pack-all.js
 *
 * Packs every @excalidraw workspace package listed in PACKAGES into a .tgz
 * bundle and moves it into dist-packages/. Assumes the packages have already
 * been built (dist/ present in each package directory).
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

function run(command, cwd) {
  console.log(`\n> ${command}`);
  return execSync(command, { encoding: "utf8", stdio: "inherit", cwd });
}

function runCapture(command, cwd) {
  return execSync(command, { encoding: "utf8", cwd }).trim();
}

function packPackage(name, index, total) {
  const packageDir = path.join(PACKAGES_DIR, name);
  const pkgJsonPath = path.join(packageDir, "package.json");

  if (!fs.existsSync(pkgJsonPath)) {
    throw new Error(`No package.json at ${pkgJsonPath}`);
  }

  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
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

  PACKAGES.forEach((name, i) => packPackage(name, i, PACKAGES.length));

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
