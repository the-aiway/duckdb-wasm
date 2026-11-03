#!/usr/bin/env node
// aiway smoke test: loads packages/duckdb-wasm/dist in headless Chrome (puppeteer) with the open() config of
// the-aiway/query (react/DuckDBProvider.ts) and checks the behaviours query relies on, for both bundles.
// Run before re-vendoring dist into query:  node scripts/aiway_smoke.mjs   (exit code 1 on any failure)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'packages/duckdb-wasm/dist');
const ARROW = path.join(ROOT, 'node_modules/apache-arrow/Arrow.es2015.min.js');
const TOKEN = 'aiway-smoke-token';
const CSV = 'id,name\n1,a\n2,b\n3,c\n';
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html' };
const ISOLATION = {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'same-origin',
};

// The page: same worker bootstrap and open() config as query, then one check per behaviour
const PAGE = `<!doctype html><meta charset="utf-8"><script src="/arrow.js"></script><script type="module">
const duckdb = await import('/dist/duckdb-browser.mjs');
const want = new URLSearchParams(location.search).get('bundle');
const o = location.origin + '/dist';
const bundles = { base: { mainModule: o + '/duckdb-base.wasm', mainWorker: o + '/duckdb-browser-base.worker.js' } };
if (want === 'threads') bundles.threads = { mainModule: o + '/duckdb-threads.wasm', mainWorker: o + '/duckdb-browser-threads.worker.js', pthreadWorker: o + '/duckdb-browser-threads.pthread.worker.js' };
const out = {};
try {
    const bundle = await duckdb.selectBundle(bundles);
    out.bundle = bundle.mainModule.split('/').pop();
    const worker = new Worker(URL.createObjectURL(new Blob(['importScripts("' + bundle.mainWorker + '");'], { type: 'text/javascript' })));
    const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    const maximumThreads = bundle.pthreadWorker ? 4 : 1;
    await db.open({
        maximumThreads, accessMode: duckdb.DuckDBAccessMode.READ_WRITE, opfs: { fileHandling: 'auto' }, useDirectIO: true,
        authToken: '${TOKEN}',
        filesystem: { reliableHeadRequests: true, allowFullHTTPReads: true, forceFullHTTPReads: true },
        query: { castBigIntToDouble: true, castTimestampToDate: true, castDecimalToDouble: true },
    });
    const conn = await db.connect();
    const table = async (sql) => Arrow.tableFromIPC(await conn.query(sql));
    const rows = async (sql) => (await table(sql)).toArray().map(r => r.toJSON());
    const check = async (name, fn) => { try { out[name] = await fn(); } catch (e) { out[name] = { error: String(e?.message ?? e) }; } };
    out.maximumThreads = maximumThreads;
    await check('version', () => db.getVersion());
    await check('select42', async () => (await rows('SELECT 42 AS v'))[0].v);
    await check('parquet', async () => {
        await conn.query("COPY (SELECT range AS i FROM range(10)) TO 'smoke.parquet' (FORMAT parquet)");
        return (await rows("SELECT count(*)::INT AS n FROM 'smoke.parquet'"))[0].n;
    });
    await check('httpAuth', async () => (await rows("SELECT count(*)::INT AS n FROM read_csv('" + location.origin + "/secure/data.csv')"))[0].n);
    await check('threads', async () => rows("SELECT current_setting('threads')::INT AS t, current_setting('external_threads')::INT AS e"));
    await check('timestamps', async () => {
        const t = await table("SELECT TIMESTAMP '2026-11-02 10:00:00' AS ts, TIMESTAMP_MS '2026-11-02 10:00:00' AS ts_ms, " +
            "TIMESTAMPTZ '2026-11-02 10:00:00+00' AS ts_tz, [TIMESTAMP '2026-11-02 10:00:00'] AS ts_list, " +
            "{'a': TIMESTAMP '2026-11-02 10:00:00'} AS ts_struct, [{'b': [TIMESTAMP '2026-11-02 10:00:00']}] AS ts_deep");
        const leaf = (type) => (type.children?.length ? leaf(type.children[0].type) : type);
        const r = t.get(0).toJSON();
        // first leaf value: Vector (list) -> element 0, StructRow -> field 0
        const first = (v) => (typeof v?.get === 'function' ? first(v.get(0)) : v && typeof v === 'object' && !(v instanceof Date) ? first(Object.values(v.toJSON())[0]) : v);
        return Object.fromEntries(t.schema.fields.map(f => [f.name, { type: String(leaf(f.type)), value: Number(first(r[f.name])) }]));
    });
    await check('memoryLimit', async () => {
        await conn.query("SET memory_limit = '64MB'");
        try {
            await conn.query("SELECT count(*) FROM (SELECT repeat('x', 100) || range::VARCHAR AS s FROM range(2000000) ORDER BY s)");
            return 'completed';
        } catch (e) { return 'error: ' + String(e?.message ?? e).slice(0, 120); }
        finally { await conn.query('RESET memory_limit'); }
    });
} catch (e) { out.fatal = String(e?.stack ?? e); }
window.smoke = out;
</script>`;

const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (status, body, type = 'text/plain', extra = {}) => {
        res.writeHead(status, { ...ISOLATION, 'Content-Type': type, ...extra });
        res.end(body);
    };
    if (url.pathname === '/') return send(200, PAGE, 'text/html');
    if (url.pathname === '/arrow.js') return send(200, fs.readFileSync(ARROW), 'text/javascript');
    if (url.pathname === '/secure/data.csv') {
        if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, 'unauthorized');
        return send(200, req.method === 'HEAD' ? '' : CSV, 'text/csv', { 'Content-Length': Buffer.byteLength(CSV) });
    }
    if (url.pathname.startsWith('/dist/')) {
        const file = path.join(DIST, path.normalize(url.pathname.slice(6)));
        if (!file.startsWith(DIST) || !fs.existsSync(file)) return send(404, 'not found');
        return send(200, fs.readFileSync(file), TYPES[path.extname(file)] ?? 'application/octet-stream');
    }
    send(404, 'not found');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const DATE = Date.UTC(2026, 10, 2, 10);
const failures = [];
const expect = (bundle, name, ok, got) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${bundle} ${name}: ${JSON.stringify(got)}`);
    if (!ok) failures.push(`${bundle} ${name}`);
};

const browser = await puppeteer.launch({ headless: true });
try {
    for (const bundle of ['base', 'threads']) {
        const page = await browser.newPage();
        await page.goto(`${origin}/?bundle=${bundle}`);
        const r = await page.waitForFunction(() => window.smoke, { timeout: 180000 }).then(h => h.jsonValue());
        await page.close();
        if (r.fatal) { expect(bundle, 'load', false, r.fatal); continue; }
        expect(bundle, 'bundle', r.bundle === `duckdb-${bundle}.wasm`, r.bundle);
        expect(bundle, 'version', typeof r.version === 'string', r.version);
        expect(bundle, 'SELECT 42', r.select42 === 42, r.select42);
        expect(bundle, 'parquet', r.parquet === 10, r.parquet);
        expect(bundle, 'HTTP with bearer token', r.httpAuth === 3, r.httpAuth);
        const t = r.threads?.[0];
        expect(bundle, 'threads = external_threads', t?.t === r.maximumThreads && t?.e === r.maximumThreads, r.threads);
        for (const [col, v] of Object.entries(r.timestamps?.error ? { query: r.timestamps } : r.timestamps ?? {})) {
            expect(bundle, `castTimestampToDate ${col}`, /^Date/.test(v.type ?? '') && v.value === DATE, v);
        }
        // aiway fork: spill is off by default, a query above memory_limit must fail fast (not grow JS memory)
        expect(bundle, 'memory_limit -> out-of-memory error', /^error: .*(memory|Memory)/.test(r.memoryLimit ?? ''), r.memoryLimit);
    }
} finally {
    await browser.close();
    server.close();
}
console.log(failures.length ? `\n${failures.length} failure(s)` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
