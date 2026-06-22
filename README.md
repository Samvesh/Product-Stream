# Product Streamer

A backend system for browsing ~200,000 products with fast pagination that stays correct even when data is changing underneath it. Built with Node.js, Postgres (Neon), and a simple React frontend.

---

## Why I built it this way

The task said "pagination should be fast" and "if 50 new products are added while someone is browsing, they must not see the same product twice or miss one." That second requirement is actually the interesting one — it rules out the obvious approach entirely.

### The obvious approach (OFFSET) and why it breaks

When I first thought about this, the natural instinct is:

```sql
SELECT * FROM products ORDER BY created_at DESC LIMIT 20 OFFSET 10000;
```

This works fine for small datasets. But there are two real problems with it at scale:

**Problem 1 — It gets slower the deeper you go.** Postgres has to scan and throw away 10,000 rows just to give you 20. Page 1 is fast. Page 500 is 500x slower. With 200k rows and people potentially scrolling deep, this is a real issue.

**Problem 2 — It breaks when data changes.** Say someone is on page 3. A new product gets inserted. Now every row has shifted by one position. When that user loads page 4, they'll either see a product they already saw on page 3, or miss one entirely. There's no way to fix this with OFFSET — it's a fundamental problem with the approach.

### What I did instead — keyset (cursor) pagination

The idea is simple once you see it: instead of saying "skip 10,000 rows", you say "give me rows that come *after* the last item I saw."

You use the last product's `created_at` and `id` as a cursor — a bookmark into the dataset.

**First page — no cursor, just fetch newest:**
```sql
SELECT id, name, category, price, created_at
FROM products
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

**Every page after that — use the cursor:**
```sql
SELECT id, name, category, price, created_at
FROM products
WHERE (created_at, id) < ($1, $2)   -- "after the last thing I saw"
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

The `WHERE (created_at, id) < (...)` is doing a row comparison — Postgres evaluates it left to right, so it means "either `created_at` is older, OR `created_at` is the same AND `id` is smaller." With a composite index on `(created_at DESC, id DESC)`, this is an O(log N) index seek regardless of how deep you are. Page 5,000 is just as fast as page 1.

**Why both `created_at` AND `id`?** Because `created_at` isn't unique — two products inserted at nearly the same time can have identical timestamps. If you only cursor on `created_at`, you'd have an ambiguous position. Adding `id` (which is a UUID and always unique) as a tiebreaker eliminates this.

**Why this is stable under concurrent writes:** New products get the current timestamp when they're inserted. That timestamp is newer than wherever your cursor currently is. So they land above your current scroll position — in pages you've already seen. They never "push" anything between two pages you haven't visited yet. This is why 0 duplicates and 0 skips is guaranteed by the design, not just a lucky test result.

I verified this with an actual test (more on that below).

---

## Project structure

```
Product-Streamer/
├── backend/
│   ├── src/
│   │   ├── db.js              # pg Pool setup — uses Neon's pooled connection
│   │   ├── index.js           # Express app, CORS, mounts routes
│   │   └── routes/products.js # the actual pagination logic lives here
│   ├── scripts/
│   │   ├── migrate.js         # creates the table and indexes
│   │   └── seed.js            # generates and inserts 200k products
│   ├── tests/
│   │   └── pagination-test.js # concurrent-write correctness test
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── api.js
│   │   └── components/
│   │       ├── ProductCard.jsx
│   │       ├── ProductList.jsx    # infinite scroll with IntersectionObserver
│   │       └── CategoryFilter.jsx
│   └── package.json
├── render.yaml
└── README.md
```

---

## Running it locally

### What you need
- Node.js 18+
- A Neon account (free, no credit card) — or any Postgres database honestly

### Setup

```bash
git clone https://github.com/Samvesh/Product-Stream
cd Product-Stream

cd backend && npm install
cd ../frontend && npm install
```

```bash
cd backend
cp .env.example .env
# open .env and paste your Neon connection string as DATABASE_URL
# important: use the POOLED string (hostname has -pooler in it)
# also set FRONTEND_URL=http://localhost:5173 for local dev
```

### Create the table and indexes

```bash
cd backend
npm run migrate
```

You should see something like:
```
Running migrations...
  ✓ Table "products" created
  ✓ Index on (created_at DESC, id DESC) created
  ✓ Index on (category, created_at DESC, id DESC) created
Done.
```

### Seed 200k products

```bash
npm run seed
```

This takes around 30-60 seconds depending on your connection. It inserts in batches of 1,000 rows at a time — not one row at a time in a loop (that would take forever). So it's doing 200 INSERT statements instead of 200,000. Big difference in speed.

```
Seeding 200,000 products in batches of 1,000...
  10,000 / 200,000 (4.1s)
  20,000 / 200,000 (7.8s)
  ...
  200,000 / 200,000 (54.2s)
Done.
```

### Start the servers

```bash
# terminal 1
cd backend && npm run dev

# terminal 2
cd frontend && npm run dev
```

Frontend runs at `http://localhost:5173`. The Vite proxy handles `/api` → backend so you don't have to deal with CORS locally.

---

## API

Base URL: `/api`

### `GET /api/health`
Just a health check.
```json
{ "status": "ok", "db": "connected" }
```

### `GET /api/categories`
Returns the list of categories for the dropdown.
```json
{ "data": ["Automotive", "Books", "Clothing", "Electronics", ...] }
```

### `GET /api/products`

| param | default | notes |
|-------|---------|-------|
| `limit` | 20 | capped at 100 |
| `cursor` | — | omit for first page, use `nextCursor` from previous response for subsequent pages |
| `category` | — | optional filter |

First page:
```
GET /api/products?limit=24
GET /api/products?limit=24&category=Electronics
```

Next pages:
```
GET /api/products?limit=24&cursor=MjAyNS0wMS0x...
```

Response:
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
  "nextCursor": "MjAyNS0wMS0x..."
}
```

`nextCursor` is `null` on the last page. The cursor is just `base64(created_at|id)` — encoded so the client treats it as opaque and doesn't try to construct their own.

Errors: `400` for bad cursor or invalid category, `500` for anything else.

---

## Correctness test

This was the part I spent the most time thinking through. The task specifically said data might change while someone is browsing — I wanted to actually prove the pagination handles it, not just assume it does.

```bash
cd backend
npm run test:pagination
```

What the test does:
- Pages through 20,000 products (1,000 pages)
- After page 5, inserts 50 new products into the database while pagination is still running
- After page 10, inserts 50 more
- At the end, checks that every product ID is unique and the count matches exactly

Actual output from running it:

```
=== Pagination Correctness Test (Quick: 1000 pages) ===
Database connection pool ready
Products in DB: 200,100
Will paginate 1000 pages × 20 = 20,000 products

  [page 5] Simulating concurrent write...
  [concurrent write] Inserted 50 new products
  [page 10] Simulating second concurrent write...
  [concurrent write] Inserted 50 new products
  Page 100: fetched 2,000 unique products
  Page 200: fetched 4,000 unique products
  ...
  Page 1000: fetched 20,000 unique products

--- Results ---
Pages traversed:        1,000
Unique products seen:   20,000
Expected:               20,000
Duplicates found:       0
Skips (missing rows):   0
Time elapsed:           554.9s

✅ PASS — No duplicates. No skips. Concurrent inserts (100 new rows) did NOT affect pagination.
```

The reason this passes is what I explained above — new inserts get current timestamps, which places them above the cursor, not between pages being actively paginated. It's a property of the design, so it holds at any scale.

---

## Deployment

### Backend → Render
### Frontend → Vercel

---

## A few decisions worth mentioning

**Plain `pg` instead of Prisma or Sequelize** — I wanted the SQL to be fully readable. The pagination query is the whole point of this project — it shouldn't be hidden behind ORM magic. With plain `pg`, you can look at `routes/products.js` and see exactly what's being sent to the database.

**Neon pooled connection string** — Neon's free tier limits direct connections. The pooled string goes through PgBouncer which handles connection multiplexing. Easy to miss but important — without it you'll hit connection limit errors under any real load.

**`limit` capped at 100** — A client shouldn't be able to send `?limit=50000` and scan half the table in one request.

**Seed batches of 1000** — Inserting 200k rows one at a time in a loop would take 10+ minutes. Batching them into groups of 1000 per INSERT brings it down to under a minute. The seed script is in `scripts/seed.js` if you want to see how it's structured.

---

## GitHub

[https://github.com/Samvesh/Product-Stream](https://github.com/Samvesh/Product-Stream)
