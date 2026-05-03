import type {
  ExecResult,
  FindOptions,
  UpdateOptions,
  DeleteOptions,
  CountOptions,
  InsertManyOptions,
} from './types.js';
import { buildWhere, quoteIdent } from './where.js';

type QueryFn  = (sql: string, bindings?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; columns: string[]; rowCount: number; queryDurationMs: number | null }>;
type ExecFn   = (sql: string, bindings?: unknown[]) => Promise<ExecResult>;

/**
 * TableHandle<T> — high-level, type-safe access to a single SQLite table.
 *
 * Obtained via `client.db(ref).table<T>('table_name')`.
 *
 * All methods generate parameterised SQL and delegate to the underlying
 * `query` / `exec` transport — no raw string interpolation, injection-safe.
 *
 * @example
 * const users = client.db('my-db').table<User>('users');
 *
 * const all   = await users.find({ where: { active: true }, limit: 20 });
 * const one   = await users.findOne({ where: { id: 42 } });
 * const count = await users.count({ where: { active: false } });
 * const row   = await users.insert({ name: 'Alice', active: true });
 * await users.update({ where: { id: 42 }, set: { name: 'Alice Smith' } });
 * await users.delete({ where: { id: 42 } });
 */
export class TableHandle<T extends Record<string, unknown> = Record<string, unknown>> {
  private readonly tbl: string;
  private readonly queryFn: QueryFn;
  private readonly execFn: ExecFn;
  /** Routes through /exec but parses the rows-style response (for RETURNING *). */
  private readonly writeQueryFn: QueryFn;

  constructor(tableName: string, queryFn: QueryFn, execFn: ExecFn, writeQueryFn: QueryFn) {
    this.tbl          = quoteIdent(tableName);
    this.queryFn      = queryFn;
    this.execFn       = execFn;
    this.writeQueryFn = writeQueryFn;
  }

  // ---------------------------------------------------------------------------
  // READ
  // ---------------------------------------------------------------------------

  /**
   * Fetch multiple rows.
   *
   * @example
   * await users.find({ where: { active: true }, orderBy: [{ column: 'name' }], limit: 10 })
   */
  async find(opts: FindOptions<T> = {}): Promise<T[]> {
    const { sql, bindings } = this._buildSelect(opts);
    const result = await this.queryFn(sql, bindings);
    return result.rows as T[];
  }

  /**
   * Fetch a single row or `null` if not found.
   *
   * @example
   * const user = await users.findOne({ where: { id: 1 } });
   */
  async findOne(opts: Omit<FindOptions<T>, 'limit' | 'offset'> = {}): Promise<T | null> {
    const rows = await this.find({ ...opts, limit: 1, offset: undefined });
    return rows[0] ?? null;
  }

  /**
   * Return the count of rows matching the optional filter.
   *
   * @example
   * const n = await users.count({ where: { active: true } });
   */
  async count(opts: CountOptions<T> = {}): Promise<number> {
    const where = buildWhere(opts.where);
    const whereSql = where.sql ? ` WHERE ${where.sql}` : '';
    const sql = `SELECT COUNT(*) AS "_count" FROM ${this.tbl}${whereSql}`;
    const result = await this.queryFn(sql, where.bindings);
    const row = result.rows[0];
    if (!row) return 0;
    const val = row['_count'] ?? row['COUNT(*)'] ?? 0;
    return Number(val);
  }

  // ---------------------------------------------------------------------------
  // WRITE
  // ---------------------------------------------------------------------------

  /**
   * Insert a single row and return the inserted record (uses `RETURNING *`).
   *
   * Requires SQLite 3.35+ (shipped with modern Go sqlite builds).
   *
   * @example
   * const user = await users.insert({ name: 'Alice', active: true });
   */
  async insert(data: Partial<T>): Promise<T> {
    const keys = Object.keys(data) as (keyof T & string)[];
    if (keys.length === 0) throw new Error('insert() called with empty data object');

    const cols     = keys.map(quoteIdent).join(', ');
    const placeholders = keys.map(() => '?').join(', ');
    const bindings = keys.map(k => data[k] as unknown);
    const sql = `INSERT INTO ${this.tbl} (${cols}) VALUES (${placeholders}) RETURNING *`;

    const result = await this.writeQueryFn(sql, bindings);
    const row = result.rows[0];
    if (!row) throw new Error('insert() returned no row from RETURNING *');
    return row as T;
  }

  /**
   * Insert multiple rows in a single statement.
   *
   * Column order is derived from the first row. All rows must share the same keys.
   * Returns `ExecResult` (no per-row RETURNING).
   *
   * @example
   * await users.insertMany([{ name: 'Alice' }, { name: 'Bob' }]);
   *
   * // Ignore duplicates
   * await users.insertMany(rows, { onConflict: 'ignore' });
   */
  async insertMany(rows: Partial<T>[], opts: InsertManyOptions<T> = {}): Promise<ExecResult> {
    if (rows.length === 0) throw new Error('insertMany() called with empty rows array');

    const keys = Object.keys(rows[0]!) as (keyof T & string)[];
    if (keys.length === 0) throw new Error('insertMany() first row has no columns');

    const cols = keys.map(quoteIdent).join(', ');
    const rowPlaceholders = `(${keys.map(() => '?').join(', ')})`;

    let conflict = '';
    if (opts.onConflict === 'ignore') {
      conflict = ' OR IGNORE';
    } else if (opts.onConflict === 'replace') {
      conflict = ' OR REPLACE';
    }

    const allPlaceholders = rows.map(() => rowPlaceholders).join(', ');
    const bindings: unknown[] = [];
    for (const row of rows) {
      for (const k of keys) {
        bindings.push(row[k] as unknown);
      }
    }

    const sql = `INSERT${conflict} INTO ${this.tbl} (${cols}) VALUES ${allPlaceholders}`;
    return this.execFn(sql, bindings);
  }

  /**
   * Update rows matching the filter. `where` is required to prevent accidental full-table updates.
   *
   * @example
   * await users.update({ where: { id: 1 }, set: { name: 'Alice Smith' } });
   */
  async update(opts: UpdateOptions<T>): Promise<ExecResult> {
    const setKeys = Object.keys(opts.set) as (keyof T & string)[];
    if (setKeys.length === 0) throw new Error('update() called with empty set object');

    const setClauses  = setKeys.map(k => `${quoteIdent(k)} = ?`).join(', ');
    const setBindings = setKeys.map(k => opts.set[k] as unknown);

    const where = buildWhere(opts.where);
    if (!where.sql) throw new Error('update() requires a non-empty where clause');

    const sql = `UPDATE ${this.tbl} SET ${setClauses} WHERE ${where.sql}`;
    return this.execFn(sql, [...setBindings, ...where.bindings]);
  }

  /**
   * Delete rows matching the filter. `where` is required to prevent accidental full-table deletes.
   *
   * @example
   * await users.delete({ where: { id: 1 } });
   */
  async delete(opts: DeleteOptions<T>): Promise<ExecResult> {
    const where = buildWhere(opts.where);
    if (!where.sql) throw new Error('delete() requires a non-empty where clause');

    const sql = `DELETE FROM ${this.tbl} WHERE ${where.sql}`;
    return this.execFn(sql, where.bindings);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private _buildSelect(opts: FindOptions<T>): { sql: string; bindings: unknown[] } {
    const selectCols =
      opts.select && opts.select.length > 0
        ? opts.select.map(quoteIdent).join(', ')
        : '*';

    const where = buildWhere(opts.where);
    const whereSql = where.sql ? ` WHERE ${where.sql}` : '';

    let orderSql = '';
    if (opts.orderBy && opts.orderBy.length > 0) {
      const terms = opts.orderBy.map(o => {
        const dir = o.direction === 'desc' ? ' DESC' : ' ASC';
        return `${quoteIdent(o.column)}${dir}`;
      });
      orderSql = ` ORDER BY ${terms.join(', ')}`;
    }

    const limitSql  = opts.limit  != null ? ` LIMIT ${Number(opts.limit)}`   : '';
    const offsetSql = opts.offset != null ? ` OFFSET ${Number(opts.offset)}` : '';

    const sql = `SELECT ${selectCols} FROM ${this.tbl}${whereSql}${orderSql}${limitSql}${offsetSql}`;
    return { sql, bindings: where.bindings };
  }
}
