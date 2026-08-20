# Contributing

## Building the WebAssembly bundle locally

These steps build the three `duckdb-*.wasm` variants (`mvp`, `eh`, `coi`) into
`packages/duckdb-wasm/src/bindings/`. They are written for macOS (Apple Silicon);
Linux is analogous.

> The Docker path (`docker compose run duckdb-wasm-ci`) is **not** usable: the
> `duckdb/wasm-ci` image is private and its Dockerfile pins an end-of-life Ubuntu
> base. Build natively instead — `make` auto-detects a native toolchain.

### 1. Emscripten (into `./.emsdk`)

The build (`scripts/wasm_build_lib.sh`) and `set_environment` auto-source
`./.emsdk/emsdk_env.sh`, so install the SDK there. **Two versions are required**
(matching CI): `3.1.71` for the `mvp`/`eh` variants and `3.1.57` for `coi`.

```bash
git clone https://github.com/emscripten-core/emsdk.git .emsdk
cd .emsdk
./emsdk install 3.1.71 && ./emsdk activate 3.1.71
./emsdk install 3.1.57                 # the coi variant must use this (see step 5)
cd ..
```

(`.emsdk` is gitignored.) The `coi` variant **must** be built with `3.1.57`:
Emscripten ≥ 3.1.68 no longer emits the separate pthread `*.worker.js` that
`bundle.mjs` turns into `duckdb-coi.pthread.js`, so building `coi` with `3.1.71`
yields a `.wasm` but then breaks `make js_release`.

### 2. Host tools

```bash
brew install cmake ccache
```

`ccache` is required — the CMake config sets it as the compiler launcher.
`bison`, `flex`, `brotli`, `rsync` are also needed (usually already present).

### 3. Submodules (at their pinned commits)

```bash
make submodules        # == git submodule update --init --recursive
```

The WASM build needs `submodules/{duckdb,arrow,rapidjson}`.

> If a shallow submodule checks out a branch tip instead of the pinned commit
> (git status shows `+<sha>`), fetch the exact commit, e.g.:
> `git -C submodules/arrow fetch --depth 1 origin <pinned-sha> && git -C submodules/arrow checkout <pinned-sha>`

### 4. Apply patches

```bash
make apply_patches
```

Applies `patches/{duckdb,arrow,rapidjson}/*.patch` to the submodule working
trees. These must be re-checked whenever the duckdb submodule is bumped.

### 5. Build

`make wasm` builds all three variants with whichever Emscripten is *active*, so
build `coi` separately with `3.1.57`:

```bash
# mvp + eh + (a throwaway coi) with 3.1.71
(cd .emsdk && ./emsdk activate 3.1.71); . ./.emsdk/emsdk_env.sh >/dev/null
make wasm                 # see Makefile for wasm_dev / wasm_debug / wasm_relsize

# rebuild coi with 3.1.57 so its pthread worker is emitted
(cd .emsdk && ./emsdk activate 3.1.57); . ./.emsdk/emsdk_env.sh >/dev/null
./scripts/wasm_build_lib.sh relperf coi

# bundle the TypeScript and (re)generate dist (.cjs/.mjs/.d.ts + wasm .br/.zst)
make js_release           # or js_debug
```

The toolchain is pinned in `package.json` for reproducible declaration
emit: `typescript ~5.6.3` (5.7 split `ArrayBuffer`/`SharedArrayBuffer`) and
`@types/emscripten 1.39.10` via root `resolutions` (later releases dropped the
`Emscripten.WebAssemblyExports` type the bindings use).

## Syncing with upstream (maintainers)

This is a fork. `origin` is the working fork; `origin-fork` is upstream
(`duckdb/duckdb-wasm`).

> **`main` is protected — the old rebase-and-force-push sync no longer works.**
> A repository ruleset on the default branch requires every change to arrive
> through a pull request with one approving review, and rejects non-fast-forward
> pushes. There is no bypass actor. So a sync can no longer rewrite `main`:
> merge upstream into a branch, then open a PR. See the note at the end of this
> section for why.

To pull in upstream changes:

1. `git fetch origin-fork`
2. Branch off `main`:
   ```bash
   git switch main && git pull
   git switch -c sync/upstream-$(date +%Y-%m-%d)
   ```
3. `git merge origin-fork/main` — **merge, do not rebase.** A rebase rewrites the
   fork's own commits and could only reach `main` through a force-push, which the
   ruleset rejects. The fork carries a handful of customization commits (UDF
   removed, `apache-arrow` made external, custom esbuild `bundle.mjs`, HTTP auth
   token, etc.). Resolve conflicts by layering the fork's intent on top of
   upstream's newer code, exactly as before.
4. Rebuild the wasm (steps 1–5 above) — `mvp`/`eh` with emscripten `3.1.71`,
   `coi` with `3.1.57`.
5. `make js_release` and **commit the regenerated `dist/`** (it is committed and
   consumed directly from git — see below).
6. Push the branch and open the PR:
   ```bash
   git push -u origin HEAD
   gh pr create --base main --fill
   ```
7. Get one approval, then merge. **Prefer a merge commit** — squashing collapses
   the whole upstream range into one opaque commit and loses the upstream history
   the fork is tracking. Linear history is deliberately *not* required on this
   repo precisely so that merge commits stay available.

Two ruleset behaviours will bite you if you sync in the wrong order: pushing to
the PR branch after someone approves **dismisses that approval** and requires a
fresh one, and every review thread must be resolved before the merge button
unlocks. So finish the rebuild and commit `dist/` *before* asking for review —
the `dist/` regeneration is the step most likely to need a late fixup.

Note that CI on this repo is **not** a required status check, so an approving
review is the only gate: a PR whose build is red can still be merged. Check the
build yourself before approving a sync.

The protection was added org-wide in aiway-infra (Linear AI-1110) to satisfy the
Vanta ISO 27001 / SOC 2 control "Application changes reviewed", which requires
an approving review on every default branch. Losing the rebase-based sync was a
known and accepted cost.

After a DuckDB submodule bump, expect to fix the C++ glue in `lib/` against the
new API (e.g. `external_threads` moved from a `DBConfigOptions` member to a
named setting in v1.5 — set it with `db_config.SetOptionByName(...)`).

`dist/` (`packages/duckdb-wasm/dist/`) is **tracked in git** and has no
build-on-install hook, so the fork ships its prebuilt bundle directly. Always
regenerate and commit it after changing wasm or TypeScript.

## Notes

- DuckDB is currently pinned to v1.5.4 (`submodules/duckdb`).
- DuckDB internals change across versions; the C++ glue in `lib/` may need
  updating after a submodule bump (e.g. `external_threads` moved from a
  `DBConfigOptions` member to a named setting in v1.5).
