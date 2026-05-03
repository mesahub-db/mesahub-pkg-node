/**
 * TypeScript types for @mesahub/client
 */

// ---------------------------------------------------------------------------
// High-level table API types
// ---------------------------------------------------------------------------

/**
 * Per-column filter operators.
 *
 * Short-hand: `{ id: 1 }` is equivalent to `{ id: { eq: 1 } }`.
 *
 * @example
 * { age: { gte: 18 }, name: { like: '%alice%' }, deleted_at: { isNull: true } }
 */
export type WhereOperator<V> =
  | V
  | { eq: V }
  | { ne: V }
  | { gt: V }
  | { gte: V }
  | { lt: V }
  | { lte: V }
  | { like: string }
  | { notLike: string }
  | { in: V[] }
  | { notIn: V[] }
  | { isNull: true }
  | { isNotNull: true };

/** WHERE clause — each key maps to a column filter. All conditions are AND-ed. */
export type WhereClause<T> = {
  [K in keyof T]?: WhereOperator<T[K]>;
};

export interface FindOptions<T> {
  /** Column filters — all conditions are combined with AND. */
  where?: WhereClause<T>;
  /** Columns to include in the SELECT (defaults to all). */
  select?: (keyof T & string)[];
  /** Sort order. Multiple entries produce ORDER BY a, b, c. */
  orderBy?: { column: keyof T & string; direction?: 'asc' | 'desc' }[];
  limit?: number;
  offset?: number;
}

export interface UpdateOptions<T> {
  /** Rows to update — required. */
  where: WhereClause<T>;
  /** Columns to change — required. */
  set: Partial<T>;
}

export interface DeleteOptions<T> {
  /** Rows to delete — required. */
  where: WhereClause<T>;
}

export interface CountOptions<T> {
  where?: WhereClause<T>;
}

export interface InsertManyOptions<T> {
  /** Skip duplicate rows instead of failing (INSERT OR IGNORE). */
  onConflict?: 'ignore' | 'replace';
  /** Columns to consider when detecting conflict for 'replace' strategy. */
  conflictColumns?: (keyof T & string)[];
}

// ---------------------------------------------------------------------------
// Raw query / exec result types
// ---------------------------------------------------------------------------

export interface QueryResult {
  rows: Record<string, unknown>[];
  columns: string[];
  rowCount: number;
  /** Server-side query duration in milliseconds (from stat.queryDurationMs). */
  queryDurationMs: number | null;
}

export interface ExecResult {
  rowsAffected: number;
  lastInsertRowid?: number;
  /** Server-side execution duration in milliseconds (from stat.queryDurationMs). */
  queryDurationMs: number | null;
}

export interface FileRecord {
  id: string;
  filename: string;
  folder_path?: string;
  size_bytes: number;
  content_type?: string;
  url: string;
  uploaded_at: string;
  expires_at?: string | null;
  metadata?: string | null;
}

