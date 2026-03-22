import React from 'react';
import './BookSearch.css';

function BookSearch({ searchQuery, onSearchChange, placeholder = "Search books..." }) {
  return (
    <div className="book-search-container">
      <div className="search-input-wrapper">
        <span className="search-icon">🔍</span>
        <input
          type="text"
          className="book-search-input"
          placeholder={placeholder}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        {searchQuery && (
          <button
            className="search-clear-btn"
            onClick={() => onSearchChange('')}
            title="Clear search"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

export default BookSearch;

