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
(`duckdb/duckdb-wasm`). To pull in upstream changes:

1. `git fetch origin-fork`
2. `git rebase origin-fork/main` — the fork carries a handful of customization
   commits (UDF removed, `apache-arrow` made external, custom esbuild
   `bundle.mjs`, HTTP auth token, etc.). Resolve conflicts by layering the
   fork's intent on top of upstream's newer code.
3. Rebuild the wasm (steps 1–5 above) — `mvp`/`eh` with emscripten `3.1.71`,
   `coi` with `3.1.57`.
4. `make js_release` and **commit the regenerated `dist/`** (it is committed and
   consumed directly from git — see below).
5. `git push --force-with-lease origin main` (the rebase rewrites history).

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
