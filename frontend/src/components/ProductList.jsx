// ProductList.jsx — renders the product grid and handles infinite scroll
//
// Infinite scroll strategy:
//   We place an invisible <div> (the "sentinel") at the bottom of the list.
//   An IntersectionObserver fires whenever the sentinel scrolls into the
//   viewport. When that happens (and we have more pages), we fetch the next
//   page using the cursor returned by the previous response.
//
// Why this is correct for keyset pagination:
//   Each "Load More" call passes the nextCursor from the LAST page, which
//   encodes the (created_at, id) of the last product shown. The API returns
//   rows strictly BEFORE that position — no gaps, no duplicates.

import { useRef, useEffect } from 'react';
import ProductCard from './ProductCard';

export default function ProductList({
  products,
  loading,
  error,
  hasMore,
  onLoadMore,
  totalLoaded,
}) {
  const sentinelRef = useRef(null);

  // Set up the IntersectionObserver to auto-load on scroll
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        // Fire when the sentinel is visible AND we're not already loading
        if (entry.isIntersecting && hasMore && !loading) {
          onLoadMore();
        }
      },
      { rootMargin: '200px' } // trigger 200px before the sentinel is visible
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, onLoadMore]);

  // ---- Empty / error / loading states ----
  if (!loading && error) {
    return (
      <div className="state-error">
        <span className="error-icon">⚠️</span>
        <p>{error}</p>
      </div>
    );
  }

  if (!loading && products.length === 0) {
    return (
      <div className="state-empty">
        <span className="empty-icon">📦</span>
        <p>No products found for this category.</p>
      </div>
    );
  }

  return (
    <>
      {/* Product grid */}
      <div className="product-grid" aria-label="Product list">
        {products.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>

      {/* Inline loading spinner while fetching next page */}
      {loading && products.length > 0 && (
        <div className="inline-loader" aria-live="polite">
          <div className="mini-spinner" />
          Loading more products…
        </div>
      )}

      {/* Invisible sentinel — triggers IntersectionObserver */}
      <div ref={sentinelRef} className="sentinel" aria-hidden="true" />

      {/* End-of-results message */}
      {!hasMore && products.length > 0 && (
        <div className="end-banner">
          You've reached the end — <strong>{totalLoaded.toLocaleString()}</strong> products loaded.
        </div>
      )}
    </>
  );
}
