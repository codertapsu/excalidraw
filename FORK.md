# codertapsu/excalidraw — fork notes

A fork of [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw) that
ships as tarballs installed straight from GitHub, so customizations land in our
apps without waiting on an upstream release. Same workflow as our
Yoopta-Editor fork.

- `origin`   → `codertapsu/excalidraw` (this fork)
- `upstream` → `excalidraw/excalidraw` (push disabled)

---

## Installing in an app

Packages are published as **GitHub release assets**. Only the top-level package
needs to be declared — its intra-repo `@excalidraw/*` dependencies point at the
sibling tarballs by URL and npm follows them automatically:

```json
"@excalidraw/excalidraw": "https://github.com/codertapsu/excalidraw/releases/download/v0.18.0-codertapsu.8/excalidraw-excalidraw-0.18.0-codertapsu.8.tgz"
```

The current URL is always in
[`dist-packages/dependencies.json`](./dist-packages/dependencies.json).
You also need `react` and `react-dom` in your own dependencies.

Release-asset URLs are used rather than `raw.githubusercontent.com/master/…`
because they are **immutable**: a branch path serves whatever is at the head, so
a force-push would change the bytes behind a URL consumers have already pinned
with an integrity hash. It also keeps binaries out of git — revisions 1-7 added
~575 MB of committed tarballs to history this way.

> **Migrating from revisions ≤7:** the old
> `raw.githubusercontent.com/codertapsu/excalidraw/master/dist-packages/…` URLs
> stopped resolving when the tarballs left the tree. Replace the entry with the
> release URL above and reinstall.

**Never republish a release tag.** npm caches by URL and lockfiles pin an
integrity hash — changing the bytes behind an existing URL fails installs with
`EINTEGRITY`. Bump the revision instead (`yarn fork:revision`); `fork:pack` and
`fork:publish` both refuse to reuse an existing tag.

---

## Versioning

Workspace `package.json` files keep the **pristine upstream versions**
(excalidraw/common/math/element `0.18.0`, fractional-indexing `3.3.0`, utils
`0.1.2`). The fork suffix (`-codertapsu.<revision>`) is applied **ephemerally at
pack time** on each package's own base, and the release tag comes from
`@excalidraw/excalidraw` (e.g. `v0.18.0-codertapsu.8`).

This is deliberate: the previous tooling committed bumped versions into every
package.json, which guaranteed merge conflicts on every upstream sync. Now
version lines never differ from upstream, and yarn workspaces keeps symlinking
siblings normally during development.

---

## Local development

All upstream commands work unchanged:

```bash
yarn install            # install all workspace deps
yarn start              # run excalidraw-app dev server
yarn test:typecheck     # tsc
yarn test:update        # vitest with snapshot updates
yarn fix                # prettier + eslint --fix
```

---

## Releasing a new build

Either run the **Fork release** workflow from the Actions tab, or locally:

```bash
yarn install
yarn fork:revision          # bump; use `yarn fork:revision 1` after an upstream version bump
git commit -am "chore(fork): revision 9"
yarn fork:pack              # builds all 6 packages, writes dist-packages/
yarn fork:publish           # creates the GitHub release with the tarballs attached
git add dist-packages && git commit -m "chore(fork): manifest for v0.18.0-codertapsu.9"
git push origin master
```

Commit source changes first: the tarballs record the source commit under
`excalidrawFork`, and `fork:pack` refuses a dirty tree (`--allow-dirty`
overrides for local experiments). `yarn fork:notes` previews the release notes.

`yarn fork:pack` beyond plain `npm pack`:

- builds via the repo's own chain (`build:packages`, then utils);
- applies the fork suffix to each package's own upstream base version;
- rewrites intra-repo `@excalidraw/*` deps to the matching tarball URLs —
  external `@excalidraw/*` packages that live in other repos (`laser-pointer`,
  `mermaid-to-excalidraw`, `random-username`) stay on the npm registry;
- strips publish-time hooks and records provenance under `excalidrawFork`;
- repoints `repository`/`bugs` at this fork.

Workspace package.json files are edited in place and always restored, so a
failed run leaves the tree clean. Verify a tarball on the way out:

```bash
tar -xzOf dist-packages/excalidraw-excalidraw-*.tgz package/package.json \
  | node -p "Object.entries(JSON.parse(require('fs').readFileSync(0,'utf8')).dependencies).filter(([k])=>k.startsWith('@excalidraw/')).map(([k,v])=>k+': '+v).join('\n')"
```

Intra-repo siblings should show `releases/download/...` URLs; the external
`@excalidraw/*` packages should show registry version ranges.

---

## Syncing with upstream

### Upstream lineage — read before running `fork:sync`

The fork's history was rewritten in place on 2026-08-11 (excalidraw) and
2026-08-17 (Yoopta): a `git filter-branch` across all refs stripped
`Co-Authored-By` trailers, and the result was force-pushed to `origin`.

Every rewritten commit kept a byte-identical tree, so nothing was censored and
no licence or attribution file was lost. Two things did change.

The first is **signatures**. filter-branch re-creates commit objects, which
drops the `gpgsig` header, so every rewritten copy of an upstream commit lost
GitHub's PGP signature. That — not the trailer — is what distinguishes a
genuine upstream commit from a rewritten one: `git cat-file commit <sha>` on
the real `786ab266` shows a `gpgsig` block, its rewritten twin `bb7716c4` does
not, and both still carry the upstream contributors' own `Co-authored-by`
trailers. Do not try to tell them apart by trailer.

The second is **ancestry**. The
rewrite re-created the vendored **upstream** commits too, under new SHAs, so a
fresh clone of this fork no longer shares history with the real upstream:

| | `git merge-base HEAD upstream/master` after a fresh fetch |
|---|---|
| excalidraw | nothing — the two graphs are disjoint |
| Yoopta | resolves to `96edde3d` (2022-11-04), thousands of commits too early |

Locally this is invisible, because the `upstream/master` remote-tracking ref was
itself rewritten and *does* sit in the fork's history. It only shows up in CI,
which clones fresh and fetches the genuine upstream.

**What was done about it.** `fork.config.json` now carries
`upstreamSyncedCommit`, the real upstream commit this fork was last synced to,
and both the weekly workflow and `fork:sync` prefer it over `merge-base`. When
neither yields a usable base they now fail with this message instead of dying
silently under `bash -e`. That restores the *watch* — you will hear about
upstream movement — and keeps the file-overlap report meaningful.

**What was NOT done, and needs a deliberate decision.** Real ancestry is still
severed, so `git merge upstream/master` will refuse with `refusing to merge
unrelated histories`. Restoring it is a one-time choice between:

- `git replace --graft <first-fork-commit> <real-upstream-commit>`, which is
  local unless `refs/replace/*` is pushed and fetched explicitly; or
- a single `git merge --allow-unrelated-histories` on a scratch branch,
  resolving to the fork's side for every file it owns.

**Do not force-push the release tags.** They still point at the pre-rewrite
commits, which are exactly the SHAs recorded in each release's
`dist-packages/manifest.json`. Published tarballs, their manifests and the
remote tags form one coherent set; re-pointing the tags at the rewritten
commits would orphan every manifest and destroy the only intact provenance
link. The local clone is the copy that diverges — reconcile that instead.

```bash
yarn fork:sync:check   # report what changed upstream and whether it collides with our edits
yarn fork:sync         # fetch, branch, merge
```

`fork:sync` creates a `sync/upstream-<sha>` branch and runs a normal
`git merge`. Our changes live in ordinary commits, so git's three-way merge
keeps them and raises real conflicts rather than silently choosing a side. A
weekly **Upstream sync check** workflow opens a tracking issue when upstream
moves ahead.

After a merge:

```bash
yarn install
yarn test:typecheck && yarn build:packages
yarn fork:revision 1        # if upstream's version changed
yarn fork:pack && yarn fork:publish
```

Files the fork owns outright — on conflict, keep ours (`git checkout --ours`):

```
FORK.md  fork.config.json  dist-packages/
scripts/fork-utils.mjs  scripts/pack-fork.mjs  scripts/publish-release.mjs
scripts/sync-upstream.mjs  scripts/set-fork-revision.mjs
.github/workflows/fork-ci.yml  .github/workflows/fork-release.yml
.github/workflows/upstream-sync.yml
```

---

## What this fork adds vs upstream

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

## History

- **Revisions 1-7** (`0.18.0-codertapsu.1` … `.7`): released by the retired
  `scripts/release-local.js` / `scripts/pack-all.js` — versions bumped and
  committed in-tree, tarballs committed to `dist-packages/` and served from raw
  URLs on `master`, pushed to a `secondary` remote. Five of those tarballs were
  restored to `dist-packages/` in `52ecc7f7` and are tracked in the tree again,
  because seven release branches (v4.0.0 – v5.3.0) still pin their raw URLs.
  `fork:pack` used to wipe its output directory wholesale; it now preserves
  anything git tracks, so a release can no longer delete them.
- **Revision 8 onward**: the workflow described above — pristine workspace
  versions, immutable release assets, `origin`/`upstream` remote convention.
