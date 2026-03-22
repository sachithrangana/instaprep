import React, { useState } from 'react';
import './CourseCreation.css';

// Parse chapters from book (handles both new structured format and old format)
// Must be defined outside component or before hooks to use in useState initialization
function parseBookChapters(book) {
  if (!book.chapters) return null;
  
  // New format: Check if chapters is already a structured array
  if (Array.isArray(book.chapters) && book.chapters.length > 0) {
    return book.chapters;
  }
  
  // Old format: Try to parse JSON string
  try {
    const chaptersData = typeof book.chapters === 'string' 
      ? JSON.parse(book.chapters) 
      : book.chapters;
    
    if (chaptersData && chaptersData.chapters && Array.isArray(chaptersData.chapters)) {
      return chaptersData.chapters;
    }
    // Also handle direct array format
    if (Array.isArray(chaptersData)) {
      return chaptersData;
    }
  } catch (e) {
    console.warn('Error parsing chapters JSON:', e);
  }
  return null;
}

// Get sections from book (handles structured format)
function getBookSections(book) {
  if (!book.sections) return [];
  
  // New format: structured array
  if (Array.isArray(book.sections) && book.sections.length > 0) {
    return book.sections;
  }
  
  return [];
}

function CourseCreation({ books, onClose, onCourseCreated }) {
  const [courseData, setCourseData] = useState({
    title: '',
    description: '',
    selectedBooks: [],
    selectedChapters: {}, // { bookId: [chapterIndex1, chapterIndex2, ...] }
    selectedSections: {} // { bookId: { chapterIndex: [sectionIndex1, sectionIndex2, ...] } }
  });
  
  // Initialize expanded state - expand all books by default
  const [expandedBooks, setExpandedBooks] = useState(() => {
    const expanded = {};
    books.forEach(book => {
      expanded[book.book_id] = true; // Expand all books by default
    });
    return expanded;
  });
  
  // Initialize expanded chapters - expand all chapters by default
  const [expandedChapters, setExpandedChapters] = useState(() => {
    const expanded = {};
    books.forEach(book => {
      const chapters = parseBookChapters(book);
      if (chapters && chapters.length > 0) {
        expanded[book.book_id] = {};
        chapters.forEach((_, chapterIndex) => {
          expanded[book.book_id][chapterIndex] = true; // Expand all chapters by default
        });
      }
    });
    return expanded;
  });
  
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setCourseData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const toggleBookExpanded = (bookId) => {
    setExpandedBooks(prev => ({
      ...prev,
      [bookId]: !prev[bookId]
    }));
  };

  const toggleChapterExpanded = (bookId, chapterIndex) => {
    setExpandedChapters(prev => ({
      ...prev,
      [bookId]: {
        ...prev[bookId],
        [chapterIndex]: !prev[bookId]?.[chapterIndex]
      }
    }));
  };

  const handleBookToggle = (bookId) => {
    setCourseData(prev => {
      const isCurrentlySelected = prev.selectedBooks.includes(bookId);
      
      if (isCurrentlySelected) {
        // Deselecting book - remove all its chapters and sections
        const selectedBooks = prev.selectedBooks.filter(id => id !== bookId);
        const newSelectedChapters = { ...prev.selectedChapters };
        const newSelectedSections = { ...prev.selectedSections };
        delete newSelectedChapters[bookId];
        delete newSelectedSections[bookId];
        
        return {
          ...prev,
          selectedBooks,
          selectedChapters: newSelectedChapters,
          selectedSections: newSelectedSections
        };
      } else {
        // Selecting book - automatically select all chapters and sections
        const selectedBooks = [...prev.selectedBooks, bookId];
        const book = books.find(b => b.book_id === bookId);
        const chapters = book ? parseBookChapters(book) : null;
        const sections = book ? getBookSections(book) : [];
        
        const newSelectedChapters = { ...prev.selectedChapters };
        const newSelectedSections = { ...prev.selectedSections };
        
        if (chapters && chapters.length > 0) {
          // Select all chapters using chapter_id
          newSelectedChapters[bookId] = chapters.map(chapter => chapter.chapter_id).filter(id => id !== undefined);
          
          // Select all sections in all chapters
          newSelectedSections[bookId] = {};
          chapters.forEach((chapter) => {
            const chapterId = chapter.chapter_id;
            if (chapterId !== undefined) {
              // Get sections for this chapter: from nested sections or from flat sections array
              let chapterSections = chapter.sections || [];
              if (chapterSections.length === 0 && sections.length > 0) {
                // If no nested sections, try to find sections by chapter_id
                chapterSections = sections.filter(s => s.chapter_id === chapterId);
              }
              
              if (chapterSections.length > 0) {
                // Select all sections using section_id
                newSelectedSections[bookId][chapterId] = chapterSections.map(section => section.section_id).filter(id => id !== undefined);
              }
            }
          });
        }
        
        return {
          ...prev,
          selectedBooks,
          selectedChapters: newSelectedChapters,
          selectedSections: newSelectedSections
        };
      }
    });
  };

  const handleChapterToggle = (bookId, chapterId) => {
    setCourseData(prev => {
      const selectedChapters = { ...prev.selectedChapters };
      const bookChapters = selectedChapters[bookId] || [];
      const isCurrentlySelected = bookChapters.includes(chapterId);
      
      if (isCurrentlySelected) {
        // Deselect chapter - remove all sections from this chapter
        selectedChapters[bookId] = bookChapters.filter(id => id !== chapterId);
        const newSelectedSections = { ...prev.selectedSections };
        if (newSelectedSections[bookId] && newSelectedSections[bookId][chapterId]) {
          delete newSelectedSections[bookId][chapterId];
          if (Object.keys(newSelectedSections[bookId]).length === 0) {
            delete newSelectedSections[bookId];
          }
        }
        return {
          ...prev,
          selectedChapters,
          selectedSections: newSelectedSections
        };
      } else {
        // Select chapter - automatically select all its sections
        selectedChapters[bookId] = [...bookChapters, chapterId];
        
        // Ensure book is selected
        const selectedBooks = prev.selectedBooks.includes(bookId) 
          ? prev.selectedBooks 
          : [...prev.selectedBooks, bookId];
        
        // Get the book and chapter data to find sections
        const book = books.find(b => b.book_id === bookId);
        const chapters = book ? parseBookChapters(book) : null;
        const sections = book ? getBookSections(book) : [];
        
        // Find the chapter by chapter_id
        const chapter = chapters ? chapters.find(ch => ch.chapter_id === chapterId) : null;
        
        // Get sections for this chapter: from nested sections or from flat sections array
        let chapterSections = chapter ? (chapter.sections || []) : [];
        if (chapterSections.length === 0 && sections.length > 0 && chapterId !== undefined) {
          // If no nested sections, try to find sections by chapter_id
          chapterSections = sections.filter(s => s.chapter_id === chapterId);
        }
        
        const newSelectedSections = { ...prev.selectedSections };
        if (!newSelectedSections[bookId]) {
          newSelectedSections[bookId] = {};
        }
        
        // Select all sections in this chapter using section_id
        if (chapterSections.length > 0 && chapterId !== undefined) {
          newSelectedSections[bookId][chapterId] = chapterSections.map(section => section.section_id).filter(id => id !== undefined);
        }
        
        return {
          ...prev,
          selectedBooks,
          selectedChapters,
          selectedSections: newSelectedSections
        };
      }
    });
  };
  

  const handleSectionToggle = (bookId, chapterId, sectionId) => {
    setCourseData(prev => {
      // Create a deep copy of selectedSections to avoid mutation
      const selectedSections = JSON.parse(JSON.stringify(prev.selectedSections));
      
      if (!selectedSections[bookId]) {
        selectedSections[bookId] = {};
      }
      if (!selectedSections[bookId][chapterId]) {
        selectedSections[bookId][chapterId] = [];
      }
      
      const chapterSections = selectedSections[bookId][chapterId];
      const isCurrentlySelected = chapterSections.includes(sectionId);
      
      if (isCurrentlySelected) {
        // Deselect section - remove it from selection
        selectedSections[bookId][chapterId] = chapterSections.filter(idx => idx !== sectionId);
        
        // Clean up empty arrays
        if (selectedSections[bookId][chapterId].length === 0) {
          delete selectedSections[bookId][chapterId];
        }
        
        // Clean up empty objects
        if (Object.keys(selectedSections[bookId]).length === 0) {
          delete selectedSections[bookId];
        }
      } else {
        // Select section - add it to selection
        selectedSections[bookId][chapterId] = [...chapterSections, sectionId];
        
        // Ensure the book is selected when a section is selected
        const selectedBooks = prev.selectedBooks.includes(bookId) 
          ? prev.selectedBooks 
          : [...prev.selectedBooks, bookId];
        
        // Ensure the parent chapter is selected when a section is selected
        const selectedChapters = { ...prev.selectedChapters };
        if (!selectedChapters[bookId]) {
          selectedChapters[bookId] = [];
        }
        if (!selectedChapters[bookId].includes(chapterId)) {
          selectedChapters[bookId] = [...selectedChapters[bookId], chapterId];
        }
        
        return {
          ...prev,
          selectedBooks,
          selectedChapters,
          selectedSections
        };
      }
      
      return {
        ...prev,
        selectedSections
      };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!courseData.title) {
      setError('Please provide a course title');
      return;
    }

    if (courseData.selectedBooks.length === 0) {
      setError('Please select at least one book, chapter, or section');
      return;
    }

    setCreating(true);

    try {
      const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
      const response = await fetch(`${API_BASE}/courses/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: courseData.title,
          description: courseData.description,
          book_ids: courseData.selectedBooks,
          selected_chapters: courseData.selectedChapters,
          selected_sections: courseData.selectedSections
        })
      });

      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Course creation failed');
      }

      const result = await response.json();
      
      // Call callback with created course data
      if (onCourseCreated) {
        onCourseCreated(result.course);
      }

      // Reset and close
      setCourseData({
        title: '',
        description: '',
        selectedBooks: [],
        selectedChapters: {},
        selectedSections: {}
      });
      setExpandedBooks({});
      setExpandedChapters({});
      
      if (onClose) {
        onClose();
      }
    } catch (err) {
      setError(err.message || 'Failed to create course');
    } finally {
      setCreating(false);
    }
  };

  // Calculate selection summary
  const getSelectionSummary = () => {
    const selectedBooksCount = courseData.selectedBooks.length;
    let selectedChaptersCount = 0;
    let selectedSectionsCount = 0;
    
    // Count selected chapters
    Object.values(courseData.selectedChapters).forEach(chapterIndices => {
      selectedChaptersCount += chapterIndices.length;
    });
    
    // Count selected sections
    Object.values(courseData.selectedSections).forEach(chapterSections => {
      Object.values(chapterSections).forEach(sectionIndices => {
        selectedSectionsCount += sectionIndices.length;
      });
    });
    
    return { selectedBooksCount, selectedChaptersCount, selectedSectionsCount };
  };

  const summary = getSelectionSummary();

  return (
    <div className="course-creation-modal">
      <div className="course-creation-content">
        <button className="course-creation-close" onClick={onClose}>×</button>
        
        <h2>Create New Course</h2>
        
        {error && (
          <div className="creation-error">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="course-creation-form">
          <div className="form-group">
            <label htmlFor="title">Course Title *</label>
            <input
              type="text"
              id="title"
              name="title"
              value={courseData.title}
              onChange={handleInputChange}
              required
              disabled={creating}
              placeholder="Enter course title"
            />
          </div>

          <div className="form-group">
            <label htmlFor="description">Description</label>
            <textarea
              id="description"
              name="description"
              value={courseData.description}
              onChange={handleInputChange}
              disabled={creating}
              placeholder="Enter course description (optional)"
              rows="3"
            />
          </div>

          <div className="form-group">
            <label>Select Books, Chapters, or Sections *</label>
            <div className="books-selection">
              {books.length === 0 ? (
                <p className="no-books">No books available. Please upload books first.</p>
              ) : (
                console.log('books.....', books),
                books.map(book => {
                  const isBookSelected = courseData.selectedBooks.includes(book.book_id);
                  const isBookExpanded = expandedBooks[book.book_id] !== undefined ? expandedBooks[book.book_id] : true;
                  const chapters = parseBookChapters(book);
                  const sections = getBookSections(book);
                  const bookSelectedChapters = courseData.selectedChapters[book.book_id] || [];
                  const bookSelectedSections = courseData.selectedSections[book.book_id] || {};
                  
                  return (
                    <div key={book.book_id} className="book-tree-item">
                      <label className="book-checkbox-label">
                        <input
                          type="checkbox"
                          checked={isBookSelected}
                          onChange={() => handleBookToggle(book.book_id)}
                          disabled={creating}
                        />
                        <div className="book-checkbox-info">
                          <span className="book-title">{book.title}</span>
                          <span className="book-meta">
                            {book.project_name || ''} • {chapters ? chapters.length : 0} chapters
                          </span>
                        </div>
                        {chapters && chapters.length > 0 && (
                          <button
                            type="button"
                            className="expand-toggle"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              toggleBookExpanded(book.book_id);
                            }}
                            disabled={creating}
                          >
                            {isBookExpanded ? '▼' : '▶'}
                          </button>
                        )}
                      </label>
                      
                      {isBookExpanded && chapters && chapters.length > 0 && (
                        <div className="chapters-container">
                          {chapters.map((chapter, chapterIndex) => {
                            const isChapterExpanded = expandedChapters[book.book_id]?.[chapter.chapter_id] !== undefined 
                              ? expandedChapters[book.book_id][chapter.chapter_id] 
                              : true; // Default to expanded
                            const isChapterSelected = bookSelectedChapters.includes(chapter.chapter_id);
                            
                            // Get sections for this chapter: from nested sections or from flat sections array
                            let chapterSections = chapter.sections || [];
                            if (chapterSections.length === 0 && sections.length > 0) {
                              // If no nested sections, try to find sections by chapter_id
                              const chapterId = chapter.chapter_id;
                              chapterSections = sections.filter(s => s.chapter_id === chapterId);
                            }
                            
                            const chapterSelectedSections = bookSelectedSections[chapter.chapter_id] || [];
                            return (
                              <div key={chapter.chapter_id || chapterIndex} className="chapter-tree-item">
                                <label className="chapter-checkbox-label">
                                  <input
                                    type="checkbox"
                                    checked={isChapterSelected}
                                    onChange={() => handleChapterToggle(book.book_id, chapter.chapter_id)}
                                    disabled={creating}
                                  />
                                  <div className="chapter-checkbox-info">
                                    <span className="chapter-title">
                                      {chapter.title || chapter.name || `Chapter ${chapterIndex + 1}`}
                                    </span>
                                    <span className="chapter-meta">
                                      {chapterSections.length} sections
                                    </span>
                                  </div>
                                  {chapterSections.length > 0 && (
                                    <button
                                      type="button"
                                      className="expand-toggle"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        toggleChapterExpanded(book.book_id, chapter.chapter_id);
                                      }}
                                      disabled={creating}
                                    >
                                      {isChapterExpanded ? '▼' : '▶'}
                                    </button>
                                  )}
                                </label>
                                
                                {isChapterExpanded && chapterSections.length > 0 && (
                                  <div 
                                    className="sections-container"
                                    onClick={(e) => {
                                      // Stop all clicks in sections container from bubbling to parent
                                      e.stopPropagation();
                                    }}
                                  >
                                    {chapterSections.map((section, sectionIndex) => {
                                      const isSectionSelected = chapterSelectedSections.includes(section.section_id);
                                      
                                      return (
                                        <label
                                          key={section.section_id || section.section_id}
                                          className="section-checkbox-label"
                                          onClick={(e) => {
                                            // Stop propagation to prevent parent chapter from handling
                                            e.stopPropagation();
                                          }}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={isSectionSelected}
                                            onChange={(e) => {
                                              // Stop propagation and handle the toggle
                                              e.stopPropagation();
                                              if (!creating) {
                                                handleSectionToggle(book.book_id, section.chapter_id, section.section_id);
                                              }
                                            }}
                                            onClick={(e) => {
                                              // Stop propagation but allow checkbox to toggle
                                              e.stopPropagation();
                                            }}
                                            disabled={creating}
                                          />
                                          <div 
                                            className="section-checkbox-info"
                                            onClick={(e) => {
                                              // Allow clicking text to toggle checkbox
                                              e.stopPropagation();
                                              if (!creating) {
                                                handleSectionToggle(book.book_id, section.chapter_id, section.section_id);
                                              }
                                            }}
                                          >
                                            <span className="section-title">
                                              {section.title || section.name || `Section ${sectionIndex + 1}`}
                                            </span>
                                          </div>
                                        </label>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {(summary.selectedBooksCount > 0 || summary.selectedChaptersCount > 0 || summary.selectedSectionsCount > 0) && (
            <div className="selection-summary">
              {summary.selectedBooksCount > 0 && (
                <span><strong>{summary.selectedBooksCount}</strong> book(s) • </span>
              )}
              {summary.selectedChaptersCount > 0 && (
                <span><strong>{summary.selectedChaptersCount}</strong> chapter(s) • </span>
              )}
              {summary.selectedSectionsCount > 0 && (
                <span><strong>{summary.selectedSectionsCount}</strong> section(s)</span>
              )}
            </div>
          )}

          <div className="form-actions">
            <button
              type="button"
              className="btn-cancel"
              onClick={onClose}
              disabled={creating}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-create"
              disabled={creating || books.length === 0}
            >
              {creating ? 'Creating...' : 'Create Course'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CourseCreation;

