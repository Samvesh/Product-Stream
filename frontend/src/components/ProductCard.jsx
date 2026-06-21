// ProductCard.jsx — displays a single product row as a card

// Map category names to CSS class suffixes for colour coding
function getCategoryClass(category) {
  const map = {
    'Electronics':       'electronics',
    'Clothing':          'clothing',
    'Home & Garden':     'home-garden',
    'Sports & Outdoors': 'sports-outdoors',
    'Books':             'books',
    'Toys & Games':      'toys-games',
    'Health & Beauty':   'health-beauty',
    'Automotive':        'automotive',
    'Food & Grocery':    'food-grocery',
    'Office Supplies':   'office-supplies',
  };
  return `cat-${map[category] || 'default'}`;
}

function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function ProductCard({ product }) {
  const { name, category, price, created_at } = product;
  const catClass = getCategoryClass(category);

  return (
    <article className="product-card">
      <span className={`product-category ${catClass}`}>{category}</span>
      <p className="product-name">{name}</p>
      <div className="product-footer">
        <span className="product-price">${parseFloat(price).toFixed(2)}</span>
        <span className="product-date">{formatDate(created_at)}</span>
      </div>
    </article>
  );
}
