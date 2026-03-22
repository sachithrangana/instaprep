import React, { useState } from 'react';
import './CourseDetails.css';

// Helper function to parse chapters (needed for initialization)
function parseBookChapters(book) {
  if (!book.chapters) return null;
  
  // Check if chapters is already a structured array (new format)
  if (Array.isArray(book.chapters) && book.chapters.length > 0) {
    // New format: structured array with chapter_id
    return book.chapters;
  }
  
  // Try to parse JSON string (old format)
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

// Helper function to get book sections (new structured format)
function getBookSections(book) {
  if (!book.sections) return [];
  
  // Check if sections is already a structured array (new format)
  if (Array.isArray(book.sections) && book.sections.length > 0) {
    return book.sections;
  }
  
  return [];
}

function CourseDetails({ course, onBookClick, onCreateAssessment, onArchive, onUnarchive, isArchived = false }) {
  // Get selected chapters for a book (handles both new and old format)
  // Returns array of chapter objects with chapter_id
  const getSelectedChaptersForBook = (bookId) => {
    if (!course || !course.selected_chapters) return [];
    
    if (Array.isArray(course.selected_chapters)) {
      // New format: array of objects with book_id and chapter_id
      return course.selected_chapters.filter(ch => ch.book_id === bookId);
    } else if (typeof course.selected_chapters === 'object') {
      // Old format: { bookId: [chapterIndex1, ...] }
      const chapterIndices = course.selected_chapters[bookId] || [];
      // Convert indices to chapter objects (will need book data)
      return chapterIndices.map(idx => ({ chapter_index: idx }));
    }
    return [];
  };

  // Helper to get all book IDs that have selected chapters or sections
  // Must be defined before useState hooks that use it
  const getSelectedBookIds = () => {
    if (!course) return [];
    const bookIds = new Set();
    
    // Get book IDs from selected chapters
    if (course.selected_chapters) {
      if (Array.isArray(course.selected_chapters)) {
        course.selected_chapters.forEach(ch => {
          bookIds.add(ch.book_id);
        });
      } else if (typeof course.selected_chapters === 'object') {
        Object.keys(course.selected_chapters).forEach(bookId => {
          bookIds.add(bookId);
        });
      }
    }
    
    // Get book IDs from selected sections
    if (course.selected_sections) {
      if (Array.isArray(course.selected_sections)) {
        course.selected_sections.forEach(s => {
          bookIds.add(s.book_id);
        });
      } else if (typeof course.selected_sections === 'object') {
        Object.keys(course.selected_sections).forEach(bookId => {
          bookIds.add(bookId);
        });
      }
    }
    
    return Array.from(bookIds);
  };

  // Initialize ALL books and chapters as expanded by default
  // Hooks must be called unconditionally
  const [expandedBooks, setExpandedBooks] = useState(() => {
    if (!course || !course.books) return {};
    const expanded = {};
    // Expand all books by default
    course.books.forEach(book => {
      expanded[book.id] = true;
    });
    return expanded;
  });
  
  const [expandedChapters, setExpandedChapters] = useState(() => {
    if (!course || !course.books) return {};
    const expanded = {};
    
    // Expand all chapters for all books by default
    course.books.forEach(book => {
      const chapters = parseBookChapters(book);
      if (chapters && chapters.length > 0) {
        expanded[book.id] = {};
        chapters.forEach((_, chapterIndex) => {
          expanded[book.id][chapterIndex] = true; // Expand all chapters
        });
      }
    });
    return expanded;
  });

  // Early return after hooks
  if (!course) return null;


  // Get selected sections for a chapter (handles both new and old format)
  // Returns array of section objects with section_id
  const getSelectedSectionsForChapter = (bookId, chapterId) => {
    if (!course.selected_sections) return [];
    
    if (Array.isArray(course.selected_sections)) {
      // New format: array of objects with book_id, chapter_id, and section_id
      return course.selected_sections.filter(s => 
        s.book_id === bookId && s.chapter_id === chapterId
      );
    } else if (typeof course.selected_sections === 'object') {
      // Old format: { bookId: { chapterIndex: [sectionIndex1, ...] } }
      // This format uses indices, so we'll need to convert
      const chapterIndex = parseInt(chapterId.split('_').pop()); // Extract index from chapter_id if needed
      const sectionIndices = course.selected_sections[bookId]?.[chapterIndex] || [];
      return sectionIndices.map(idx => ({ section_index: idx }));
    }
    return [];
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

  const handleCreateFromCourse = () => {
    onCreateAssessment({
      source: course,
      sourceType: 'course',
      selectedSections: [] // Empty means entire course
    });
  };

  const handleArchiveClick = () => {
    if (onArchive) {
      onArchive(course.id, { stopPropagation: () => {} });
    }
  };

  const handleUnarchiveClick = () => {
    if (onUnarchive) {
      onUnarchive(course.id, { stopPropagation: () => {} });
    }
  };

  return (
    <div className="course-details">
      <div className="course-info-header">
        <div>
          <h2>{course.title}</h2>
          <div className="course-meta">
            <span>
              {course.involvedBooksCount !== undefined && course.involvedBooksCount !== null 
                ? course.involvedBooksCount 
                : (course.books ? course.books.length : 0)} books
            </span>
            <span>•</span>
            <span>{(() => {
              // Calculate actual chapter count from selected_chapters
              let chapterCount = 0;
              if (course.selected_chapters) {
                if (Array.isArray(course.selected_chapters)) {
                  // New format: array of objects
                  const uniqueChapters = new Set();
                  course.selected_chapters.forEach(ch => {
                    const key = `${ch.book_id}_${ch.chapter_id}`;
                    uniqueChapters.add(key);
                  });
                  chapterCount = uniqueChapters.size;
                } else if (typeof course.selected_chapters === 'object') {
                  // Old format: { bookId: [chapterIndex1, ...] }
                  Object.values(course.selected_chapters).forEach(chapterIndices => {
                    if (Array.isArray(chapterIndices)) {
                      chapterCount += chapterIndices.length;
                    }
                  });
                }
              }
              return chapterCount || course.totalChapters || course.selectedChaptersCount || 0;
            })()} chapters</span>
            <span>•</span>
            <span>{(() => {
              // Calculate actual section count from selected_sections
              let sectionCount = 0;
              if (course.selected_sections) {
                if (Array.isArray(course.selected_sections)) {
                  // New format: array of objects
                  sectionCount = course.selected_sections.length;
                } else if (typeof course.selected_sections === 'object') {
                  // Old format: { bookId: { chapterIndex: [sectionIndex1, ...] } }
                  Object.values(course.selected_sections).forEach(chapterSections => {
                    if (typeof chapterSections === 'object') {
                      Object.values(chapterSections).forEach(sectionIndices => {
                        if (Array.isArray(sectionIndices)) {
                          sectionCount += sectionIndices.length;
                        }
                      });
                    }
                  });
                }
              }
              return sectionCount || course.totalSections || 0;
            })()} sections</span>
            <span>•</span>
            <span>{course.projectCount} {course.projectCount === 1 ? 'project' : 'projects'}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexDirection: 'column', alignItems: 'flex-end' }}>
          <button 
            className="btn-create-assessment"
            onClick={handleCreateFromCourse}
            title="Create assessment from entire course"
          >
            📝 Create Assessment (Full Course)
          </button>
          {isArchived ? (
            <button 
              className="btn-archive unarchive-btn-detail"
              onClick={handleUnarchiveClick}
              title="Unarchive course"
            >
              📤 Unarchive Course
            </button>
          ) : (
            <button 
              className="btn-archive"
              onClick={handleArchiveClick}
              title="Archive course"
            >
              📦 Archive Course
            </button>
          )}
        </div>
      </div>
      
      <p className="course-description-full">{course.description}</p>

      <div className="course-books-section">
        <h3>Selected Books, Chapters, and Sections</h3>
        <div className="course-content-tree">
          {(() => {
            // Get list of books that have selected chapters or sections
            const selectedBookIds = getSelectedBookIds();
            
            if (selectedBookIds.length === 0) {
              return (
                <p style={{ color: 'rgba(255, 255, 255, 0.8)', padding: '20px', textAlign: 'center' }}>
                  No selected books, chapters, or sections in this course.
                </p>
              );
            }
            
            // Group selected chapters and sections by book_id
            const booksData = {};
            
            // Process selected chapters
            if (course.selected_chapters && Array.isArray(course.selected_chapters)) {
              course.selected_chapters.forEach(chapter => {
                const bookId = chapter.book_id;
                if (!booksData[bookId]) {
                  booksData[bookId] = {
                    book_id: bookId,
                    title: chapter.book_title || `Book ${bookId}`,
                    chapters: [],
                    sections: []
                  };
                }
                if (!booksData[bookId].chapters.find(ch => ch.chapter_id === chapter.chapter_id)) {
                  booksData[bookId].chapters.push(chapter);
                }
              });
            }
            
            // Process selected sections
            if (course.selected_sections && Array.isArray(course.selected_sections)) {
              course.selected_sections.forEach(section => {
                const bookId = section.book_id;
                if (!booksData[bookId]) {
                  booksData[bookId] = {
                    book_id: bookId,
                    title: section.book_title || `Book ${bookId}`,
                    chapters: [],
                    sections: []
                  };
                }
                if (!booksData[bookId].sections.find(s => s.section_id === section.section_id)) {
                  booksData[bookId].sections.push(section);
                }
              });
            }
            
            // Try to get book titles from course.books if available
            if (course.books && Array.isArray(course.books)) {
              course.books.forEach(book => {
                const bookId = book.id || book.book_id;
                if (booksData[bookId]) {
                  booksData[bookId].title = book.title || booksData[bookId].title;
                  booksData[bookId].description = book.description;
                }
              });
            }
            
            const booksWithSelections = Object.values(booksData);
            
            if (booksWithSelections.length === 0) {
              return (
                <p style={{ color: 'rgba(255, 255, 255, 0.8)', padding: '20px', textAlign: 'center' }}>
                  No selected books, chapters, or sections in this course.
                </p>
              );
            }
            
            // Show only selected books with their selected chapters and sections
            return booksWithSelections.map((bookData) => {
              const bookId = bookData.book_id;
              const selectedChapters = bookData.chapters || [];
              const selectedSectionsForBook = bookData.sections || [];
              const isBookExpanded = expandedBooks[bookId] ?? true; // Default to expanded
              
              // Only show book if it has selected chapters or sections
              if (selectedChapters.length === 0 && selectedSectionsForBook.length === 0) {
                return null; // Skip books with no selected content
              }
              
              return (
                <div key={bookId} className="course-book-item">
                  <div 
                    className="course-book-header"
                    onClick={() => toggleBookExpanded(bookId)}
                  >
                    <button
                      type="button"
                      className="expand-toggle"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleBookExpanded(bookId);
                      }}
                    >
                      {isBookExpanded ? '▼' : '▶'}
                    </button>
                    <div className="course-book-header-content">
                      <h4 className="book-title-in-course selected">
                        {bookData.title}
                        <span className="selected-badge" style={{ marginLeft: '10px' }}>Selected</span>
                      </h4>
                      {bookData.description && (
                        <p className="book-description-inline">{bookData.description}</p>
                      )}
                    </div>
                  </div>
                  
                  {isBookExpanded && (selectedChapters.length > 0 || selectedSectionsForBook.length > 0) && (
                    <div className="course-chapters-container">
                      {/* Show only selected chapters */}
                      {selectedChapters.length > 0 ? selectedChapters.map((selectedChapter, idx) => {
                        const chapterId = selectedChapter.chapter_id;
                        
                        // Use data from selectedChapter
                        const chapterTitle = selectedChapter.title || selectedChapter.text?.split('\n')[0]?.substring(0, 50) || `Chapter ${idx + 1}`;
                        const chapterText = selectedChapter.text || '';
                        const chapterObjectives = selectedChapter.objectives || [];
                        
                        // Get selected sections for this chapter
                        const selectedSections = selectedSectionsForBook.filter(s => s.chapter_id === chapterId);
                        
                        const isChapterExpanded = expandedChapters[bookId]?.[idx] ?? true;
                        
                        return (
                          <div key={chapterId || idx} className="course-chapter-item">
                            <div 
                              className="course-chapter-header"
                              onClick={() => toggleChapterExpanded(bookId, idx)}
                            >
                              <button
                                type="button"
                                className="expand-toggle"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleChapterExpanded(bookId, idx);
                                }}
                              >
                                {isChapterExpanded ? '▼' : '▶'}
                              </button>
                              <div className="chapter-info">
                                <span className="chapter-title-in-course selected">
                                  {chapterTitle}
                                  <span className="selected-badge">Selected</span>
                                </span>
                              </div>
                              <span className="chapter-meta-in-course">
                                {selectedSections.length} selected section{selectedSections.length !== 1 ? 's' : ''}
                              </span>
                            </div>
                            
                            {isChapterExpanded && (
                              <div>
                                {/* Show chapter objectives if available */}
                                {chapterObjectives.length > 0 && (
                                  <div className="chapter-objectives" style={{ marginTop: '8px', paddingLeft: '20px', marginBottom: '12px' }}>
                                    <strong style={{ fontSize: '0.85em', color: 'rgba(255, 255, 255, 0.7)' }}>Chapter Objectives:</strong>
                                    <ul style={{ margin: '4px 0', paddingLeft: '20px', fontSize: '0.85em', color: 'rgba(255, 255, 255, 0.8)' }}>
                                      {chapterObjectives.map((obj, objIdx) => (
                                        <li key={objIdx}>{typeof obj === 'string' ? obj : obj.text || obj.title || JSON.stringify(obj)}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                
                                {/* Show chapter text if available */}
                                {chapterText && (
                                  <div className="chapter-text-preview" style={{ marginTop: '8px', paddingLeft: '20px', marginBottom: '12px', fontSize: '0.9em', color: 'rgba(255, 255, 255, 0.7)', fontStyle: 'italic' }}>
                                    {chapterText.length > 200 ? `${chapterText.substring(0, 200)}...` : chapterText}
                                  </div>
                                )}
                                
                                {/* Show selected sections */}
                                {selectedSections.length > 0 && (
                              <div className="course-sections-container">
                                {/* Show only selected sections */}
                                {selectedSections.map((selectedSection, sectionIdx) => {
                                  const sectionId = selectedSection.section_id;
                                  
                                  // Get objectives for this section
                                  const sectionObjectives = selectedSection.objectives || [];
                                  const sectionTitle = selectedSection.title || selectedSection.text?.split('\n')[0]?.substring(0, 50) || `Section ${sectionIdx + 1}`;
                                  
                                  return (
                                    <div 
                                      key={sectionId || sectionIdx} 
                                      className="course-section-item selected"
                                    >
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
                                        <span className="section-title-in-course">
                                          {sectionTitle}
                                        </span>
                                        <span className="selected-badge-small">✓</span>
                                      </div>
                                      {sectionObjectives.length > 0 && (
                                        <div className="section-objectives" style={{ marginTop: '8px', paddingLeft: '20px' }}>
                                          <strong style={{ fontSize: '0.85em', color: 'rgba(255, 255, 255, 0.7)' }}>Objectives:</strong>
                                          <ul style={{ margin: '4px 0', paddingLeft: '20px', fontSize: '0.85em', color: 'rgba(255, 255, 255, 0.8)' }}>
                                            {sectionObjectives.map((obj, objIdx) => (
                                              <li key={objIdx}>{typeof obj === 'string' ? obj : obj.text || obj.title || JSON.stringify(obj)}</li>
                                            ))}
                                          </ul>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                                </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      }) : (
                        // If no selected chapters but has selected sections, show sections directly
                        <div className="course-sections-container">
                          {selectedSectionsForBook.map((selectedSection, sectionIdx) => {
                            const sectionId = selectedSection.section_id;
                            const sectionObjectives = selectedSection.objectives || [];
                            const sectionTitle = selectedSection.title || selectedSection.text?.split('\n')[0]?.substring(0, 50) || `Section ${sectionIdx + 1}`;
                            
                            return (
                              <div 
                                key={sectionId || sectionIdx} 
                                className="course-section-item selected"
                                style={{ marginLeft: '0' }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
                                  <span className="section-title-in-course">
                                    {sectionTitle}
                                  </span>
                                  <span className="selected-badge-small">✓</span>
                                </div>
                                {sectionObjectives.length > 0 && (
                                  <div className="section-objectives" style={{ marginTop: '8px', paddingLeft: '20px' }}>
                                    <strong style={{ fontSize: '0.85em', color: 'rgba(255, 255, 255, 0.7)' }}>Objectives:</strong>
                                    <ul style={{ margin: '4px 0', paddingLeft: '20px', fontSize: '0.85em', color: 'rgba(255, 255, 255, 0.8)' }}>
                                      {sectionObjectives.map((obj, objIdx) => (
                                        <li key={objIdx}>{typeof obj === 'string' ? obj : obj.text || obj.title || JSON.stringify(obj)}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            }).filter(Boolean); // Remove any null entries
          })()}
        </div>
      </div>
    </div>
  );
}

export default CourseDetails;

