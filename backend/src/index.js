// index.js — Express application entry point
//
// Keeps the app file small and focused on wiring — actual route logic
// lives in src/routes/products.js where it's easy to find and explain.

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const productsRouter = require('./routes/products');

const app = express();
const PORT = process.env.PORT || 3001;

// -----------------------------------------------------------------------
// CORS — allow the frontend (on a different domain) to reach this API
// -----------------------------------------------------------------------
// Because the frontend is deployed separately (Vercel/Render static site),
// the browser enforces the Same-Origin Policy and will block requests unless
// this API responds with the correct Access-Control-Allow-Origin header.
//
// We read the allowed origin from FRONTEND_URL so it's configurable per
// environment without touching code.
const allowedOrigins = [
  process.env.FRONTEND_URL,          // deployed frontend (set in Render dashboard)
  'http://localhost:5173',            // Vite dev server (local development)
  'http://localhost:4173',            // Vite preview
].filter(Boolean); // remove undefined entries

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. curl, Postman, server-to-server)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin "${origin}" not allowed`));
    },
    optionsSuccessStatus: 200,
  })
);

// Parse JSON request bodies (not needed for GET-only routes but good practice)
app.use(express.json());

// -----------------------------------------------------------------------
// Routes
// -----------------------------------------------------------------------
app.use('/api', productsRouter);

// Catch-all 404 for unknown routes
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// Global error handler — catches any errors thrown inside route handlers
// that weren't caught by their own try/catch
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// -----------------------------------------------------------------------
// Start server
// -----------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Product Streamer API running on port ${PORT}`);
  console.log(`  Health: http://localhost:${PORT}/api/health`);
  console.log(`  Products: http://localhost:${PORT}/api/products`);
});
