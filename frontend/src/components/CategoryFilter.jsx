// CategoryFilter.jsx — dropdown for filtering by category

export default function CategoryFilter({ categories, selected, onChange }) {
  return (
    <div className="controls">
      <span className="controls-label">Filter by category</span>
      <div className="select-wrapper">
        <select
          id="category-filter"
          value={selected}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Filter products by category"
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
  );
}
