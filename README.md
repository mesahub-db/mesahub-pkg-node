# @mesahub/client

TypeScript SDK for sqlite-hub. Access your SQLite databases from Node.js, browsers, or CLI tools with raw SQL or a high-level table API.

## Getting Started with Mesahub

[Mesahub](https://mesahub.app) is the hosted version of sqlite-hub — no setup required.

1. **Sign up** at [mesahub.app](https://mesahub.app) and create a database from the dashboard.
2. **Generate an API key** under **Settings → API Keys**. It will look like `shs_...` and is shown only once.
3. **Find your database reference** — the slug shown on the database page (e.g. `my-app-db`).
4. **Install the SDK** and connect:

```typescript
import { MesahubClient } from '@mesahub/client';

const client = new MesahubClient({
  apiKey: 'shs_your_api_key',  // from Settings → API Keys
  apiUrl: 'https://api.mesahub.app',
});

const db = client.db('my-app-db'); // your database slug from the dashboard
```

> **Self-hosting?** Replace `apiUrl` with your own template service URL (e.g. `https://api.yourdomain.com`).

---

## Installation

```bash
npm install @mesahub/client
# or
pnpm add @mesahub/client
```

## Quick Start

```typescript
import { MesahubClient } from '@mesahub/client';

const client = new MesahubClient({
  apiKey: 'shs_your_api_key',        // from mesahub.app → Settings → API Keys
  apiUrl: 'https://api.mesahub.app', // or your self-hosted data-plane URL
});

// --- High-level table API ---
interface User {
  id: number;
  name: string;
  email: string;
  active: number;
}

const db    = client.db('my-app-db'); // your database slug from the mesahub dashboard
const users = db.table<User>('users');

const all    = await users.find({ where: { active: 1 }, limit: 20 });
const alice  = await users.findOne({ where: { email: 'alice@example.com' } });
const count  = await users.count({ where: { active: 1 } });
const newRow = await users.insert({ name: 'Bob', email: 'bob@example.com', active: 1 });

await users.update({ where: { id: newRow.id }, set: { name: 'Robert' } });
await users.delete({ where: { id: newRow.id } });

// --- Raw SQL ---
const result = await db.query('SELECT * FROM users WHERE active = ?', [1]);
console.log(result.rows); // [{ id: 1, name: 'Alice', ... }]

await db.exec('CREATE TABLE IF NOT EXISTS logs (msg TEXT, created_at TEXT)');
```

## Features

- **High-level table API** — `find`, `findOne`, `count`, `insert`, `insertMany`, `update`, `delete` with full TypeScript generics
- **Flexible `where` filters** — equality, comparison operators (`gt`, `gte`, `lt`, `lte`, `ne`), `like`, `in`, `isNull`, and more
- **Raw SQL** — `db.query()` and `db.exec()` with parameterised bindings for anything outside the ORM surface
- **File storage** — `db.files.list()`, `db.files.upload()`, `db.files.download()`, `db.files.delete()`
- Works in **Node.js, browsers, and Deno**
- Full TypeScript types — generics flow from your row type through to all results
- All SQL is **parameterised** — injection-safe by construction

---

## Usage

### Setup

```typescript
import { MesahubClient } from '@mesahub/client';

const client = new MesahubClient({
  apiKey: 'shs_...', // API key from mesahub.app → Settings → API Keys
  apiUrl: 'https://api.mesahub.app',
});

const db = client.db('my-app-db'); // database slug from the dashboard
```

---

### High-level Table API

All table methods are accessed via `db.table<T>(tableName)`.

```typescript
interface Post {
  id: number;
  title: string;
  published: number;
  created_at: string;
}

const posts = db.table<Post>('posts');
```

#### `find(opts?)`

Fetch multiple rows.

```typescript
// All published posts, newest first, paginated
const page = await posts.find({
  where:   { published: 1 },
  orderBy: [{ column: 'created_at', direction: 'desc' }],
  limit:   10,
  offset:  20,
});

// Select specific columns only
const titles = await posts.find({
  select: ['id', 'title'],
  where:  { published: 1 },
});
```

#### `findOne(opts?)`

Fetch a single row or `null`.

```typescript
const post = await posts.findOne({ where: { id: 42 } });
if (post) {
  console.log(post.title);
}
```

#### `count(opts?)`

Count matching rows.

```typescript
const total     = await posts.count();
const published = await posts.count({ where: { published: 1 } });
```

#### `insert(data)`

Insert a single row and return the inserted record (uses `RETURNING *`).

```typescript
const post = await posts.insert({
  title:      'Hello World',
  published:  0,
  created_at: new Date().toISOString(),
});
console.log(post.id); // auto-assigned ID
```

#### `insertMany(rows, opts?)`

Insert multiple rows in a single statement. Returns `ExecResult`.

```typescript
await posts.insertMany([
  { title: 'Post A', published: 1, created_at: '...' },
  { title: 'Post B', published: 1, created_at: '...' },
]);

// Silently skip duplicates
await posts.insertMany(rows, { onConflict: 'ignore' });

// Upsert (replace on conflict)
await posts.insertMany(rows, { onConflict: 'replace' });
```

#### `update(opts)`

Update matching rows.

```typescript
await posts.update({
  where: { id: 42 },
  set:   { published: 1 },
});
```

#### `delete(opts)`

Delete matching rows. `where` is required to prevent accidental full-table deletes.

```typescript
await posts.delete({ where: { id: 42 } });
```

---

### Where Clause Operators

Plain values are treated as equality. For comparisons, use the operator objects:

```typescript
await posts.find({
  where: {
    // Comparison
    id:         { gt: 100 },
    views:      { gte: 1000 },
    price:      { lt: 50 },
    rating:     { lte: 3 },
    status:     { ne: 'draft' },

    // Pattern match
    title:      { like: '%typescript%' },
    slug:       { notLike: '%test%' },

    // Set membership
    category:   { in: ['news', 'tech'] },
    tag:        { notIn: ['spam', 'ads'] },

    // NULL checks
    deleted_at: { isNull: true },
    email:      { isNotNull: true },

    // Shorthand equality
    published:  1,
  },
});
```

All conditions are combined with `AND`.

---

### Raw SQL

Use `db.query()` for reads and `db.exec()` for writes when you need something beyond the table API (joins, aggregates, CTEs, DDL, etc.).

```typescript
// Read — returns QueryResult
const result = await db.query(
  'SELECT u.name, COUNT(p.id) AS post_count FROM users u LEFT JOIN posts p ON p.user_id = u.id GROUP BY u.id',
);
console.log(result.rows);    // Record<string, unknown>[]
console.log(result.columns); // string[]
console.log(result.rowCount);

// Write — returns ExecResult
const exec = await db.exec(
  'INSERT INTO logs (msg, created_at) VALUES (?, ?)',
  ['server started', new Date().toISOString()],
);
console.log(exec.rowsAffected);
console.log(exec.lastInsertRowid);
```

---

### File Storage

```typescript
const files = db.files;

// List files (optionally filter by folder prefix)
const { files: list } = await files.list({ limit: 50, folderPrefix: 'avatars/' });

// Upload
const record = await files.upload(
  Buffer.from('hello'),
  'hello.txt',
  'text/plain',
);
console.log(record.id, record.url);

// Download (streaming)
const stream = await files.download(record.id);

// Delete
await files.delete(record.id);
```

---

### Error Handling

All API errors throw a `SqliteHubError` subclass with a `code` and `statusCode`.

```typescript
import {
  SqliteHubError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from '@mesahub/client';

try {
  await db.query('SELECT * FROM users');
} catch (err) {
  if (err instanceof RateLimitError) {
    // HTTP 429
  } else if (err instanceof AuthenticationError) {
    // HTTP 401 — bad or missing API key
  } else if (err instanceof SqliteHubError) {
    console.error(err.code, err.statusCode, err.message);
  }
}
```

---

### Backward-Compatible Low-Level API

The original `client.query()` / `client.exec()` / `client.files()` methods still work:

```typescript
// These are equivalent
await client.query('my-db', 'SELECT 1');
await client.db('my-db').query('SELECT 1');
```

---

## TypeScript

All types are exported from the package root:

```typescript
import type {
  QueryResult,
  ExecResult,
  FileRecord,
  FindOptions,
  WhereClause,
  WhereOperator,
  UpdateOptions,
  DeleteOptions,
  CountOptions,
  InsertManyOptions,
} from '@mesahub/client';
```

---

## License

MIT
