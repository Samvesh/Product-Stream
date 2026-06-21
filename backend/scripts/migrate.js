// migrate.js — creates the products table and indexes
//
// Run ONCE before seeding:  npm run migrate
//
// Why a separate migrate step?
//   - Schema and data are concerns. Keeping them separate means you can
//     re-run the seed (or wipe and re-seed) without touching the schema,
//     and you can run migrations in CI/CD pipelines independently.

require('dotenv').config();
const pool = require('../src/db');

async function migrate() {
  console.log('Running migrations...');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // --- 1. Create the products table -----------------------------------------
    // uuid_generate_v4() requires the pgcrypto extension OR we use gen_random_uuid()
    // which is built into Postgres 13+ (Neon is Postgres 16).
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        name        TEXT        NOT NULL,
        category    TEXT        NOT NULL,
        price       NUMERIC(10, 2) NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log('  ✓ Table "products" created (or already exists)');

    // --- 2. Composite index for unfiltered keyset pagination -------------------
    // When paginating without a category filter, Postgres needs to efficiently find
    // rows where (created_at, id) < (cursor_created_at, cursor_id).
    // An index on (created_at DESC, id DESC) supports exactly this access pattern.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_products_created_at_id
        ON products (created_at DESC, id DESC);
    `);
    console.log('  ✓ Index "idx_products_created_at_id" created');

    // --- 3. Composite index for category-filtered keyset pagination ------------
    // When a category filter is active, Postgres first narrows to that category,
    // then applies the cursor condition (created_at, id) < (...).
    // Putting "category" first in the index lets Postgres do both in one scan
    // rather than filtering after a full index scan.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_products_category_created_at_id
        ON products (category, created_at DESC, id DESC);
    `);
    console.log('  ✓ Index "idx_products_category_created_at_id" created');

    await client.query('COMMIT');
    console.log('\nMigrations complete!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed, rolled back:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
