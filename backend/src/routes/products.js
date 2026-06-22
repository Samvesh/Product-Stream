// products.js — route handlers for /api/products and /api/categories
//
// =====================================================================
// KEYSET (CURSOR) PAGINATION — HOW IT WORKS
// =====================================================================
//
// The Problem with OFFSET pagination:
//   SELECT * FROM products ORDER BY created_at DESC LIMIT 20 OFFSET 10000;
//   Postgres must scan and skip 10,000 rows before returning 20. This gets
//   progressively slower as the user pages deeper. Also, if a new product
//   is inserted while the user is on page 5, every subsequent page shifts
//   by one row — causing duplicates or skipped items.
//
// Keyset Pagination (what we use):
//   Instead of saying "skip N rows", we say "give me rows that come AFTER
//   the last item I saw". We identify that position using the last item's
//   (created_at, id) pair as a "cursor".
//
//   First page (no cursor):
//     SELECT ... FROM products ORDER BY created_at DESC, id DESC LIMIT 20;
//
//   Next pages (cursor = last row's created_at and id):
//     SELECT ... FROM products
//     WHERE (created_at, id) < (:cursor_created_at, :cursor_id)
//     ORDER BY created_at DESC, id DESC LIMIT 20;
//
//   Why use BOTH created_at AND id?
//   - created_at is not unique (two products can have identical timestamps).
//   - By adding id as a tiebreaker, the cursor position is always unique.
//   - The composite index on (created_at DESC, id DESC) makes this WHERE clause
//     an O(log N) seek rather than a full table scan.
//
//   Why is this stable under concurrent writes?
//   - We're always asking "give me the next rows BEFORE this timestamp".
//   - A newly inserted product gets a current timestamp (newer than our cursor),
//     so it lands ABOVE our current page, not between pages we've already visited.
//   - No skips, no duplicates, no matter when rows are inserted.
//
//   Row comparison (created_at, id) < (a, b) in Postgres:
//   - This is equivalent to: created_at < a OR (created_at = a AND id < b)
//   - Postgres's row value comparison is index-friendly with our composite index.
// =====================================================================

const express = require('express');
const router = express.Router();
const pool = require('../db');

// -----------------------------------------------------------------------
// Helper: encode/decode the pagination cursor
// -----------------------------------------------------------------------
// The cursor is a base64 string encoding "isoTimestamp|uuid".
// We use base64 so the cursor is opaque to the client (they shouldn't
// parse or construct it themselves — just pass it back as-is).

function encodeCursor(created_at, id) {
  // created_at from Postgres is a Date object; .toISOString() gives a stable string
  const raw = `${new Date(created_at).toISOString()}|${id}`;
  return Buffer.from(raw).toString('base64');
}

function decodeCursor(cursor) {
  try {
    const raw = Buffer.from(cursor, 'base64').toString('utf8');
    const [isoDate, id] = raw.split('|');

    // Validate the timestamp is a real date
    const created_at = new Date(isoDate);
    if (isNaN(created_at.getTime())) throw new Error('invalid date in cursor');

    // Validate the id looks like a UUID (basic check)
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('invalid id in cursor');

    return { created_at, id };
  } catch {
    return null; // caller will respond with 400
  }
}

// -----------------------------------------------------------------------
// GET /api/products
// -----------------------------------------------------------------------
// Query params:
//   ?category=Electronics   — filter by category (optional)
//   ?cursor=<base64>        — pagination cursor from previous response (optional)
//   ?limit=20               — page size, 1–100, default 20
//
// Response:
//   {
//     data: [ { id, name, category, price, created_at } ],
//     nextCursor: "<base64>" | null   (null means this is the last page)
//   }
router.get('/products', async (req, res) => {
  try {
    // --- Input validation ---------------------------------------------------

    // Parse and cap limit (prevent abuse with huge page sizes)
    let limit = parseInt(req.query.limit, 10);
    if (isNaN(limit) || limit < 1) limit = 20;
    if (limit > 150) limit = 150; // hard cap

    const { category, cursor: cursorParam } = req.query;

    // Decode the cursor if one was provided
    let cursor = null;
    if (cursorParam) {
      cursor = decodeCursor(cursorParam);
      if (!cursor) {
        return res.status(400).json({
          error: 'Invalid cursor. Use the nextCursor value from the previous response.',
        });
      }
    }

    // Validate category (prevent injection; must be a non-empty string if provided)
    if (category !== undefined && (typeof category !== 'string' || category.trim() === '')) {
      return res.status(400).json({ error: 'Invalid category filter.' });
    }
    const categoryFilter = category ? category.trim() : null;

    // --- Build query -------------------------------------------------------
    // We fetch limit + 1 rows. If we get exactly limit+1 back, there IS a next
    // page; we return only limit rows and encode the last one as nextCursor.
    // If we get ≤ limit rows, this is the final page (nextCursor = null).
    const fetchLimit = limit + 1;

    let queryText;
    let queryParams;

    if (!categoryFilter && !cursor) {
      // ---- First page, no filter ----
      queryText = `
        SELECT id, name, category, price, created_at
        FROM products
        ORDER BY created_at DESC, id DESC
        LIMIT $1
      `;
      queryParams = [fetchLimit];

    } else if (!categoryFilter && cursor) {
      // ---- Subsequent pages, no filter ----
      // The WHERE clause uses row value comparison:
      //   (created_at, id) < ($2, $3)
      // which Postgres translates to an efficient index seek on idx_products_created_at_id.
      queryText = `
        SELECT id, name, category, price, created_at
        FROM products
        WHERE (created_at, id) < ($2, $3)
        ORDER BY created_at DESC, id DESC
        LIMIT $1
      `;
      queryParams = [fetchLimit, cursor.created_at, cursor.id];

    } else if (categoryFilter && !cursor) {
      // ---- First page, with category filter ----
      queryText = `
        SELECT id, name, category, price, created_at
        FROM products
        WHERE category = $2
        ORDER BY created_at DESC, id DESC
        LIMIT $1
      `;
      queryParams = [fetchLimit, categoryFilter];

    } else {
      // ---- Subsequent pages, with category filter ----
      // Postgres uses idx_products_category_created_at_id:
      //   1. Seek to category = $2 in the index
      //   2. Then seek to (created_at, id) < ($3, $4) within that category
      // Both conditions are satisfied in a single index scan.
      queryText = `
        SELECT id, name, category, price, created_at
        FROM products
        WHERE category = $2
          AND (created_at, id) < ($3, $4)
        ORDER BY created_at DESC, id DESC
        LIMIT $1
      `;
      queryParams = [fetchLimit, categoryFilter, cursor.created_at, cursor.id];
    }

    const result = await pool.query(queryText, queryParams);
    const rows = result.rows;

    // --- Determine if there's a next page ----------------------------------
    let nextCursor = null;
    if (rows.length > limit) {
      // We got the extra row, meaning there's more data after this page.
      // Remove the extra row from the response and encode the LAST actual row
      // as the cursor (the client will send this back with the next request).
      rows.pop(); // discard the (limit+1)th row
      const lastRow = rows[rows.length - 1];
      nextCursor = encodeCursor(lastRow.created_at, lastRow.id);
    }

    return res.json({
      data: rows,
      nextCursor, // null signals "end of results"
    });

  } catch (err) {
    console.error('GET /api/products error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -----------------------------------------------------------------------
// GET /api/categories
// -----------------------------------------------------------------------
// Returns the distinct list of categories in the database.
// Used by the frontend to populate the filter dropdown.
// Response: { data: ["Electronics", "Clothing", ...] }
router.get('/categories', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT category
      FROM products
      ORDER BY category ASC
    `);
    return res.json({
      data: result.rows.map((r) => r.category),
    });
  } catch (err) {
    console.error('GET /api/categories error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -----------------------------------------------------------------------
// GET /api/health
// -----------------------------------------------------------------------
// Simple health check — confirms the process is running and the DB is reachable.
// Render's health check pings this URL to decide if the service is up.
router.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
  } catch (err) {
    return res.status(503).json({ status: 'error', db: 'disconnected', message: err.message });
  }
});

module.exports = router;
