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
  URLs on `master`, pushed to a `secondary` remote. Those tarballs remain in git
  history but are no longer in the tree.
- **Revision 8 onward**: the workflow described above — pristine workspace
  versions, immutable release assets, `origin`/`upstream` remote convention.
