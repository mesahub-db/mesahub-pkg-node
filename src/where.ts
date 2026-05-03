import type { WhereClause, WhereOperator } from './types.js';

export interface CompiledWhere {
  sql: string;
  bindings: unknown[];
}

/**
 * Compile a WhereClause<T> into a parameterised SQL fragment (no leading WHERE).
 *
 * Returns `{ sql: '', bindings: [] }` when the clause is empty or undefined
 * so callers can safely prepend " WHERE " only when sql is non-empty.
 */
export function buildWhere<T>(clause?: WhereClause<T>): CompiledWhere {
  if (!clause) return { sql: '', bindings: [] };

  const parts: string[] = [];
  const bindings: unknown[] = [];

  for (const key of Object.keys(clause) as (keyof T & string)[]) {
    const col = quoteIdent(key);
    const op = clause[key] as WhereOperator<unknown>;

    if (op === null || op === undefined) continue;

    if (typeof op !== 'object' || Array.isArray(op)) {
      // short-hand equality — `{ id: 1 }` or `{ tags: ['a', 'b'] }`
      parts.push(`${col} = ?`);
      bindings.push(op);
      continue;
    }

    // operator object
    const keys = Object.keys(op as Record<string, unknown>);

    if (keys.includes('isNull')) {
      parts.push(`${col} IS NULL`);
    } else if (keys.includes('isNotNull')) {
      parts.push(`${col} IS NOT NULL`);
    } else if (keys.includes('eq')) {
      parts.push(`${col} = ?`);
      bindings.push((op as { eq: unknown }).eq);
    } else if (keys.includes('ne')) {
      parts.push(`${col} != ?`);
      bindings.push((op as { ne: unknown }).ne);
    } else if (keys.includes('gt')) {
      parts.push(`${col} > ?`);
      bindings.push((op as { gt: unknown }).gt);
    } else if (keys.includes('gte')) {
      parts.push(`${col} >= ?`);
      bindings.push((op as { gte: unknown }).gte);
    } else if (keys.includes('lt')) {
      parts.push(`${col} < ?`);
      bindings.push((op as { lt: unknown }).lt);
    } else if (keys.includes('lte')) {
      parts.push(`${col} <= ?`);
      bindings.push((op as { lte: unknown }).lte);
    } else if (keys.includes('like')) {
      parts.push(`${col} LIKE ?`);
      bindings.push((op as { like: string }).like);
    } else if (keys.includes('notLike')) {
      parts.push(`${col} NOT LIKE ?`);
      bindings.push((op as { notLike: string }).notLike);
    } else if (keys.includes('in')) {
      const vals = (op as { in: unknown[] }).in;
      if (vals.length === 0) {
        // IN () is invalid SQL — produce a always-false expression
        parts.push('1 = 0');
      } else {
        const placeholders = vals.map(() => '?').join(', ');
        parts.push(`${col} IN (${placeholders})`);
        bindings.push(...vals);
      }
    } else if (keys.includes('notIn')) {
      const vals = (op as { notIn: unknown[] }).notIn;
      if (vals.length === 0) {
        // NOT IN () — always true, skip
      } else {
        const placeholders = vals.map(() => '?').join(', ');
        parts.push(`${col} NOT IN (${placeholders})`);
        bindings.push(...vals);
      }
    } else {
      // Unknown operator shape — treat as equality (safe fallback)
      parts.push(`${col} = ?`);
      bindings.push(op);
    }
  }

  return { sql: parts.join(' AND '), bindings };
}

/**
 * Quote a column / table identifier using double-quotes, escaping any
 * embedded double-quotes per the SQL standard.
 */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
