// App.jsx — root component, owns all state
//
// State management is intentionally simple — no Redux, no context, just
// useState + useCallback so every data flow is visible and traceable.

import { useState, useEffect, useCallback, useRef } from 'react';
import { getProducts, getCategories } from './api';
import ProductList from './components/ProductList';

const PAGE_SIZE = 120; // products per page

export default function App() {
  // ---- Category state ----
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('');

  // ---- Sorting state ----
  const [priceSort, setPriceSort] = useState(''); // '' | 'asc' | 'desc'

  // ---- Product list state ----
  const [allProducts, setAllProducts] = useState([]);
  const [cursor, setCursor] = useState(null);     // null = first page not yet loaded
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Prevent double-firing of loadMore (e.g. IntersectionObserver + scroll)
  const loadingRef = useRef(false);

  // ---- Load categories once on mount ----
  useEffect(() => {
    getCategories()
      .then(setCategories)
      .catch((e) => console.warn('Could not load categories:', e.message));
  }, []);

  // ---- Core fetch function ----
  // We pass arguments explicitly rather than reading state, because React state
  // updates are async — reading `cursor` from state during rapid pagination can
  // give stale values.
  async function loadPage({ cursor: cur, isFirstPage = false }) {
    if (loadingRef.current) return; // already fetching
    loadingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const { data, nextCursor } = await getProducts({
        cursor: cur,
        category: null, // Always fetch unfiltered from the server
        limit: PAGE_SIZE,
      });

      setAllProducts((prev) => (isFirstPage ? data : [...prev, ...data]));
      setCursor(nextCursor);
      setHasMore(nextCursor !== null);
    } catch (e) {
      setError(e.message || 'Failed to load products. Please try again.');
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }

  // ---- Load first page once on mount ----
  useEffect(() => {
    loadPage({ cursor: null, isFirstPage: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Triggered by IntersectionObserver in ProductList ----
  const handleLoadMore = useCallback(() => {
    if (!hasMore || loadingRef.current) return;
    loadPage({
      cursor,
    });
  }, [cursor, hasMore]);

  // ---- Compute displayed products (client-side filtering and sorting) ----
  const filteredProducts = selectedCategory
    ? allProducts.filter((p) => p.category === selectedCategory)
    : [...allProducts];

  const displayedProducts = [...filteredProducts];
  if (priceSort === 'asc') {
    displayedProducts.sort((a, b) => a.price - b.price);
  } else if (priceSort === 'desc') {
    displayedProducts.sort((a, b) => b.price - a.price);
  }

  // ---- Initial loading state (first page, no products yet) ----
  const isInitialLoad = loading && allProducts.length === 0;

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-top">
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
        <div className="control-group">
          <span className="controls-label">Filter by category</span>
          <div className="select-wrapper">
            <select
              id="category-filter"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
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
        </div>

        <div className="control-group">
          <span className="controls-label">Sort by price</span>
          <div className="select-wrapper">
            <select
              id="price-sort"
              value={priceSort}
              onChange={(e) => setPriceSort(e.target.value)}
              aria-label="Sort products by price"
              disabled={isInitialLoad}
            >
              <option value="">Default (Newest First)</option>
              <option value="asc">Price: Low to High</option>
              <option value="desc">Price: High to Low</option>
            </select>
          </div>
        </div>

        {allProducts.length > 0 && (
          <div className="stats-container">
            {selectedCategory ? (
              <div className="stats-pill">
                Showing <span>{displayedProducts.length.toLocaleString()}</span> of <span>{allProducts.length.toLocaleString()}</span> loaded products
                {selectedCategory && ` in ${selectedCategory}`}
              </div>
            ) : (
              <div className="stats-unfiltered">
                <div className="stats-main-line">
                  Showing <span>{allProducts.length.toLocaleString()}</span> out of <span>200,000</span> total products
                </div>
                <div className="stats-sub-line">
                  Load more to get more products
                </div>
                {hasMore && (
                  <button
                    className="btn-load-more-small"
                    onClick={handleLoadMore}
                    disabled={loading}
                    aria-label="Load more products"
                  >
                    {loading ? 'Loading...' : 'Load More'}
                  </button>
                )}
              </div>
            )}
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
          products={displayedProducts}
          loading={loading}
          error={error}
          hasMore={hasMore}
          onLoadMore={handleLoadMore}
          totalLoaded={allProducts.length}
        />
      )}
    </div>
  );
}
