import { DuckDBBindings } from './bindings_interface';
import { CSVInsertOptions, JSONInsertOptions, ArrowInsertOptions } from './insert_options';
/** A thin helper to bind the connection id and talk record batches */
export declare class DuckDBConnection {
    /** The bindings */
    protected _bindings: DuckDBBindings;
    /** The connection handle */
    protected _conn: number;
    /** Constructor */
    constructor(bindings: DuckDBBindings, conn: number);
    /** Close a connection */
    close(): void;
    /** Brave souls may use this function to consume the underlying connection id */
    useUnsafe<R>(callback: (bindings: DuckDBBindings, conn: number) => R): R;
    /**
     * Run a query and return Arrow IPC stream buffer
     * Use with arrow library of choice (e.g., @uwdata/flechette, apache-arrow)
     */
    query(text: string): Uint8Array;
    /**
     * Send a query and return async iterable of Arrow IPC buffers
     * Use with arrow library of choice (e.g., @uwdata/flechette, apache-arrow)
     */
    send(text: string, allowStreamResult?: boolean): Promise<Iterable<Uint8Array>>;
    /** Cancel a query that was sent earlier */
    cancelSent(): boolean;
    /** Get table names */
    getTableNames(query: string): string[];
    /** Create a prepared statement */
    prepare(text: string): PreparedStatement;
    /** Insert an arrow table from an ipc stream */
    insertArrowFromIPCStream(buffer: Uint8Array, options: ArrowInsertOptions): void;
    /** Inesrt csv file from path */
    insertCSVFromPath(path: string, options: CSVInsertOptions): void;
    /** Insert json file from path */
    insertJSONFromPath(path: string, options: JSONInsertOptions): void;
}
/** A result stream iterator */
export declare class ResultStreamIterator implements Iterable<Uint8Array> {
    protected bindings: DuckDBBindings;
    protected conn: number;
    protected header: Uint8Array;
    /** First chunk? */
    _first: boolean;
    /** Reached end of stream? */
    _depleted: boolean;
    constructor(bindings: DuckDBBindings, conn: number, header: Uint8Array);
    next(): IteratorResult<Uint8Array>;
    [Symbol.iterator](): this;
}
/** A thin helper to bind the prepared statement id*/
export declare class PreparedStatement {
    /** The bindings */
    protected readonly bindings: DuckDBBindings;
    /** The connection id */
    protected readonly connectionId: number;
    /** The statement id */
    protected readonly statementId: number;
    /** Constructor */
    constructor(bindings: DuckDBBindings, connectionId: number, statementId: number);
    /** Close a prepared statement */
    close(): void;
    /**
     * Run a prepared statement and return Arrow IPC stream buffer
     * Use with arrow library of choice (e.g., @uwdata/flechette, apache-arrow)
     */
    query(...params: any[]): Uint8Array;
    /**
     * Send a prepared statement and return iterable of Arrow IPC buffers
     * Use with arrow library of choice (e.g., @uwdata/flechette, apache-arrow)
     */
    send(...params: any[]): Iterable<Uint8Array>;
}
