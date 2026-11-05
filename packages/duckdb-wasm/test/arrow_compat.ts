// The fork returns Arrow IPC bytes and takes SQLField[] columns (46257f6); the upstream tests expect apache-arrow.
// Decode here, like a consumer would, so the test suite stays identical to upstream.
import * as arrow from 'apache-arrow';
import { DuckDBConnection, PreparedStatement } from '../src/bindings/connection';
import { AsyncDuckDBConnection, AsyncPreparedStatement } from '../src/parallel/async_connection';
import { arrowToSQLField } from '../src/json_typedef';

const flattenColumns = (options: any) =>
    options?.columns && !Array.isArray(options.columns)
        ? {
              ...options,
              columns: Object.entries(options.columns).map(([k, t]) => arrowToSQLField(k, t as arrow.DataType)),
          }
        : options;

function patchSync(proto: any) {
    const { query, send } = proto;
    proto.query = function (...args: any[]) {
        return arrow.tableFromIPC(query.apply(this, args));
    };
    proto.send = function (...args: any[]) {
        const iter = send.apply(this, args);
        return iter instanceof Promise
            ? iter.then(i => arrow.RecordBatchReader.from(i))
            : arrow.RecordBatchReader.from(iter);
    };
}

function patchAsync(proto: any) {
    const { query, send } = proto;
    proto.query = async function (...args: any[]) {
        return arrow.tableFromIPC(await query.apply(this, args));
    };
    proto.send = async function (...args: any[]) {
        const iter = await send.apply(this, args);
        return iter && (await arrow.RecordBatchReader.from(iter));
    };
}

// A function, not a bare import: the package is "sideEffects": false, so esbuild drops side-effect-only imports
export function installArrowCompat(): void {
    patchSync(PreparedStatement.prototype);
    patchSync(DuckDBConnection.prototype);
    patchAsync(AsyncPreparedStatement.prototype);
    patchAsync(AsyncDuckDBConnection.prototype);

    for (const proto of [DuckDBConnection.prototype, AsyncDuckDBConnection.prototype] as any[]) {
        const { insertCSVFromPath, insertJSONFromPath } = proto;
        proto.insertArrowTable = function (table: arrow.Table, options: any) {
            return this.insertArrowFromIPCStream(arrow.tableToIPC(table, 'stream'), options);
        };
        proto.insertCSVFromPath = function (path: string, options: any) {
            return insertCSVFromPath.call(this, path, flattenColumns(options));
        };
        proto.insertJSONFromPath = function (path: string, options: any) {
            return insertJSONFromPath.call(this, path, flattenColumns(options));
        };
    }
}
