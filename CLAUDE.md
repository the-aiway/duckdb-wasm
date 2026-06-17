# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A fork of [DuckDB-Wasm](https://github.com/duckdb/duckdb-wasm) (published as `aiway-duckdb-wasm`, internal workspace still named `@duckdb/duckdb-wasm`). It compiles DuckDB (currently v1.4.2) plus Apache Arrow to WebAssembly and exposes a TypeScript API for running SQL/OLAP queries in the browser and Node. Yarn-workspaces monorepo.

### Fork-specific deviations from upstream (read before changing build or bindings)

These are the non-obvious places this fork diverges — upstream docs/issues will not match here:

- **UDF support was removed** (`createScalarFunction` and friends) because it required Arrow type plumbing. The interface stubs are commented out in `bindings_interface.ts`. Don't reintroduce without restoring the Arrow type machinery.
- **`apache-arrow` is not a declared dependency.** It's treated as an external/peer. `packages/duckdb-wasm/bundle.mjs` marks it `external` and *patches its broken `package.json` exports at build time* (`patch_arrow()`). Code may import arrow types, but they aren't bundled.
- **Bundling is a hand-written esbuild script** (`packages/duckdb-wasm/bundle.mjs`), not webpack/rollup. `tsc` is invoked only for `--emitDeclarationOnly`. The header comment in `bundle.mjs` documents every output bundle and why workers/tests must stay IIFE/CJS.
- WASM config loads the `core_functions` extension and sets `external_threads = maximum_threads`; HTTP requests support an auth token (`bindings/tokens.ts`).
- Root-level `dist` and `types` are symlinks into `packages/duckdb-wasm/`.

## Architecture

Four layers, bottom to top:

1. **C++ core — `lib/`** (`duckdb_web` library). The bridge between DuckDB's C++ and JS, compiled to WASM via Emscripten. Entry points: `lib/src/wasm_main.cc`, `lib/src/webdb_api.cc` (the C ABI exported to JS), `lib/src/webdb.cc` (the `WebDB`/`Connection` impl). Notable subsystems: `arrow_*` (Arrow IPC bridge), `io/` (virtual filesystems — `web_filesystem`, `buffered_filesystem`, `file_page_buffer`), `http_wasm.cc` (HTTP fetch backed FS), `extensions/` (json, parquet), `json_*` (JSON shredding/typedef).

2. **Submodules — `submodules/`** (git submodules): DuckDB itself, Arrow, plus build/test deps (gflags, googletest, benchmark, spdlog, rapidjson, tpch-dbgen). Patched at build time by `patches/{duckdb,arrow,rapidjson}/*.patch`.

3. **WASM artifacts**: each build produces three variants — **mvp** (baseline), **eh** (Wasm exception handling), **coi** (cross-origin isolation + pthreads/multithreading). Outputs land in `packages/duckdb-wasm/src/bindings/duckdb-{mvp,eh,coi}.wasm` and are copied to `dist/` by `bundle.mjs`.

4. **TypeScript API — `packages/duckdb-wasm/src/`**:
   - `bindings/` — the **synchronous** binding layer that talks directly to the loaded WASM module. `bindings_base.ts` is the shared impl; per-platform × per-variant subclasses (`bindings_{browser,node}_{base,mvp,eh,coi}.ts`). `runtime.ts` / `runtime_{browser,node}.ts` implement the filesystem/HTTP callbacks the WASM module calls back into. `connection.ts` is a sync query handle.
   - `parallel/` — the **async** layer and the main public API. `AsyncDuckDB` (`async_bindings.ts`) runs the WASM module inside a Web Worker, communicating via `worker_request.ts` message types; `worker_dispatcher.ts` is the worker-side handler. `async_connection.ts` is the async query handle.
   - `targets/` — bundle entry points (one per platform/variant/worker), the inputs to `bundle.mjs`. `targets/duckdb.ts` is the public type-export surface.
   - Top level: `index.ts` (re-exports), `log.ts`, `platform.ts` (feature detection picking mvp/eh/coi), `status.ts`, `version.ts`.

### Other workspace packages
`packages/duckdb-wasm-shell` (Rust→Wasm terminal shell, built with wasm-pack), `packages/duckdb-wasm-app` (the shell.duckdb.org web app), `packages/react-duckdb` (React bindings), `packages/benchmarks`. Runnable examples live in `examples/`.

## Build

The top-level `Makefile` orchestrates everything. Emscripten builds run **natively if `emcc` is on PATH, otherwise inside the `duckdb/wasm-ci` Docker image** (auto-detected by `make set_environment`; see `docker-compose.yml`).

First-time setup:
```bash
make submodules       # git submodule init + update
make apply_patches    # apply patches/ to submodules (required before any WASM build)
```

WASM core (each builds all three variants via `scripts/wasm_build_lib.sh <mode> <variant>`):
```bash
make wasm        # alias for wasm_relperf (release, perf-optimized)
make wasm_dev    # fast dev build
make wasm_relsize / wasm_debug / wasm_star   # size-optimized / debug / all four modes
```

TypeScript bundle (`yarn workspace @duckdb/duckdb-wasm build:{debug,release}` → `node bundle.mjs … && tsc --emitDeclarationOnly`):
```bash
make js_debug    # or: make js_release
```

Full app + local server: `make serve` (signed extensions) / `make serve_local` (local unsigned extension repo). `make app` is the complete release pipeline (wasm + shell + docs + tests + app).

Native C++ build (for the C++ test harness, no Emscripten): `make lib` → cmake build producing `build/Debug/tester`. Also `lib_release`, `lib_relwithdebinfo`.

## Test

JS tests use **Jasmine**; browser tests run under **Karma + Puppeteer**. Most need generated datasets first: `make build/data` (TPCH at several scale factors + the `uni` dataset).

```bash
make js_tests_node                          # Node (runs dist/tests-node.cjs)
make js_tests_browser                       # Chrome via Karma
make js_tests_node JS_FILTER=<spec-substr>  # filter to specific specs

# or directly in the package:
yarn workspace @duckdb/duckdb-wasm test          # chrome + node
yarn workspace @duckdb/duckdb-wasm test:node
yarn workspace @duckdb/duckdb-wasm test:firefox
yarn workspace @duckdb/duckdb-wasm test:node --filter=<spec-substr>
```
Note: JS tests depend on `js_debug` having built first (the Makefile targets chain this).

C++ unit tests (gtest):
```bash
make lib_tests                       # build + run ./build/Debug/tester
# run a subset:  ./build/Debug/tester --gtest_filter=<pattern>   (or GTEST_FILTER= via xray_tester)
```

## Lint & format

```bash
make eslint          # eslint across duckdb-wasm, shell, benchmarks workspaces
yarn lint:fix        # eslint --fix across the same
make clang_format    # C++ formatting (excludes lib/build, lib/third_party)
make check_format    # verify formatting (scripts/format.sh check)
```
JS is formatted with Prettier; C++ with clang-format (`.clang-format`).
