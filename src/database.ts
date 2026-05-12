import type { HttpClient, StreamResponse } from '@pingpong-js/fetch';
import { MesahubError } from './errors.js';
import type { QueryResult, ExecResult, FileRecord } from './types.js';
import { TableHandle } from './table.js';

/**
 * DatabaseHandle — scoped entry point for a single database reference (UUID or slug).
 *
 * Obtained via `client.db(ref)`.
 *
 * @example
 * const db = client.db('my-db');
 *
 * // Raw SQL
 * const result = await db.query('SELECT * FROM users LIMIT 10');
 * await db.exec('INSERT INTO logs (msg) VALUES (?)', ['hello']);
 *
 * // High-level table API
 * const users = db.table<User>('users');
 * const alice = await users.findOne({ where: { email: 'alice@example.com' } });
 *
 * // Files
 * const list = await db.files.list({ limit: 20 });
 */
/** @internal Shared path shape passed from MesahubClient to DatabaseHandle. */
export interface PathBuilder {
  query:    (ref: string) => string;
  exec:     (ref: string) => string;
  files:    (ref: string) => string;
  fileItem: (ref: string, id: string) => string;
}

export class DatabaseHandle {
  private readonly ref: string;
  private readonly http: HttpClient;
  /** Pre-computed paths — set once at construction, used directly at every call site. */
  private readonly QUERY: string;
  private readonly EXEC:  string;
  /** Pre-bound files namespace. */
  readonly files: DatabaseFiles;

  constructor(ref: string, http: HttpClient, pathBuilder: PathBuilder) {
    this.ref   = ref;
    this.http  = http;
    this.QUERY = pathBuilder.query(ref);
    this.EXEC  = pathBuilder.exec(ref);
    this.files = new DatabaseFiles(ref, http, pathBuilder);
  }

  // ---------------------------------------------------------------------------
  // Raw SQL
  // ---------------------------------------------------------------------------

  /** Execute a read-only SQL query (SELECT / WITH / PRAGMA). */
  async query(sql: string, bindings: unknown[] = []): Promise<QueryResult> {
    const raw = await this._req<any>('POST', this.QUERY, { sql, bindings });
    if (raw == null) return { columns: [], rows: [], rowCount: 0, queryDurationMs: null };
    const columns: string[] = Array.isArray(raw.headers)
      ? raw.headers.map((h: { name: string }) => h.name)
      : (raw.columns ?? []);
    return {
      columns,
      rows:           raw.rows ?? [],
      rowCount:       (raw.rows ?? []).length,
      queryDurationMs: raw.stat?.queryDurationMs ?? null,
    };
  }

  /** Execute a write SQL statement (INSERT / UPDATE / DELETE / CREATE …). */
  async exec(sql: string, bindings: unknown[] = []): Promise<ExecResult> {
    const raw = await this._req<any>('POST', this.EXEC, { sql, bindings });
    if (raw == null) return { rowsAffected: 0, lastInsertRowid: undefined, queryDurationMs: null };
    return {
      rowsAffected:    raw.rowsAffected ?? raw.stat?.rowsAffected ?? 0,
      lastInsertRowid: raw.lastInsertRowid,
      queryDurationMs: raw.stat?.queryDurationMs ?? null,
    };
  }

  /**
   * Execute a write statement via /exec and parse the rows-style response.
   * Used internally by TableHandle.insert() for INSERT … RETURNING *.
   * @internal
   */
  private async execRows(sql: string, bindings: unknown[] = []): Promise<QueryResult> {
    const raw = await this._req<any>('POST', this.EXEC, { sql, bindings });
    if (raw == null) return { columns: [], rows: [], rowCount: 0, queryDurationMs: null };
    const columns: string[] = Array.isArray(raw.headers)
      ? raw.headers.map((h: { name: string }) => h.name)
      : (raw.columns ?? []);
    return {
      columns,
      rows:            raw.rows ?? [],
      rowCount:        (raw.rows ?? []).length,
      queryDurationMs: raw.stat?.queryDurationMs ?? null,
    };
  }

  // ---------------------------------------------------------------------------
  // High-level table API
  // ---------------------------------------------------------------------------

  /**
   * Return a `TableHandle<T>` for the given table name.
   *
   * @example
   * const posts = db.table<Post>('posts');
   * const recent = await posts.find({ orderBy: [{ column: 'created_at', direction: 'desc' }], limit: 5 });
   */
  table<T extends Record<string, unknown> = Record<string, unknown>>(
    tableName: string,
  ): TableHandle<T> {
    return new TableHandle<T>(tableName, this.query.bind(this), this.exec.bind(this), this.execRows.bind(this));
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /** @internal */
  async _req<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
    const res =
      method === 'GET'    ? await this.http.get<T>(path) :
      method === 'DELETE' ? await this.http.delete<T>(path) :
                            await this.http.post<T>(path, body);
    if (res.isError()) {
      throw MesahubError.fromResponse(
        { status: res.status, statusText: res.statusText } as Response,
        res.data,
      );
    }
    return res.data as T;
  }
}

// ---------------------------------------------------------------------------
// Files namespace — same surface as client.files(ref) but pre-bound
// ---------------------------------------------------------------------------

class DatabaseFiles {
  private readonly ref: string;
  private readonly http: HttpClient;
  /** Pre-computed paths — set once at construction. */
  private readonly FILES: string;
  private readonly FILE_ITEM: (id: string) => string;

  constructor(ref: string, http: HttpClient, pathBuilder: PathBuilder) {
    this.ref       = ref;
    this.http      = http;
    this.FILES     = pathBuilder.files(ref);
    this.FILE_ITEM = (id) => pathBuilder.fileItem(ref, id);
  }

  private async req<T>(method: 'GET' | 'DELETE', path: string): Promise<T> {
    const res =
      method === 'GET'
        ? await this.http.get<T>(path)
        : await this.http.delete<T>(path);
    if (res.isError()) {
      throw MesahubError.fromResponse(
        { status: res.status, statusText: res.statusText } as Response,
        res.data,
      );
    }
    return res.data as T;
  }

  /** List files stored in this database. */
  list(
    opts: { limit?: number; offset?: number; folderPrefix?: string } = {},
  ): Promise<{ files: FileRecord[] }> {
    const params = new URLSearchParams();
    if (opts.limit        != null) params.set('limit',         String(opts.limit));
    if (opts.offset       != null) params.set('offset',        String(opts.offset));
    if (opts.folderPrefix != null) params.set('folder_prefix', opts.folderPrefix);
    const qs = params.size ? `?${params}` : '';
    const fp = this.FILES + qs;
    return this.req('GET', fp);
  }

  /** Upload a file via multipart/form-data. */
  async upload(
    file:        Blob | ArrayBuffer,
    filename:    string,
    contentType?: string,
  ): Promise<FileRecord> {
    const form = new FormData();
    const blob =
      file instanceof Blob
        ? file
        : new Blob([file], { type: contentType ?? 'application/octet-stream' });
    form.append('file', blob, filename);
    const res = await this.http.send({
      method: 'POST',
      url:    this.FILES,
      body:   form,
    });
    if (res.isError()) {
      throw MesahubError.fromResponse(
        { status: res.status, statusText: res.statusText } as Response,
        res.data,
      );
    }
    return res.data as FileRecord;
  }

  /** Download a file — returns a StreamResponse for efficient streaming. */
  download(fileId: string): Promise<StreamResponse> {
    return this.http.getStream(this.FILE_ITEM(fileId));
  }

  /** Delete a file by ID. */
  async delete(fileId: string): Promise<void> {
    await this.req('DELETE', this.FILE_ITEM(fileId));
  }
}
