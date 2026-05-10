/**
 * MesahubManagementClient — management-plane SDK for MesaHub.
 *
 * Talks to the MesaHub dashboard (Next.js) using a shs_ API key.
 * Provides CRUD for databases, buckets, and API keys.
 *
 * Usage:
 * ```typescript
 * const mgmt = new MesahubManagementClient({
 *   dashboardUrl: 'https://www.mesahub.app',
 *   apiKey: 'shs_...',
 * });
 *
 * const dbs = await mgmt.databases.list();
 * const db  = await mgmt.databases.create('my-app-db');
 * await mgmt.databases.delete(db.id);
 * ```
 */

export interface ManagementClientConfig {
  /** Dashboard URL — scheme + host + optional port, **no path**. e.g. `https://www.mesahub.app` */
  dashboardUrl: string;
  /** shs_ API key */
  apiKey: string;
}

export interface DatabaseRecord {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  status: string;
  size_bytes: number;
  created_at: string;
  updated_at: string;
}

export interface BucketRecord {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  status: string;
  size_bytes: number;
  created_at: string;
  updated_at: string;
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  scopes: string[];
  status: string;
  created_at: string;
  last_used_at: string | null;
}

export interface CreateApiKeyResult {
  id: string;
  name: string;
  /** The raw token — only returned on creation, never stored. */
  key: string;
}

export interface ImportResult {
  rows_imported?: number;
  size_bytes?: number;
}

export interface ExportOptions {
  /** Table names to export. Required — at least one table must be specified. */
  tables: string[];
  /** Optional filename hint for the response Content-Disposition header. */
  filename?: string;
}

export interface ImportOptions {
  /** Table names to import from the source file. If omitted, all tables are imported. */
  tables?: string[];
}

class ManagementError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ManagementError';
  }
}

export class MesahubManagementClient {
  private readonly base: string;
  private readonly headers: Record<string, string>;

  constructor(config: ManagementClientConfig) {
    this.base = config.dashboardUrl.replace(/\/$/, '');
    this.headers = {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: this.headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string };
      throw new ManagementError(res.status, data.error ?? `HTTP ${res.status}`);
    }
    if (res.status === 204) return undefined as unknown as T;
    return res.json() as Promise<T>;
  }

  readonly databases = {
    /** List all databases owned by the authenticated user. */
    list: (): Promise<DatabaseRecord[]> =>
      this.req('GET', '/api/user/databases'),

    /** Get a single database by ID. */
    get: (id: string): Promise<DatabaseRecord> =>
      this.req('GET', `/api/user/databases/${encodeURIComponent(id)}`),

    /** Create a new database. Name must be 3–50 lowercase alphanumeric chars, dashes, or underscores. */
    create: (name: string, opts?: { description?: string }): Promise<DatabaseRecord> =>
      this.req('POST', '/api/user/databases', { name, ...opts }),

    /** Delete a database by ID. */
    delete: (id: string): Promise<void> =>
      this.req('DELETE', `/api/user/databases/${encodeURIComponent(id)}`),

    /** Update a database's name or description. */
    update: (id: string, changes: { name?: string; description?: string }): Promise<DatabaseRecord> =>
      this.req('PATCH', `/api/user/databases/${encodeURIComponent(id)}`, changes),

    /**
     * Export selected tables from a database as a SQLite file.
     * Returns the raw Response so callers can stream or buffer the bytes.
     */
    export: async (id: string, opts: ExportOptions): Promise<Response> => {
      const res = await fetch(`${this.base}/api/user/databases/${encodeURIComponent(id)}/export`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ tables: opts.tables, filename: opts.filename }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new ManagementError(res.status, data.error ?? `HTTP ${res.status}`);
      }
      return res;
    },

    /**
     * Import tables from a SQLite file into a database.
     *
     * Phase 1 (no `tables` option): inspects the file and returns the available table list.
     * Phase 2 (`tables` provided): copies the selected tables into the target database.
     */
    import: async (id: string, file: Blob | File, opts?: ImportOptions): Promise<ImportResult | { tables: string[] }> => {
      const fd = new FormData();
      fd.append('file', file);
      if (opts?.tables) {
        fd.append('tables', JSON.stringify(opts.tables));
      }
      // Remove Content-Type so fetch sets the multipart boundary automatically
      const { 'Content-Type': _, ...uploadHeaders } = this.headers;
      const res = await fetch(`${this.base}/api/user/databases/${encodeURIComponent(id)}/import`, {
        method: 'POST',
        headers: uploadHeaders,
        body: fd,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new ManagementError(res.status, data.error ?? `HTTP ${res.status}`);
      }
      return res.json() as Promise<ImportResult | { tables: string[] }>;
    },
  };

  readonly buckets = {
    /** List all buckets owned by the authenticated user. */
    list: (): Promise<BucketRecord[]> =>
      this.req('GET', '/api/user/buckets'),

    /** Get a single bucket by ID. */
    get: (id: string): Promise<BucketRecord> =>
      this.req('GET', `/api/user/buckets/${encodeURIComponent(id)}`),

    /** Create a new bucket. Name must be 3–50 lowercase alphanumeric chars, dashes, or underscores. */
    create: (name: string, opts?: { description?: string }): Promise<BucketRecord> =>
      this.req('POST', '/api/user/buckets', { name, ...opts }),

    /** Delete a bucket by ID. */
    delete: (id: string): Promise<void> =>
      this.req('DELETE', `/api/user/buckets/${encodeURIComponent(id)}`),

    /** Update a bucket's name or description. */
    update: (id: string, changes: { name?: string; description?: string }): Promise<BucketRecord> =>
      this.req('PATCH', `/api/user/buckets/${encodeURIComponent(id)}`, changes),
  };

  readonly apiKeys = {
    /** List all API keys for the authenticated user. */
    list: (): Promise<ApiKeyRecord[]> =>
      this.req('GET', '/api/user/api-keys'),

    /** Create a new API key. The raw token is only returned once. */
    create: (name: string, scopes: string[] = ['all:w']): Promise<CreateApiKeyResult> =>
      this.req('POST', '/api/user/api-keys', { name, scopes }),

    /** Revoke an API key by ID. */
    revoke: (id: string): Promise<void> =>
      this.req('DELETE', `/api/user/api-keys/${encodeURIComponent(id)}`),
  };
}
