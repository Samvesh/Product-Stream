// db.js — single shared connection pool for the whole app
//
// We use the 'pg' library directly (not an ORM) so every SQL query in this
// codebase is fully visible and easy to understand.
//
// IMPORTANT: We use Neon's POOLED connection string (hostname contains "-pooler").
// Neon's serverless free tier has a hard cap on concurrent direct connections,
// but the pooler (PgBouncer) multiplexes many app connections onto fewer DB
// connections, staying well within that limit.

require('dotenv').config();
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is not set.');
  console.error('Copy backend/.env.example to backend/.env and fill in your Neon pooled connection string.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // max: 10 is appropriate for Render's free tier.
  // The pooler on Neon's side handles the actual DB connection limits.
  max: 10,
  // Kill connections that sit idle for more than 30 seconds.
  // This prevents connection exhaustion on long-running deployments.
  idleTimeoutMillis: 30000,
  // Fail fast if we can't get a connection within 5 seconds.
  connectionTimeoutMillis: 5000,
  // Neon requires SSL
  ssl: { rejectUnauthorized: false },
});

// Verify connectivity on startup so we get an obvious error immediately
// rather than a cryptic failure on the first real request.
pool.connect((err, client, release) => {
  if (err) {
    console.error('Failed to connect to the database:', err.message);
  } else {
    console.log('Database connection pool ready');
    release();
  }
});

module.exports = pool;
