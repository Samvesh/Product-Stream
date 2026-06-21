# Product Streamer

Browse 200,000 products with fast, stable cursor-based pagination.

**Live URLs**
- 🚀 **Frontend**: `https://YOUR-FRONTEND.vercel.app` ← update after deploy
- 🔌 **Backend API**: `https://product-streamer-api.onrender.com` ← update after deploy
- 💾 **Database**: Neon Postgres (hosted, free tier)

---

## What is Keyset (Cursor) Pagination, and why use it?

### The problem with OFFSET pagination

The most naive way to paginate is:
```sql
SELECT * FROM products ORDER BY created_at DESC LIMIT 20 OFFSET 10000;
```
**Why this is bad:**
1. **Slow at depth** — Postgres must scan and discard 10,000 rows before returning 20. Page 500 is 500× slower than page 1.
2. **Unstable under writes** — if a new product is inserted while you're on page 3, every row shifts by one. You'll see a duplicate on page 4 (a row you already saw) or skip one entirely.

### Keyset pagination (what this project uses)

Instead of saying "skip N rows", we say **"give me rows that come *after* the last item I saw"**. We track position using the last row's `(created_at, id)` pair as a *cursor*.

**First page:**
```sql
SELECT id, name, category, price, created_at
FROM products
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

**Subsequent pages** (cursor = last row's `created_at` + `id`):
```sql
SELECT id, name, category, price, created_at
FROM products
WHERE (created_at, id) < (:cursor_created_at, :cursor_id)
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

**Why use both `created_at` AND `id`?**
`created_at` is not unique — two products can share an identical timestamp. Adding `id` as a tiebreaker makes every cursor position guaranteed unique. The composite index `(created_at DESC, id DESC)` makes this an O(log N) seek.

**Why is this stable under concurrent writes?**
Newly inserted products get a fresh timestamp (newer than our cursor). They land *above* our current position in the sort order — in pages the user has already passed. They never appear between two pages we haven't visited yet. Result: **zero skips, zero duplicates**, no matter how many products are inserted mid-pagination.

The cursor itself is opaque to the client — it's just `base64(created_at|uuid)` — so clients can't accidentally construct invalid cursors.

---

## Project Structure

```
Product-Streamer/
├── backend/
│   ├── src/
│   │   ├── db.js              # pg Pool (uses Neon pooled connection string)
│   │   ├── index.js           # Express app, CORS, routing
│   │   └── routes/products.js # All API endpoints + pagination logic
│   ├── scripts/
│   │   ├── migrate.js         # Creates table + indexes
│   │   └── seed.js            # Inserts 200k fake products (bulk batches)
│   ├── tests/
│   │   └── pagination-test.js # Concurrent-write correctness test
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.jsx            # Root component, state management
│   │   ├── api.js             # fetch wrappers
│   │   └── components/
│   │       ├── ProductCard.jsx
│   │       ├── ProductList.jsx   # IntersectionObserver infinite scroll
│   │       └── CategoryFilter.jsx
│   └── package.json
├── render.yaml                # Render Blueprint (backend deploy config)
└── README.md
```

---

## Local Setup

### Prerequisites
- Node.js ≥ 18
- A [Neon](https://neon.tech) Postgres database (free, no credit card)

### 1. Clone and install

```bash
git clone https://github.com/Samvesh/Product-Stream
cd Product-Stream

# Install backend deps
cd backend && npm install

# Install frontend deps (separate terminal)
cd ../frontend && npm install
```

### 2. Configure environment

```bash
cd backend
cp .env.example .env
# Edit .env — paste your Neon POOLED connection string as DATABASE_URL
# Also set FRONTEND_URL (can be http://localhost:5173 for local dev)
```

> **Neon tip**: Use the **pooled** connection string (hostname contains `-pooler`).  
> Found in: Neon Dashboard → Project → Connection Details → toggle "Pooled connection".

### 3. Run migrations (creates table + indexes)

```bash
cd backend
npm run migrate
```

Expected output:
```
Running migrations...
  ✓ Table "products" created (or already exists)
  ✓ Index "idx_products_created_at_id" created
  ✓ Index "idx_products_category_created_at_id" created

Migrations complete!
```

### 4. Seed the database (200k products)

```bash
cd backend
npm run seed
```

Expected output (takes ~20–60s depending on connection):
```
Seeding 200,000 products in batches of 1,000...
  10,000 / 200,000 inserted (3.2s elapsed)
  20,000 / 200,000 inserted (6.1s elapsed)
  ...
  200,000 / 200,000 inserted (52.4s elapsed)

Seed complete! 200,000 products inserted in 52.4s.
```

**Why it's fast**: Instead of 200,000 individual INSERT statements (one per row), the seed script builds 200 bulk INSERT statements, each inserting 1,000 rows at once:
```sql
INSERT INTO products (name, category, price, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5), ($6,$7,$8,$9,$10), ...   -- 1,000 rows
```
This reduces DB round-trips from 200,000 → 200.

### 5. Start the backend

```bash
cd backend
npm run dev   # hot-reload via node --watch
```

### 6. Start the frontend

```bash
cd frontend
npm run dev   # Vite dev server at http://localhost:5173
```

The Vite dev proxy routes `/api` → `http://localhost:3001`, so no CORS issues locally.

---

## API Reference

All endpoints return JSON. The base URL is `/api`.

### `GET /api/health`

Simple health check. Render pings this to confirm the service is alive.

**Response:**
```json
{ "status": "ok", "db": "connected", "timestamp": "2025-01-15T10:30:00.000Z" }
```

---

### `GET /api/categories`

Returns the distinct list of product categories (for the filter dropdown).

**Response:**
```json
{ "data": ["Automotive", "Books", "Clothing", "Electronics", "..."] }
```

---

### `GET /api/products`

Returns a page of products in `created_at DESC, id DESC` order.

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | `20` | Products per page. Capped at `100` to prevent abuse. |
| `cursor` | string | — | The `nextCursor` from the previous response. Omit for the first page. |
| `category` | string | — | Filter to a specific category (e.g. `Electronics`). |

**First page:**
```
GET /api/products?limit=24
GET /api/products?limit=24&category=Electronics
```

**Subsequent pages:**
```
GET /api/products?limit=24&cursor=MjAyNS0wMS0xNVQxMDozMDowMC4wMDBafDM4ZWYu...
GET /api/products?limit=24&category=Electronics&cursor=MjAyNS0wMS0xNVQx...
```

**Response:**
```json
{
  "data": [
    {
      "id": "38ef2c14-...",
      "name": "Ergonomic Steel Chair",
      "category": "Office Supplies",
      "price": "199.99",
      "created_at": "2025-01-15T10:30:00.000Z"
    }
  ],
  "nextCursor": "MjAyNS0wMS0xNVQxMDozMDowMC4wMDBafDM4ZWYy..."
}
```

`nextCursor` is `null` when there are no more pages.

**Error responses:**

| Status | Condition |
|--------|-----------|
| `400` | Invalid cursor format |
| `400` | Invalid category value |
| `500` | Database or server error |

---

## Pagination Correctness Test

Tests that concurrent writes don't cause duplicates or skipped items.

```bash
cd backend
# Start the backend first (npm run dev), then in another terminal:
npm run test:pagination
```

**What the test does:**
1. Pages through all 200,000 products (page by page)
2. After page 5, inserts 50 new products (simulating real-time writes)
3. After page 10, inserts 50 more
4. Finishes all pages, verifies:
   - Zero duplicate IDs across all pages
   - The 100 newly inserted rows did NOT disrupt pagination (they got fresh timestamps → landed at the top, above the cursor → not visible in the current session)

**Expected result:**
```
=== Pagination Correctness Test ===

Products in DB before test: 200,000
  [page 5] Simulating concurrent write...
  [concurrent write] Inserted 50 new products
  [page 10] Simulating second concurrent write...
  [concurrent write] Inserted 50 new products
  ...
  Page 10000: fetched 200,000 so far

--- Results ---
Pages traversed:        10000
Unique products seen:   200,000
Products before test:   200,000

✅ PASS — No duplicates. No skips. Concurrent inserts did not affect pagination.
```

---

## Deployment

### Backend → Render

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → New → Blueprint → connect your repo
3. Render reads `render.yaml` automatically
4. In the Render dashboard, set these environment variables:
   - `DATABASE_URL` — your Neon **pooled** connection string
   - `FRONTEND_URL` — your Vercel frontend URL (set after frontend deploy)
5. Deploy. After deploy, run migrations:
   ```bash
   # In your local backend/.env, temporarily use the Neon URL,
   # then run migrate and seed once:
   npm run migrate
   npm run seed
   ```

### Frontend → Vercel

1. Go to [vercel.com](https://vercel.com) → New Project → import this repo
2. Set **Root Directory** to `frontend`
3. Add environment variable: `VITE_API_URL=https://product-streamer-api.onrender.com`
4. Deploy. Copy the Vercel URL back into Render's `FRONTEND_URL` env var.

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Plain `pg` (not Prisma/Sequelize) | SQL queries are fully visible — you can read and explain every line without "ORM magic" |
| Keyset over OFFSET | O(log N) at any depth; stable under concurrent writes |
| Composite cursor `(created_at, id)` | `created_at` alone isn't unique; `id` prevents ambiguity at identical timestamps |
| Neon pooled connection string | Neon free tier caps direct connections; PgBouncer pooler multiplexes safely |
| `limit` capped at 100 | Prevents a single request from scanning 10k+ rows and overwhelming the DB |
| Batched seed inserts (1000/query) | 200 round-trips instead of 200,000 — ~100× faster seeding |

---

## GitHub Repo

[https://github.com/Samvesh/Product-Stream](https://github.com/Samvesh/Product-Stream)
