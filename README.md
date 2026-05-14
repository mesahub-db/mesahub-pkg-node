# MesaHub Node SDK

TypeScript SDK for MesaHub. Access your SQLite databases from Node.js, browsers, or CLI tools with raw SQL or a high-level table API.

## Installation

```bash
npm install @mesahub/client
# or
pnpm add @mesahub/client
```

## Connecting

There are two ways to connect to a MesaHub instance.

### Method 1 — Connection string (recommended)

Store the connection string in an environment variable and parse it at startup:

```typescript
import { MesahubClient, parseMesahubUrl } from '@mesahub/client';

// MESAHUB_URL=mh://shs_your_api_key@your-core.railway.app/my-app-db
const { apiUrl, apiKey, dbName } = parseMesahubUrl(process.env.MESAHUB_URL!);

const client = new MesahubClient({ apiUrl, apiKey });
const db = client.db(dbName);
```

Connection string format: `mh://apikey@host[:port]/dbname`

```
# Hosted / remote  →  HTTPS, /v1/ routes
mh://shs_abc123@my-core.railway.app/my-app-db

# Local / Docker   →  HTTP, /api/ routes (detected automatically)
mh://shs_abc123@localhost:3000/my-app-db
mh://shs_abc123@core-service/my-app-db
```

### Method 2 — Explicit config

```typescript
import { MesahubClient } from '@mesahub/client';

const client = new MesahubClient({
  apiKey: 'shs_your_api_key',        // from mesahub.app → Settings → API Keys
  apiUrl: 'https://api.mesahub.app', // or your self-hosted core URL
});

const db = client.db('my-app-db'); // your database slug from the dashboard
```

---

## Quick Start

```typescript
import { MesahubClient, parseMesahubUrl } from '@mesahub/client';

const { apiUrl, apiKey, dbName } = parseMesahubUrl(process.env.MESAHUB_URL!);
const client = new MesahubClient({ apiUrl, apiKey });

// --- High-level table API ---
interface User {
  id: number;
  name: string;
  email: string;
  active: number;
}

const db    = client.db(dbName);
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
import { MesahubClient, parseMesahubUrl } from '@mesahub/client';

// Via connection string (recommended)
const { apiUrl, apiKey, dbName } = parseMesahubUrl(process.env.MESAHUB_URL!);
const client = new MesahubClient({ apiUrl, apiKey });
const db = client.db(dbName);

// Or explicitly
const client2 = new MesahubClient({
  apiKey: 'shs_...', // API key from mesahub.app → Settings → API Keys
  apiUrl: 'https://api.mesahub.app',
});
const db2 = client2.db('my-app-db'); // database slug from the dashboard
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

All API errors throw a `MesahubError` subclass with a `code` and `statusCode`.

```typescript
import {
  MesahubError,
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
  } else if (err instanceof MesahubError) {
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

## Management Client

`MesahubManagementClient` provides programmatic access to the same management operations available in the web dashboard — database and bucket CRUD, API key management, and import/export.

It talks to the **dashboard** (control plane) using a `shs_` API key, not the data-plane.

```typescript
import { MesahubManagementClient } from '@mesahub/client';

const mgmt = new MesahubManagementClient({
  dashboardUrl: 'https://www.mesahub.app', // control-plane URL
  apiKey:       'shs_your_api_key',
});

// Databases
const dbs   = await mgmt.databases.list();
const db    = await mgmt.databases.create('my-app-db', { description: 'Production' });
const info  = await mgmt.databases.get(db.id);
await mgmt.databases.update(db.id, { name: 'my-app-db-v2' });
await mgmt.databases.delete(db.id);

// Buckets
const bucket = await mgmt.buckets.create('uploads');
await mgmt.buckets.delete(bucket.id);

// API keys
const keys   = await mgmt.apiKeys.list();
const newKey = await mgmt.apiKeys.create('ci-deploy');
console.log(newKey.key); // shs_... — only returned on creation, never stored
await mgmt.apiKeys.revoke(newKey.id);
```

### Import & Export

```typescript
// Export selected tables as a SQLite file
const response = await mgmt.databases.export(db.id, {
  tables: ['users', 'products'],
});
const buffer = await response.arrayBuffer();
// → write to disk or upload to object storage

// Phase 1: inspect a SQLite file for available tables
const { tables } = await mgmt.databases.import(db.id, file) as { tables: string[] };

// Phase 2: copy selected tables into the target database
await mgmt.databases.import(db.id, file, { tables: ['users'] });
```

### Self-hosted

Point `dashboardUrl` at your own deployment. Dedicated instance users should use their dashboard URL (e.g. `https://manage.mycompany.com`) — the management client always targets the control plane, not the data-plane.

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
