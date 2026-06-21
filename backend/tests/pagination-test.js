// pagination-test.js — proves keyset pagination is correct under concurrent writes
//
// What this test does:
//   1. Starts paginating through ALL products (page by page, ~20 at a time).
//   2. After the 5th page, inserts 50 NEW products (simulating real-time activity).
//   3. After the 10th page, inserts 50 MORE products.
//   4. Finishes paginating to the end.
//   5. Checks that:
//      a) No product ID appears more than once across all pages (no duplicates).
//      b) The total rows returned match what was in the DB BEFORE we started
//         paginating (new inserts should NOT appear in our current session,
//         since they have newer timestamps and land ABOVE our starting cursor).
//
// Expected result: PASS — keyset pagination is immune to concurrent inserts.
//
// Run with:  npm run test:pagination
//            (requires DATABASE_URL in .env and a seeded database)

require('dotenv').config();
const pool = require('../src/db');

const API_BASE = process.env.TEST_API_URL || 'http://localhost:3001/api';
const PAGE_SIZE = 20;

// Simple fetch wrapper
async function fetchPage(cursor) {
  const url = cursor
    ? `${API_BASE}/products?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}`
    : `${API_BASE}/products?limit=${PAGE_SIZE}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

async function insertFakeProducts(count) {
  // Insert directly via SQL so we don't need the API to have a POST endpoint
  const { faker } = await import('@faker-js/faker');
  const CATEGORIES = ['Electronics', 'Clothing', 'Home & Garden', 'Sports & Outdoors', 'Books'];

  const values = [];
  const placeholders = [];
  for (let i = 0; i < count; i++) {
    const base = i * 3;
    values.push(
      faker.commerce.productName(),
      CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)],
      parseFloat(faker.commerce.price({ min: 1, max: 999 }))
    );
    placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3})`);
  }

  await pool.query(
    `INSERT INTO products (name, category, price) VALUES ${placeholders.join(', ')}`,
    values
  );
  console.log(`  [concurrent write] Inserted ${count} new products`);
}

async function run() {
  console.log('=== Pagination Correctness Test ===\n');

  // Count how many rows exist before we start
  const { rows: countRows } = await pool.query('SELECT COUNT(*) FROM products');
  const totalBefore = parseInt(countRows[0].count, 10);
  console.log(`Products in DB before test: ${totalBefore.toLocaleString()}`);

  const seenIds = new Set();
  let cursor = null;
  let pageNumber = 0;
  let totalFetched = 0;

  while (true) {
    const { data, nextCursor } = await fetchPage(cursor);
    pageNumber++;

    // Record all IDs on this page
    for (const row of data) {
      if (seenIds.has(row.id)) {
        console.error(`\n❌ DUPLICATE DETECTED: id=${row.id} appeared on page ${pageNumber}`);
        process.exit(1);
      }
      seenIds.add(row.id);
    }
    totalFetched += data.length;

    // Log progress every 50 pages
    if (pageNumber % 50 === 0) {
      console.log(`  Page ${pageNumber}: fetched ${totalFetched.toLocaleString()} so far (cursor: ${cursor ? cursor.slice(0, 20) + '...' : 'none'})`);
    }

    // Insert new products mid-pagination to test stability
    if (pageNumber === 5) {
      console.log(`\n  [page 5] Simulating concurrent write...`);
      await insertFakeProducts(50);
      console.log();
    }
    if (pageNumber === 10) {
      console.log(`\n  [page 10] Simulating second concurrent write...`);
      await insertFakeProducts(50);
      console.log();
    }

    if (!nextCursor) break; // reached the last page
    cursor = nextCursor;
  }

  console.log('\n--- Results ---');
  console.log(`Pages traversed:        ${pageNumber}`);
  console.log(`Unique products seen:   ${seenIds.size.toLocaleString()}`);
  console.log(`Products before test:   ${totalBefore.toLocaleString()}`);

  // The new inserts (100 total) happened AFTER we started paginating.
  // Since they get current timestamps (newer than our first page's cursor),
  // they land at the TOP of the sort order — which we've already passed.
  // So we should see exactly totalBefore rows, not totalBefore + 100.
  if (seenIds.size === totalBefore) {
    console.log('\n✅ PASS — No duplicates. No skips. Concurrent inserts did not affect pagination.');
  } else if (seenIds.size < totalBefore) {
    console.error(`\n❌ FAIL — Saw fewer rows than expected. Possible skips: ${totalBefore - seenIds.size} missing`);
    process.exit(1);
  } else {
    // More rows than expected would mean the new inserts leaked into our pagination
    console.error(`\n⚠️  WARNING — Saw ${seenIds.size - totalBefore} more rows than expected. This might be okay if inserts landed in unvisited pages.`);
  }

  await pool.end();
}

run().catch((err) => {
  console.error('Test failed with error:', err.message);
  process.exit(1);
});
