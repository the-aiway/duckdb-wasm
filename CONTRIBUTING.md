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
`./.emsdk/emsdk_env.sh`, so install the SDK there. Use the version CI uses:

```bash
git clone https://github.com/emscripten-core/emsdk.git .emsdk
cd .emsdk && ./emsdk install 3.1.71 && ./emsdk activate 3.1.71 && cd ..
```

(`.emsdk` is gitignored. CI uses `3.1.71`, and `3.1.57` specifically for the
`coi` variant; `3.1.71` builds all three locally.)

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

```bash
make wasm           # all 3 variants (relperf); see Makefile for wasm_dev / wasm_debug / wasm_relsize
make js_debug       # then the TypeScript bundle (or js_release)
```

## Notes

- DuckDB is currently pinned to v1.5.4 (`submodules/duckdb`).
- DuckDB internals change across versions; the C++ glue in `lib/` may need
  updating after a submodule bump (e.g. `external_threads` moved from a
  `DBConfigOptions` member to a named setting in v1.5).
