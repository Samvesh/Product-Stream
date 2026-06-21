// api.js — thin wrappers around the backend API
//
// VITE_API_URL is set at build time for production (pointing to the Render backend).
// In dev, Vite's proxy (vite.config.js) routes /api requests to localhost:3001
// so VITE_API_URL is not needed locally.

const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

/**
 * Fetch a page of products.
 *
 * @param {object} options
 * @param {string|null} options.cursor - The nextCursor from the previous page, or null for first page.
 * @param {string|null} options.category - Category filter, or null for all categories.
 * @param {number} options.limit - Number of products per page.
 * @returns {Promise<{ data: Product[], nextCursor: string|null }>}
 */
export async function getProducts({ cursor = null, category = null, limit = 24 } = {}) {
  const params = new URLSearchParams();
  params.set('limit', limit);
  if (cursor) params.set('cursor', cursor);
  if (category) params.set('category', category);

  const res = await fetch(`${API_BASE}/products?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error ${res.status}`);
  }
  return res.json();
}

/**
 * Fetch the list of distinct categories.
 * @returns {Promise<string[]>}
 */
export async function getCategories() {
  const res = await fetch(`${API_BASE}/categories`);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const body = await res.json();
  return body.data;
}
