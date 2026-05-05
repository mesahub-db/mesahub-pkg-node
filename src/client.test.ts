/**
 * @mesahub/client — unit tests
 *
 * The client's sole job: given an API key + DB ref, query / exec / manage files.
 * Management-plane concerns (user profile, database CRUD, API keys) are out of scope.
 *
 * fetch is mocked at the @pingpong-js/fetch level so no live server is needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MesahubClient } from './client.js'
import { MesahubError } from './errors.js'

// ── mock setup ────────────────────────────────────────────────────────────────

const { mockGet, mockPost, mockDelete } = vi.hoisted(() => ({
  mockGet:    vi.fn(),
  mockPost:   vi.fn(),
  mockDelete: vi.fn(),
}))

vi.mock('@pingpong-js/fetch', () => ({
  default: {
    create: () => ({
      get:    mockGet,
      post:   mockPost,
      delete: mockDelete,
    }),
  },
}))

function ok<T>(data: T, status = 200) {
  return { isError: () => false, data, status }
}
function err(status: number, code: string, message: string) {
  return { isError: () => true, data: { code, message }, status, statusText: message }
}

const DB_REF = 'db-uuid-123'

function client() {
  return new MesahubClient({
    apiKey: 'shs_testkey',
    apiUrl: 'http://localhost:4004',
  })
}

beforeEach(() => {
  vi.resetAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// client.db(ref)
// ─────────────────────────────────────────────────────────────────────────────

describe('client.db(ref)', () => {
  it('returns a DatabaseHandle', () => {
    const db = client().db(DB_REF)
    expect(db).toBeDefined()
    expect(typeof db.query).toBe('function')
    expect(typeof db.exec).toBe('function')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// query
// ─────────────────────────────────────────────────────────────────────────────

describe('db.query', () => {
  it('posts to /v1/query/:ref and returns rows + columns', async () => {
    mockPost.mockResolvedValueOnce(ok({
      rows:    [{ id: 1, name: 'Alice' }],
      columns: ['id', 'name'],
      stat:    { queryDurationMs: 2 },
    }))
    const result = await client().db(DB_REF).query('SELECT * FROM users')
    expect(result.rows).toEqual([{ id: 1, name: 'Alice' }])
    expect(result.columns).toEqual(['id', 'name'])
    expect(result.rowCount).toBe(1)
    expect(result.queryDurationMs).toBe(2)
    expect(mockPost).toHaveBeenCalledWith(
      `/v1/query/${DB_REF}`,
      { sql: 'SELECT * FROM users', bindings: [] },
    )
  })

  it('sends empty bindings array when omitted', async () => {
    mockPost.mockResolvedValueOnce(ok({ rows: [], columns: [], stat: null }))
    await client().db(DB_REF).query('SELECT 1')
    expect(mockPost).toHaveBeenCalledWith(
      `/v1/query/${DB_REF}`,
      { sql: 'SELECT 1', bindings: [] },
    )
  })

  it('forwards bindings', async () => {
    mockPost.mockResolvedValueOnce(ok({ rows: [], columns: [], stat: null }))
    await client().db(DB_REF).query('SELECT * FROM t WHERE id = ?', [42])
    expect(mockPost).toHaveBeenCalledWith(
      `/v1/query/${DB_REF}`,
      { sql: 'SELECT * FROM t WHERE id = ?', bindings: [42] },
    )
  })

  it('normalises server headers array into column names', async () => {
    mockPost.mockResolvedValueOnce(ok({
      headers: [{ name: 'id', displayName: 'ID' }, { name: 'email', displayName: 'Email' }],
      rows:    [{ id: 1, email: 'a@b.com' }],
      stat:    null,
    }))
    const result = await client().db(DB_REF).query('SELECT id, email FROM users')
    expect(result.columns).toEqual(['id', 'email'])
  })

  it('throws MesahubError on server error', async () => {
    mockPost.mockResolvedValueOnce(err(500, 'DB_ERROR', 'Something went wrong'))
    await expect(client().db(DB_REF).query('SELECT 1')).rejects.toBeInstanceOf(MesahubError)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// exec
// ─────────────────────────────────────────────────────────────────────────────

describe('db.exec', () => {
  it('posts to /v1/exec/:ref and returns affected rows', async () => {
    mockPost.mockResolvedValueOnce(ok({ rowsAffected: 1, lastInsertRowid: 42, stat: null }))
    const result = await client().db(DB_REF).exec(
      'INSERT INTO users (name) VALUES (?)',
      ['Alice'],
    )
    expect(result.rowsAffected).toBe(1)
    expect(result.lastInsertRowid).toBe(42)
    expect(mockPost).toHaveBeenCalledWith(
      `/v1/exec/${DB_REF}`,
      { sql: 'INSERT INTO users (name) VALUES (?)', bindings: ['Alice'] },
    )
  })

  it('forwards numeric and string bindings', async () => {
    mockPost.mockResolvedValueOnce(ok({ rowsAffected: 1, stat: null }))
    await client().db(DB_REF).exec(
      'UPDATE items SET price = ? WHERE id = ?',
      [9.99, 'item-1'],
    )
    expect(mockPost).toHaveBeenCalledWith(
      `/v1/exec/${DB_REF}`,
      { sql: 'UPDATE items SET price = ? WHERE id = ?', bindings: [9.99, 'item-1'] },
    )
  })

  it('throws MesahubError on server error', async () => {
    mockPost.mockResolvedValueOnce(err(400, 'SYNTAX_ERROR', 'syntax error'))
    await expect(
      client().db(DB_REF).exec('INSER INTO t VALUES (1)'),
    ).rejects.toBeInstanceOf(MesahubError)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// files
// ─────────────────────────────────────────────────────────────────────────────

describe('db.files.list', () => {
  it('GETs /v1/files/:ref', async () => {
    mockGet.mockResolvedValueOnce(ok({ files: [] }))
    await client().db(DB_REF).files.list()
    expect(mockGet).toHaveBeenCalledWith(`/v1/files/${DB_REF}`)
  })

  it('appends limit and offset query params', async () => {
    mockGet.mockResolvedValueOnce(ok({ files: [] }))
    await client().db(DB_REF).files.list({ limit: 10, offset: 20 })
    expect(mockGet).toHaveBeenCalledWith(`/v1/files/${DB_REF}?limit=10&offset=20`)
  })
})

describe('db.files.delete', () => {
  it('DELETEs /v1/files/:ref/:fileId', async () => {
    mockDelete.mockResolvedValueOnce(ok(undefined, 204))
    await client().db(DB_REF).files.delete('file-uuid-1')
    expect(mockDelete).toHaveBeenCalledWith(`/v1/files/${DB_REF}/file-uuid-1`)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Error handling
// ─────────────────────────────────────────────────────────────────────────────

describe('error handling', () => {
  it('includes status code on MesahubError', async () => {
    mockPost.mockResolvedValueOnce(err(403, 'PLAN_LIMIT', 'Plan limit reached'))
    try {
      await client().db(DB_REF).query('SELECT 1')
      expect.fail('expected to throw')
    } catch (e) {
      expect(e).toBeInstanceOf(MesahubError)
      expect((e as MesahubError).statusCode).toBe(403)
      expect((e as MesahubError).code).toBe('PLAN_LIMIT')
    }
  })

  it('uses UNKNOWN_ERROR when server returns no code', async () => {
    mockPost.mockResolvedValueOnce({ isError: () => true, data: {}, status: 500, statusText: 'Internal Server Error' })
    try {
      await client().db(DB_REF).exec('INSERT INTO t VALUES (1)')
      expect.fail('expected to throw')
    } catch (e) {
      expect(e).toBeInstanceOf(MesahubError)
      expect((e as MesahubError).code).toBe('UNKNOWN_ERROR')
      expect((e as MesahubError).statusCode).toBe(500)
    }
  })
})
