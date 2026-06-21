// App.jsx — root component, owns all state
//
// State management is intentionally simple — no Redux, no context, just
// useState + useCallback so every data flow is visible and traceable.

import { useState, useEffect, useCallback, useRef } from 'react';
import { getProducts, getCategories } from './api';
import CategoryFilter from './components/CategoryFilter';
import ProductList from './components/ProductList';

const PAGE_SIZE = 24; // products per page

export default function App() {
  // ---- Category state ----
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('');

  // ---- Product list state ----
  const [products, setProducts] = useState([]);
  const [cursor, setCursor] = useState(null);     // null = first page not yet loaded
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Track total loaded for the "end" banner
  const totalLoaded = products.length;

  // Prevent double-firing of loadMore (e.g. IntersectionObserver + scroll)
  const loadingRef = useRef(false);

  // ---- Load categories once on mount ----
  useEffect(() => {
    getCategories()
      .then(setCategories)
      .catch((e) => console.warn('Could not load categories:', e.message));
  }, []);

  // ---- Load first page whenever selectedCategory changes ----
  useEffect(() => {
    // Reset list and load fresh first page
    setProducts([]);
    setCursor(null);
    setHasMore(true);
    setError(null);

    loadPage({ cursor: null, category: selectedCategory || null, isFirstPage: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategory]);

  // ---- Core fetch function ----
  // We pass arguments explicitly rather than reading state, because React state
  // updates are async — reading `cursor` from state during rapid pagination can
  // give stale values.
  async function loadPage({ cursor: cur, category, isFirstPage = false }) {
    if (loadingRef.current) return; // already fetching
    loadingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const { data, nextCursor } = await getProducts({
        cursor: cur,
        category,
        limit: PAGE_SIZE,
      });

      setProducts((prev) => (isFirstPage ? data : [...prev, ...data]));
      setCursor(nextCursor);
      setHasMore(nextCursor !== null);
    } catch (e) {
      setError(e.message || 'Failed to load products. Please try again.');
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }

  // ---- Triggered by IntersectionObserver in ProductList ----
  const handleLoadMore = useCallback(() => {
    if (!hasMore || loadingRef.current) return;
    loadPage({
      cursor,
      category: selectedCategory || null,
    });
  }, [cursor, hasMore, selectedCategory]);

  // ---- Category change ----
  function handleCategoryChange(cat) {
    setSelectedCategory(cat);
  }

  // ---- Initial loading state (first page, no products yet) ----
  const isInitialLoad = loading && products.length === 0;

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-top">
          <div className="header-logo" aria-hidden="true">⚡</div>
          <h1>Product Streamer</h1>
        </div>
        <p className="header-sub">
          Browse 200,000 products with instant keyset pagination
        </p>
        <div className="header-badge">
          <span className="badge-dot" />
          Cursor-based pagination — stable under concurrent writes
        </div>
      </header>

      {/* Controls */}
      <div className="controls">
        <span className="controls-label">Filter by category</span>
        <div className="select-wrapper">
          <select
            id="category-filter"
            value={selectedCategory}
            onChange={(e) => handleCategoryChange(e.target.value)}
            aria-label="Filter products by category"
            disabled={isInitialLoad}
          >
            <option value="">All Categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        {totalLoaded > 0 && (
          <div className="stats-pill">
            Showing <span>{totalLoaded.toLocaleString()}</span> products
            {selectedCategory && ` in ${selectedCategory}`}
          </div>
        )}
      </div>

      {/* Initial full-page spinner */}
      {isInitialLoad && (
        <div className="state-loading" aria-live="polite">
          <div className="spinner" />
          <p>Loading products…</p>
        </div>
      )}

      {/* Product list + infinite scroll */}
      {!isInitialLoad && (
        <ProductList
          products={products}
          loading={loading}
          error={error}
          hasMore={hasMore}
          onLoadMore={handleLoadMore}
          totalLoaded={totalLoaded}
        />
      )}
    </div>
  );
}
