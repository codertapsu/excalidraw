# Fork workflow (codertapsu/excalidraw)

This file documents how this fork of [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw)
is maintained: how to make adjustments, build, package, push, install in
downstream projects, and pull updates back from upstream.

The contents here are the **only** thing you need to read to operate the fork.
All upstream Excalidraw conventions still apply (see [CLAUDE.md](CLAUDE.md) and
[CONTRIBUTING.md](CONTRIBUTING.md)) — this file only covers what the fork adds.

---

## 1. Repositories and remotes

| Remote      | URL                                            | Role                                                                         |
| ----------- | ---------------------------------------------- | ---------------------------------------------------------------------------- |
| `origin`    | https://github.com/excalidraw/excalidraw       | Read-only upstream. We pull updates from here and never push to it.         |
| `secondary` | https://github.com/codertapsu/excalidraw       | Our fork. We push every change here. Consumers install tarballs from here. |

Verify your local state at any time:

```bash
git remote -v
```

If `secondary` is missing, add it:

```bash
git remote add secondary https://github.com/codertapsu/excalidraw
```

The fork tracks **`master`** on both remotes. All releases are cut from `master`.

---

## 2. What this fork adds vs upstream

Source-level changes (everything under [packages/excalidraw/](packages/excalidraw/)):

- **New `<Excalidraw>` props** — `hideLibrary` and `hideLibraryBrowseButton`. See
  [packages/excalidraw/types.ts](packages/excalidraw/types.ts) and the
  prop chain in [index.tsx](packages/excalidraw/index.tsx) →
  [App.tsx](packages/excalidraw/components/App.tsx) →
  [LayerUI.tsx](packages/excalidraw/components/LayerUI.tsx) →
  [DefaultSidebar.tsx](packages/excalidraw/components/DefaultSidebar.tsx) →
  [LibraryMenu.tsx](packages/excalidraw/components/LibraryMenu.tsx) /
  [LibraryMenuItems.tsx](packages/excalidraw/components/LibraryMenuItems.tsx).
- **Defensive null-checks** on `appState.searchMatches.matches` in
  [renderer/interactiveScene.ts](packages/excalidraw/renderer/interactiveScene.ts),
  [components/App.tsx](packages/excalidraw/components/App.tsx), and
  [components/SearchMenu.tsx](packages/excalidraw/components/SearchMenu.tsx).
- **Vietnamese translation** completed to 100% in
  [locales/vi-VN.json](packages/excalidraw/locales/vi-VN.json) and
  [locales/percentages.json](packages/excalidraw/locales/percentages.json).

Tooling additions (everything that makes the fork installable from GitHub):

- [scripts/pack-all.js](scripts/pack-all.js) — packs all 6 workspace packages
  into `.tgz` files in [dist-packages/](dist-packages/). Rewrites
  `@excalidraw/*` cross-deps inside each tarball to GitHub raw URLs of the
  sibling tarballs, so a consumer needs only one URL entry to install the
  whole graph.
- [scripts/release-local.js](scripts/release-local.js) — orchestrates the full
  release: build → bump versions → pack → commit → push to `secondary`.
- [package.json](package.json) — adds `release:local` and `pack:all` scripts.
- [.gitignore](.gitignore) — adds `!/dist-packages/*.tgz` so the packed
  tarballs are tracked in git.
- [dist-packages/](dist-packages/) — committed `.tgz` artifacts, one set per
  release.

To see the live diff against upstream at any moment:

```bash
git fetch origin
git log --oneline origin/master..HEAD
git diff --stat origin/master..HEAD -- ':!dist-packages'
```

### Known unguarded entry points

`hideLibrary` does not gate every possible way to surface the library. These
are intentionally left as host-app responsibility:

- [components/CommandPalette/CommandPalette.tsx:440-441](packages/excalidraw/components/CommandPalette/CommandPalette.tsx#L440-L441)
  — Cmd-K command that opens the default sidebar to the library tab.
- [data/library.ts:300-303](packages/excalidraw/data/library.ts#L300-L303) —
  `excalidrawAPI.updateLibrary({ openLibraryMenu: true })` runtime API.

If you set `hideLibrary={true}`, do not call those code paths from the host
app. Or revisit and gate them too — both are small follow-ups.

---

## 3. Versioning scheme

All 6 workspace packages are released at the **same** version per release. The
version uses upstream's number plus a fork suffix:

```
<upstream-version>-codertapsu.<n>
```

For example, on top of upstream `0.18.0` the fork releases `0.18.0-codertapsu.1`,
`0.18.0-codertapsu.2`, and so on. When upstream bumps to `0.19.0`, the next fork
release becomes `0.19.0-codertapsu.1`.

This unifies `utils` (originally `0.1.2`) and `fractional-indexing` (originally
`3.3.0`) into the same version — acceptable here because the fork is the only
publisher and consumers always install all packages via tarball URLs.

---

## 4. Local development

All upstream commands work unchanged:

```bash
yarn install            # install all workspace deps
yarn start              # run excalidraw-app dev server
yarn test:typecheck     # tsc
yarn test:update        # vitest with snapshot updates
yarn fix                # prettier + eslint --fix
```

Cross-package deps in each `packages/*/package.json` stay as version strings
during dev (e.g. `"@excalidraw/common": "0.18.0-codertapsu.7"`), so yarn
workspaces continues to symlink siblings normally. The pack step rewrites
those to URLs only **inside the tarball** and restores the on-disk file
afterwards.

---

## 5. Releasing a new version

Use this whenever you have committed changes that should reach downstream
projects. The workflow is identical for source changes, translation updates,
and bug fixes.

### Step 1 — commit your source change first

`release:local` does **not** stage your edits. Commit them with a meaningful
message before invoking it, so the release commit stays minimal and easy to
revert.

```bash
git add <files>
git commit -m "feat(...): describe the change"
```

### Step 2 — pick the next version

Increment the suffix from the latest release. The latest tarballs in
[dist-packages/](dist-packages/) tell you what's already shipped. For example,
if the highest is `0.18.0-codertapsu.7`, the next is `0.18.0-codertapsu.8`.

### Step 3 — run the release

```bash
yarn release:local 0.18.0-codertapsu.<n>
```

This will:

1. Build all 6 packages: `yarn build:packages` plus `yarn --cwd ./packages/utils build:esm`.
2. Bump every `packages/*/package.json` (`version` and `@excalidraw/*` cross-deps) to the new version.
3. Run `node scripts/pack-all.js`, which rewrites cross-deps to GitHub raw URLs, packs each package, and moves the `.tgz` into `dist-packages/`.
4. Stage `dist-packages/` and `packages/*/package.json` and commit `chore(release): @excalidraw/* <version>`.
5. `git push secondary HEAD` — pushes the current branch to the same-named branch on the `secondary` remote.

The whole flow takes under a minute. Verify a tarball on the way out:

```bash
tar -xzf dist-packages/excalidraw-excalidraw-0.18.0-codertapsu.8.tgz package/package.json -O \
  | python3 -c "import json,sys;p=json.load(sys.stdin); [print(f'{k}: {v}') for k,v in p['dependencies'].items() if k.startswith('@excalidraw/')]"
```

You should see GitHub raw URLs for the workspace siblings and version strings
for the external `@excalidraw/*` (laser-pointer, mermaid-to-excalidraw,
random-username) packages.

### Just packing without bumping or pushing

If you want to regenerate tarballs at the **current** versions without
touching git or bumping (useful for verification or experiments):

```bash
yarn pack:all
```

The on-disk `package.json` files are restored after this, so it is safe to
run without committing.

---

## 6. Installing the fork in another project

Add a single line to the consumer's `package.json`:

```json
{
  "dependencies": {
    "@excalidraw/excalidraw": "https://raw.githubusercontent.com/codertapsu/excalidraw/master/dist-packages/excalidraw-excalidraw-0.18.0-codertapsu.7.tgz"
  }
}
```

Then run `npm install` (or `yarn install`). The cross-deps inside the tarball
already point to GitHub raw URLs for `@excalidraw/common`, `/element`, `/math`,
`/fractional-indexing`, and `/utils`, so the package manager will resolve them
recursively without any per-package entries.

### Bumping in the consumer after a new release

Update the version in the URL and reinstall. Some package managers cache
tarball URLs aggressively — if the new install does not pick up a change you
expect, clear the lockfile entry and `node_modules/@excalidraw/*` and retry.

### Why URLs and not git tags

GitHub's `https://github.com/<owner>/<repo>/releases/download/...` works, but
raw-content URLs avoid the release-asset workflow and can be served directly
from any branch. If you ever want fully immutable installs, replace `master`
in the URL with a commit SHA — e.g.
`https://raw.githubusercontent.com/codertapsu/excalidraw/<sha>/dist-packages/...`.

### CDN cache caveat

GitHub raw URLs are CDN-cached. Re-packing at the **same** version can serve
stale bytes for a few minutes after push. Always bump the version when you
change something — that gives the new install a fresh URL.

---

## 7. Syncing with upstream `origin`

Upstream Excalidraw moves quickly. The goal of a sync is to bring origin's
new commits into our `master` while preserving everything in
[Section 2](#2-what-this-fork-adds-vs-upstream).

**Use merge, not rebase.** Rebasing would replay every release commit (each
of which bumps `packages/*/package.json` and writes a new set of tarballs into
`dist-packages/`) on top of new origin commits — every replay would conflict
with every later release commit, producing dozens of conflicts. A single
merge surfaces conflicts once and keeps the history readable.

### Standard sync recipe

```bash
# 0. Make sure your working tree is clean.
git status

# 1. Get the latest from upstream and check the diff.
git fetch origin
git log --oneline HEAD..origin/master   # what is new in origin
git log --oneline origin/master..HEAD   # what we still carry on top

# 2. Make sure you are on master and up-to-date with secondary.
git checkout master
git pull secondary master

# 3. Merge upstream into our master.
git merge origin/master
```

### Resolving conflicts

You will reliably get conflicts in two places, and possibly in source files
that touch our customizations.

**Always conflicts:**

- `packages/*/package.json` — origin will be at upstream's version (e.g.
  `0.18.0` or `0.19.0`), ours will be at `0.18.0-codertapsu.<n>`. **Resolve
  by keeping our fork-suffixed version**. The next release step will rewrite
  these anyway.

  ```bash
  # Quick way: keep our version of every package.json under packages/.
  git checkout --ours packages/*/package.json
  git add packages/*/package.json
  ```

- `dist-packages/` — should not exist on origin, but in case any tarball name
  collides with ours, **keep ours**:

  ```bash
  git checkout --ours dist-packages/
  git add dist-packages/
  ```

**Sometimes conflicts** — these are the source files we have customized
(see [Section 2](#2-what-this-fork-adds-vs-upstream)). For each conflicted
file, look at what upstream changed and integrate it manually with our
customizations:

- [packages/excalidraw/types.ts](packages/excalidraw/types.ts)
- [packages/excalidraw/index.tsx](packages/excalidraw/index.tsx)
- [packages/excalidraw/components/App.tsx](packages/excalidraw/components/App.tsx)
- [packages/excalidraw/components/LayerUI.tsx](packages/excalidraw/components/LayerUI.tsx)
- [packages/excalidraw/components/DefaultSidebar.tsx](packages/excalidraw/components/DefaultSidebar.tsx)
- [packages/excalidraw/components/LibraryMenu.tsx](packages/excalidraw/components/LibraryMenu.tsx)
- [packages/excalidraw/components/LibraryMenuItems.tsx](packages/excalidraw/components/LibraryMenuItems.tsx)
- [packages/excalidraw/components/Sidebar/common.ts](packages/excalidraw/components/Sidebar/common.ts)
- [packages/excalidraw/components/SearchMenu.tsx](packages/excalidraw/components/SearchMenu.tsx)
- [packages/excalidraw/renderer/interactiveScene.ts](packages/excalidraw/renderer/interactiveScene.ts)
- [packages/excalidraw/locales/vi-VN.json](packages/excalidraw/locales/vi-VN.json)
- [packages/excalidraw/locales/percentages.json](packages/excalidraw/locales/percentages.json)

If you are not sure what we changed in a file, this shows our delta from the
merge base:

```bash
git diff $(git merge-base origin/master HEAD)..HEAD -- <file>
```

### Verify the merge before releasing

Before cutting a new release, confirm the build and types still pass:

```bash
yarn install                       # in case origin updated dependencies
yarn test:typecheck
yarn build:packages
yarn --cwd ./packages/utils build:esm
```

If any of those fail, the conflict resolution missed something — investigate
before continuing.

### Cut a new release post-sync

Once the merge commit is done and the build is green:

```bash
# If origin is still at 0.18.0 the next release is 0.18.0-codertapsu.<n+1>.
# If origin bumped to 0.19.0 then start 0.19.0-codertapsu.1.
yarn release:local <new-version>
```

This will rebuild everything against the merged code and produce a fresh set
of tarballs that incorporate upstream's changes.

### Push the merge to `secondary`

`yarn release:local` already pushes the release commit to `secondary`, but if
you want to push the merge commit on its own first (recommended for a clearer
history):

```bash
git push secondary master
```

Then run the release as above.

---

## 8. Quick reference

```bash
# Diff against upstream
git fetch origin
git log --oneline origin/master..HEAD                 # our commits
git diff --stat origin/master..HEAD -- ':!dist-packages'

# Pack only (no bump, no push)
yarn pack:all

# Full release
yarn release:local <new-version>

# Install URL pattern (consumer's package.json)
"@excalidraw/excalidraw":
  "https://raw.githubusercontent.com/codertapsu/excalidraw/master/dist-packages/excalidraw-excalidraw-<version>.tgz"

# Add a remote if missing
git remote add secondary https://github.com/codertapsu/excalidraw

# Verify a packed tarball's deps
tar -xzf dist-packages/excalidraw-excalidraw-<version>.tgz package/package.json -O
```
