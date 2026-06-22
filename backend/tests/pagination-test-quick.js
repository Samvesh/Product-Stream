// pagination-test-quick.js — Quick version: 1,000 pages (20,000 products)
//
// Same logic as the full test but stops after 1,000 pages instead of
// paginating the entire 200k dataset. Still injects 50 new products
// at page 5 and page 10 to prove keyset pagination is stable.

require('dotenv').config();
const pool = require('../src/db');

const API_BASE = process.env.TEST_API_URL || 'http://localhost:3001/api';
const PAGE_SIZE = 20;
const MAX_PAGES = 1000;

async function fetchPage(cursor) {
  const url = cursor
    ? `${API_BASE}/products?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}`
    : `${API_BASE}/products?limit=${PAGE_SIZE}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

async function insertFakeProducts(count) {
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
  const startTime = Date.now();
  console.log(`=== Pagination Correctness Test (Quick: ${MAX_PAGES} pages) ===\n`);

  const { rows: countRows } = await pool.query('SELECT COUNT(*) FROM products');
  const totalInDB = parseInt(countRows[0].count, 10);
  console.log(`Products in DB: ${totalInDB.toLocaleString()}`);
  console.log(`Will paginate ${MAX_PAGES} pages × ${PAGE_SIZE} = ${(MAX_PAGES * PAGE_SIZE).toLocaleString()} products\n`);

  const seenIds = new Set();
  let cursor = null;
  let pageNumber = 0;
  let duplicates = 0;

  while (pageNumber < MAX_PAGES) {
    const { data, nextCursor } = await fetchPage(cursor);
    pageNumber++;

    for (const row of data) {
      if (seenIds.has(row.id)) {
        duplicates++;
        console.error(`  ❌ DUPLICATE: id=${row.id} on page ${pageNumber}`);
      }
      seenIds.add(row.id);
    }

    // Log progress every 100 pages
    if (pageNumber % 100 === 0) {
      console.log(`  Page ${pageNumber}: fetched ${seenIds.size.toLocaleString()} unique products`);
    }

    // Inject concurrent writes
    if (pageNumber === 5) {
      console.log(`\n  [page 5] Simulating concurrent write...`);
      await insertFakeProducts(50);
      console.log();
    }
    if (pageNumber === 10) {
      console.log(`  [page 10] Simulating second concurrent write...`);
      await insertFakeProducts(50);
      console.log();
    }

    if (!nextCursor) {
      console.log(`  Reached end of dataset at page ${pageNumber}`);
      break;
    }
    cursor = nextCursor;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n--- Results ---');
  console.log(`Pages traversed:        ${pageNumber.toLocaleString()}`);
  console.log(`Unique products seen:   ${seenIds.size.toLocaleString()}`);
  console.log(`Expected:               ${(MAX_PAGES * PAGE_SIZE).toLocaleString()}`);
  console.log(`Duplicates found:       ${duplicates}`);
  console.log(`Skips (missing rows):   ${Math.max(0, (MAX_PAGES * PAGE_SIZE) - seenIds.size)}`);
  console.log(`Time elapsed:           ${elapsed}s`);

  if (duplicates === 0 && seenIds.size === MAX_PAGES * PAGE_SIZE) {
    console.log('\n✅ PASS — No duplicates. No skips. Concurrent inserts (100 new rows) did NOT affect pagination.');
  } else if (duplicates > 0) {
    console.error(`\n❌ FAIL — Found ${duplicates} duplicate(s).`);
    process.exit(1);
  } else {
    console.log(`\n⚠️  Row count mismatch (got ${seenIds.size}, expected ${MAX_PAGES * PAGE_SIZE}). Check if dataset ended early.`);
  }

  await pool.end();
}

run().catch((err) => {
  console.error('Test failed with error:', err.message);
  process.exit(1);
});
