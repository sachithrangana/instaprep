import React from 'react';
import './BookList.css';

function BookList({ books, onBookClick }) {
  // Calculate actual chapters and sections from structured data
  const calculateBookStats = (book) => {
    // First, check if verified counts from DB collections are available
    if (book.total_chapters !== undefined && book.total_sections !== undefined) {
      return {
        chapters: book.total_chapters,
        sections: book.total_sections
      };
    }
    
    // New format: Check if chapters is already a structured array
    if (book.chapters && Array.isArray(book.chapters) && book.chapters.length > 0) {
      // Count chapters from structured array
      const chaptersCount = book.chapters.length;
      
      // Count sections from structured sections array (if available)
      if (book.sections && Array.isArray(book.sections) && book.sections.length > 0) {
        return {
          chapters: chaptersCount,
          sections: book.sections.length
        };
      }
      
      // Otherwise, count sections from nested chapters
      let totalSections = 0;
      book.chapters.forEach(chapter => {
        if (chapter.sections && Array.isArray(chapter.sections)) {
          totalSections += chapter.sections.length;
        }
      });
      
      return {
        chapters: chaptersCount,
        sections: totalSections
      };
    }
    
    // Old format: Try to parse chapters JSON if available
    if (book.chapters) {
      try {
        // Parse JSON string if it's a string
        const chaptersData = typeof book.chapters === 'string' 
          ? JSON.parse(book.chapters) 
          : book.chapters;
        
        // Check if chapters data has the expected structure
        if (chaptersData && chaptersData.chapters && Array.isArray(chaptersData.chapters)) {
          const chaptersArray = chaptersData.chapters;
          let totalSections = 0;
          
          chaptersArray.forEach(chapter => {
            if (chapter.sections && Array.isArray(chapter.sections)) {
              totalSections += chapter.sections.length;
            }
          });
          
          return {
            chapters: chaptersArray.length,
            sections: totalSections
          };
        }
      } catch (e) {
        console.warn('Error parsing chapters JSON:', e);
      }
    }
    
    // Fallback to estimated values if chapters data is not available
    const sections = book.text_unit_count || 0;
    const chapters = Math.max(1, Math.ceil(sections / 12));
    return { chapters, sections };
  };

  if (books.length === 0) {
    return (
      <div className="no-books">
        <p>No books found. Make sure you have GraphRAG projects with indexed documents.</p>
      </div>
    );
  }

  return (
    <div className="books-grid">
      {books.map((book) => {
        const { chapters, sections } = calculateBookStats(book);
        return (
          <div
            key={book.id}
            className={`book-card ${!onBookClick ? 'book-card-no-click' : ''}`}
            onClick={onBookClick ? () => onBookClick(book.id) : undefined}
          >
            <h3>{book.title}</h3>
            {book.description && (
              <p className="book-description">{book.description}</p>
            )}
            <div className="book-stats">
              <span className="stat-item">
                <strong>{chapters}</strong> chapters
              </span>
              <span className="stat-item">
                <strong>{sections}</strong> sections
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default BookList;

