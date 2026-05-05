/**
 * MesahubClient — data-plane SDK for MesaHub.
 *
 * Talks directly to the Go template server (apiUrl) using a shs_ API key.
 * Uses @pingpong-js/fetch as the HTTP agent (undici in Node.js, native fetch in browsers).
 *
 * Usage:
 * ```typescript
 * const client = new MesahubClient({ apiKey: 'shs_...', apiUrl: 'https://api.yourapp.com' });
 * const result = await client.query('db-uuid-or-slug', 'SELECT * FROM users LIMIT 10');
 * ```
 *
 * Connection string usage:
 * ```typescript
 * const { apiUrl, apiKey, dbName } = parseMesahubUrl(process.env.MESAHUB_URL!);
 * const client = new MesahubClient({ apiUrl, apiKey });
 * const db = client.db(dbName);
 * ```
 */

import pingpong from '@pingpong-js/fetch';
import type { HttpClient, StreamResponse } from '@pingpong-js/fetch';
import { MesahubError } from './errors.js';
import type { QueryResult, ExecResult, FileRecord } from './types.js';
import { DatabaseHandle } from './database.js';

export interface MesahubClientConfig {
  /** shs_ API key */
  apiKey: string;
  /**
   * Go data-plane origin — scheme + host + optional port, **no path**.
   * e.g. `https://api.yourapp.com` or `http://localhost:4004`
   */
  apiUrl: string;
  /**
   * Route prefix for data-plane endpoints.
   * - `'v1'` (default) — `/v1/query/{ref}` etc; for hosted instances behind Caddy.
   * - `'api'` — `/api/db/{ref}/query` etc; for embedded/direct Go access (localhost).
   *
   * Set automatically by `parseMesahubUrl()`.
   */
  routePrefix?: 'api' | 'v1';
}

export class MesahubClient {
  private http: HttpClient;
  /** Path builders set once at construction — no branching at call sites. */
  private readonly _path: {
    query:    (ref: string) => string;
    exec:     (ref: string) => string;
    files:    (ref: string) => string;
    fileItem: (ref: string, id: string) => string;
  };

  constructor(config: MesahubClientConfig) {
    const baseURL = config.apiUrl.replace(/\/v1\/?$/, '').replace(/\/api\/?$/, '').replace(/\/$/, '');
    this.http = pingpong.create({
      baseURL,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
    });
    if ((config.routePrefix ?? 'v1') === 'api') {
      this._path = {
        query:    (ref) => `/api/db/${ref}/query`,
        exec:     (ref) => `/api/db/${ref}/exec`,
        files:    (ref) => `/api/db/${ref}/files`,
        fileItem: (ref, id) => `/api/db/${ref}/files/${id}`,
      };
    } else {
      this._path = {
        query:    (ref) => `/v1/query/${ref}`,
        exec:     (ref) => `/v1/exec/${ref}`,
        files:    (ref) => `/v1/files/${ref}`,
        fileItem: (ref, id) => `/v1/files/${ref}/${id}`,
      };
    }
  }

  private async req<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
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

  /** Execute a read-only SQL query (SELECT / WITH / PRAGMA). */
  async query(ref: string, sql: string, bindings: unknown[] = []): Promise<QueryResult> {
    const raw = await this.req<any>('POST', this._path.query(ref), { sql, bindings });
    // Server returns { headers: [{name, displayName, ...}], rows, stat }
    const columns: string[] = Array.isArray(raw.headers)
      ? raw.headers.map((h: { name: string }) => h.name)
      : (raw.columns ?? []);
    return { columns, rows: raw.rows ?? [], rowCount: (raw.rows ?? []).length, queryDurationMs: raw.stat?.queryDurationMs ?? null };
  }

  /** Execute a write SQL statement (INSERT / UPDATE / DELETE / CREATE …). */
  async exec(ref: string, sql: string, bindings: unknown[] = []): Promise<ExecResult> {
    const raw = await this.req<any>('POST', this._path.exec(ref), { sql, bindings });
    return {
      rowsAffected: raw.rowsAffected ?? raw.stat?.rowsAffected ?? 0,
      lastInsertRowid: raw.lastInsertRowid,
      queryDurationMs: raw.stat?.queryDurationMs ?? null,
    };
  }

  /**
   * Return a `DatabaseHandle` scoped to a single database reference (UUID or slug).
   *
   * This is the preferred entry point for high-level table operations.
   *
   * @example
   * const db    = client.db('my-db');
   * const users = db.table<User>('users');
   *
   * const all  = await users.find({ where: { active: true } });
   * const one  = await users.findOne({ where: { id: 1 } });
   * const row  = await users.insert({ name: 'Alice', active: true });
   * await users.update({ where: { id: 1 }, set: { name: 'Alice Smith' } });
   * await users.delete({ where: { id: 1 } });
   *
   * // Raw SQL still available
   * const result = await db.query('SELECT * FROM users LIMIT 5');
   *
   * // Files
   * const list = await db.files.list({ limit: 10 });
   */
  db(ref: string): DatabaseHandle {
    return new DatabaseHandle(ref, this.http, this._path);
  }

  /** File operations scoped to a database reference. */
  files(ref: string) {
    const http  = this.http;
    const req   = this.req.bind(this);
    const path  = this._path;

    return {
      /** List files stored in this database. */
      list(opts: { limit?: number; offset?: number; folderPrefix?: string } = {}): Promise<{ files: FileRecord[] }> {
        const params = new URLSearchParams();
        if (opts.limit        != null) params.set('limit',         String(opts.limit));
        if (opts.offset       != null) params.set('offset',        String(opts.offset));
        if (opts.folderPrefix != null) params.set('folder_prefix', opts.folderPrefix);
        const qs = params.size ? `?${params}` : '';
        return req('GET', `${path.files(ref)}${qs}`);
      },

      /** Upload a file via multipart/form-data. */
      async upload(file: Blob | ArrayBuffer, filename: string, contentType?: string): Promise<FileRecord> {
        const form = new FormData();
        const blob =
          file instanceof Blob
            ? file
            : new Blob([file], { type: contentType ?? 'application/octet-stream' });
        form.append('file', blob, filename);
        const res = await http.send({
          method: 'POST',
          url:    path.files(ref),
          body:   form,
        });
        if (res.isError()) {
          throw MesahubError.fromResponse(
            { status: res.status, statusText: res.statusText } as Response,
            res.data,
          );
        }
        return res.data as FileRecord;
      },

      /** Download a file — returns a StreamResponse for efficient streaming. */
      download(fileId: string): Promise<StreamResponse> {
        return http.getStream(path.fileItem(ref, fileId));
      },

      /** Delete a file by ID. */
      async delete(fileId: string): Promise<void> {
        await req('DELETE', path.fileItem(ref, fileId));
      },
    };
  }
}

// ── Connection string ──────────────────────────────────────────────────────────

export interface ParsedMesahubUrl {
  /** HTTP(S) origin of the mesahub core server — no path suffix. */
  apiUrl: string;
  /** API key or admin token to use in Authorization headers. */
  apiKey: string;
  /** Database slug / name extracted from the URL path. */
  dbName: string;
  /**
   * Route prefix derived from the host:
   * - `'api'` when host is localhost/127.0.0.1 (embedded/direct Go access)
   * - `'v1'`  when host is a remote domain (hosted, behind Caddy)
   */
  routePrefix: 'api' | 'v1';
}

/**
 * Parse a `mh://` connection string into its component parts.
 *
 * Format: `mh://apikey@host[:port]/dbname`
 *
 * Examples:
 * ```
 * mh://shs_abc@mycore.railway.app/mydb     → HTTPS, external
 * mh://secret@localhost:3000/mydb          → HTTP, local
 * ```
 *
 * The special form `mh://local/dbname` (embedded mode placeholder) cannot be
 * parsed here — it must be resolved to a concrete URL by the container's
 * start.sh before the application process starts.
 */
export function parseMesahubUrl(raw: string): ParsedMesahubUrl {
  if (!raw.startsWith('mh://')) {
    throw new Error(`Invalid MESAHUB_URL: must start with mh:// (got: ${JSON.stringify(raw.slice(0, 30))})`);
  }

  // Replace scheme so the built-in URL constructor can parse it.
  const parsed = new URL(raw.replace(/^mh:\/\//, 'http://'));
  const host = parsed.hostname;

  if (host === 'local') {
    throw new Error(
      'mh://local/... is the embedded mode placeholder — it must be resolved to a ' +
      'concrete URL by start.sh before the application starts. ' +
      'In embedded mode, start.sh rewrites MESAHUB_URL to mh://token@localhost:PORT/db.',
    );
  }

  const isLocalhost = host === 'localhost' || host === '127.0.0.1';
  // Hostnames with no dots are Docker/internal service names (e.g. "myservice").
  // Hostnames ending in .internal are private network domains (e.g. *.railway.internal).
  // Both must use plain HTTP — TLS is not available on these networks.
  const isPrivate = isLocalhost || !host.includes('.') || host.endsWith('.internal');
  const scheme = isPrivate ? 'http' : 'https';
  const portPart = parsed.port ? `:${parsed.port}` : '';
  const apiUrl = `${scheme}://${host}${portPart}`;

  const apiKey = decodeURIComponent(parsed.username);
  if (!apiKey) {
    throw new Error('MESAHUB_URL must include an API key: mh://apikey@host/dbname');
  }

  const dbName = parsed.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!dbName) {
    throw new Error('MESAHUB_URL must include a database name: mh://apikey@host/dbname');
  }

  const routePrefix: 'api' | 'v1' = isPrivate ? 'api' : 'v1';

  return { apiUrl, apiKey, dbName, routePrefix };
}
