import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './BookModal.css';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

// Helper function to parse chapters
function parseBookChapters(book) {
  if (!book) return null;
  
  // If chapters is already an array, return it
  if (Array.isArray(book.chapters) && book.chapters.length > 0) {
    return book.chapters;
  }
  
  // If chapters is a string, try to parse it
  if (typeof book.chapters === 'string' && book.chapters.trim()) {
    try {
      const chaptersData = JSON.parse(book.chapters);
      
      // Check if parsed data has chapters array
      if (chaptersData && chaptersData.chapters && Array.isArray(chaptersData.chapters)) {
        return chaptersData.chapters;
      }
      // Check if parsed data is directly an array
      if (Array.isArray(chaptersData)) {
        return chaptersData;
      }
    } catch (e) {
      console.warn('Error parsing chapters JSON:', e);
    }
  }
  
  // If chapters is an object (not array), check if it has a chapters property
  if (book.chapters && typeof book.chapters === 'object' && !Array.isArray(book.chapters)) {
    if (book.chapters.chapters && Array.isArray(book.chapters.chapters)) {
      return book.chapters.chapters;
    }
  }
  
  return null;
}

// Helper function to get book sections
function getBookSections(book) {
  if (!book.sections) return [];
  
  if (Array.isArray(book.sections) && book.sections.length > 0) {
    return book.sections;
  }
  
  return [];
}

function BookModal({ book, onClose }) {
  const [pdfUrl, setPdfUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [objectives, setObjectives] = useState([]);
  const [expandedChapters, setExpandedChapters] = useState({});
  const [expandedSections, setExpandedSections] = useState({});
  const [isAllExpanded, setIsAllExpanded] = useState(true);
  const [bookData, setBookData] = useState(book); // Store full book data with chapters

  useEffect(() => {
    if (!book) return;

    // Fetch full book details including chapters if not already present
    const fetchBookDetails = async () => {
      console.log('response.data------------------------++');
      try {
        const response = await axios.get(`${API_BASE}/books/${book.id}`);
        console.log('response.data------------------------++', response);
        if (response.data) {
          console.log('response.data------------------------', response.data);
          setBookData(response.data);
          // Update objectives from fetched data
          setObjectives(response.data.objectives || []);
        }
      } catch (err) {
        console.error('Error fetching book details:', err);
        // If fetch fails, use the book prop as fallback
        setBookData(book);
        setObjectives(book.objectives || []);
      }
    };

    // Check if book has chapters, if not fetch full details
    const chapters = parseBookChapters(book);
    if (!chapters || chapters.length === 0) {
      fetchBookDetails();
    } else {
      setBookData(book);
      setObjectives(book.objectives || []);
    }
  }, [book]);

  useEffect(() => {
    if (!bookData) return;

    // Get objectives from book data
    const bookObjectives = bookData.objectives || [];
    setObjectives(bookObjectives);

    // Initialize expanded chapters and sections state
    const chapters = parseBookChapters(bookData) || [];
    const sections = getBookSections(bookData) || [];
    
    const expandedChaps = {};
    const expandedSecs = {};
    
    // Initialize chapters and their nested sections
    if (chapters && chapters.length > 0) {
      chapters.forEach((chapter, chapterIndex) => {
        expandedChaps[chapterIndex] = true; // Expand all chapters by default
        // Expand all sections by default
        const chapterSections = chapter.sections || [];
        chapterSections.forEach((_, sectionIndex) => {
          const sectionKey = `${chapterIndex}_${sectionIndex}`;
          expandedSecs[sectionKey] = true;
        });
      });
    }
    
    // Initialize standalone sections
    if (sections && sections.length > 0) {
      // Collect all sections from chapters to identify standalone sections
      const allChapterSections = [];
      if (chapters && chapters.length > 0) {
        chapters.forEach((chapter) => {
          if (chapter.sections && Array.isArray(chapter.sections)) {
            allChapterSections.push(...chapter.sections);
          }
        });
      }
      
      // Initialize expanded state for standalone sections
      sections.forEach((section, index) => {
        // Check if this section is already in a chapter
        const isInChapter = allChapterSections.some(chapSec => 
          (chapSec.section_id && chapSec.section_id === section.section_id) ||
          (chapSec.id && chapSec.id === section.id)
        );
        
        if (!isInChapter) {
          const sectionKey = `standalone_${index}`;
          expandedSecs[sectionKey] = true;
        }
      });
    }
    
    setExpandedChapters(expandedChaps);
    setExpandedSections(expandedSecs);

    // Fetch PDF download URL
    const fetchPdfUrl = async () => {
      try {
        setLoading(true);
        setError(null);
        console.log('bookData.book_id------------------------++', bookData);
        const response = await axios.get(`${API_BASE}/books/${bookData.book_id}/download-url`);
        if (response.data && response.data.download_url) {
          setPdfUrl(response.data.download_url);
        } else {
          setError('PDF file not available');
        }
      } catch (err) {
        console.error('Error fetching PDF URL:', err);
        setError('Failed to load PDF: ' + (err.message || 'Unknown error'));
      } finally {
        setLoading(false);
      }
    };

    fetchPdfUrl();
  }, [bookData]);

  // Handle escape key to close modal
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [onClose]);

  if (!bookData) return null;

  return (
    <div className="book-modal-overlay" onClick={onClose}>
      <div className="book-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="book-modal-header">
          <h2>{bookData.title}</h2>
          <button className="book-modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="book-modal-body">
          <div className="book-modal-main-content">
            {/* Book Hyperlink Section */}
            <div className="book-modal-link-section">
              <h3>🔗 Book Download</h3>
              {loading && (
                <div className="book-modal-loading">
                  <div className="loading-spinner"></div>
                  <p>Loading download link...</p>
                </div>
              )}
              {error && (
                <div className="book-modal-error">
                  <p>{error}</p>
                </div>
              )}
              {pdfUrl && !loading && !error && (
                <div className="book-link-container">
                  <a 
                    href={pdfUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="book-download-link"
                  >
                    📥 Download {bookData.title}
                  </a>
                  <span className="book-link-info">
                    {(() => {
                      // Display s3_key/<2nd part of s3 key> format
                      const s3Key = bookData.s3_key;
                      if (s3Key) {
                        const parts = s3Key.split('/');
                        if (parts.length >= 2) {
                          // Take everything from the 2nd part onwards
                          const secondPartAndBeyond = parts.slice(1).join('/');
                          return `s3_key/${secondPartAndBeyond}`;
                        }
                        return `s3_key/${s3Key}`;
                      }
                      return 'Click to download or view the book PDF';
                    })()}
                  </span>
                </div>
              )}
            </div>

            {/* Chapters and Sections Section */}
            <div className="book-modal-chapters-section">
              <div className="chapters-sections-header">
                <h3>📚 Chapters & Sections</h3>
                {(() => {
                  const chapters = parseBookChapters(bookData) || [];
                  const sections = getBookSections(bookData) || [];
                  console.log('BookModal Debug:', {
                    bookData,
                    chapters,
                    sections,
                    bookDataChapters: bookData?.chapters,
                    bookDataChaptersType: typeof bookData?.chapters
                  });
                  
                  // Check if we have any chapters or sections to show expand/collapse
                  const hasChapters = chapters && chapters.length > 0;
                  const hasSections = sections && sections.length > 0;
                  
                  if (hasChapters || hasSections) {
                    return (
                      <div className="expand-toggle-header" onClick={() => {
                        const newState = !isAllExpanded;
                        setIsAllExpanded(newState);
                        // Update all chapters and sections to match the expand/collapse all state
                        const updatedChapters = {};
                        const updatedSections = {};
                        
                        // Update chapters and their nested sections
                        if (hasChapters) {
                          chapters.forEach((chapter, chapterIndex) => {
                            updatedChapters[chapterIndex] = newState;
                            const chapterSections = chapter.sections || [];
                            chapterSections.forEach((_, sectionIndex) => {
                              const sectionKey = `${chapterIndex}_${sectionIndex}`;
                              updatedSections[sectionKey] = newState;
                            });
                          });
                        }
                        
                        // Update standalone sections
                        if (hasSections) {
                          // Collect all sections from chapters to identify standalone sections
                          const allChapterSections = [];
                          if (hasChapters) {
                            chapters.forEach((chapter) => {
                              if (chapter.sections && Array.isArray(chapter.sections)) {
                                allChapterSections.push(...chapter.sections);
                              }
                            });
                          }
                          
                          sections.forEach((section, index) => {
                            // Check if this section is already in a chapter
                            const isInChapter = allChapterSections.some(chapSec => 
                              (chapSec.section_id && chapSec.section_id === section.section_id) ||
                              (chapSec.id && chapSec.id === section.id)
                            );
                            
                            if (!isInChapter) {
                              const sectionKey = `standalone_${index}`;
                              updatedSections[sectionKey] = newState;
                            }
                          });
                        }
                        
                        setExpandedChapters(updatedChapters);
                        setExpandedSections(updatedSections);
                      }}>
                        <button className="expand-toggle-button">
                          {isAllExpanded ? '▼' : '▶'}
                        </button>
                        <span className="expand-toggle-text">
                          {isAllExpanded ? 'Collapse All' : 'Expand All'}
                        </span>
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
              {(() => {
                const chapters = parseBookChapters(bookData) || [];
                const sections = getBookSections(bookData) || [];
                
                // Always show chapters first if they exist
                if (chapters && Array.isArray(chapters) && chapters.length > 0) {
                  return (
                    <>
                      <div className="chapters-list-modal">
                        {chapters.map((chapter, chapterIndex) => {
                          const chapterExpanded = expandedChapters[chapterIndex] !== undefined 
                            ? expandedChapters[chapterIndex] 
                            : true;
                          
                          // Get sections for this chapter from nested structure
                          let chapterSections = chapter.sections || [];
                          
                          // Also check if there are sections in the flat sections array that belong to this chapter
                          if (sections && sections.length > 0) {
                            const chapterId = chapter.chapter_id;
                            const chapterIndexMatch = chapter.chapter_index !== undefined ? chapter.chapter_index : chapterIndex;
                            
                            // Find sections that belong to this chapter
                            const matchingSections = sections.filter(section => {
                              // Check if section belongs to this chapter by chapter_id or chapter_index
                              const sectionChapterId = section.chapter_id;
                              const sectionChapterIndex = section.chapter_index;
                              
                              return (
                                (chapterId && sectionChapterId && sectionChapterId === chapterId) ||
                                (sectionChapterIndex !== undefined && sectionChapterIndex === chapterIndexMatch)
                              );
                            });
                            
                            // Merge sections from nested structure and flat array, avoiding duplicates
                            if (matchingSections.length > 0) {
                              const existingSectionIds = new Set(
                                chapterSections.map(s => s.section_id || s.id).filter(Boolean)
                              );
                              
                              matchingSections.forEach(section => {
                                const sectionId = section.section_id || section.id;
                                if (sectionId && !existingSectionIds.has(sectionId)) {
                                  chapterSections.push(section);
                                  existingSectionIds.add(sectionId);
                                } else if (!sectionId) {
                                  // If no ID, check by title/name to avoid duplicates
                                  const exists = chapterSections.some(cs => 
                                    (cs.title === section.title && cs.name === section.name) ||
                                    (cs.section_id === section.section_id && cs.id === section.id)
                                  );
                                  if (!exists) {
                                    chapterSections.push(section);
                                  }
                                }
                              });
                            }
                          }
                          
                          return (
                            <div key={chapter.chapter_id || chapterIndex} className="chapter-item-modal">
                              <div 
                                className="chapter-header-modal"
                                onClick={() => setExpandedChapters(prev => ({
                                  ...prev,
                                  [chapterIndex]: !prev[chapterIndex]
                                }))}
                              >
                                <button className="chapter-toggle-modal">
                                  {chapterExpanded ? '▼' : '▶'}
                                </button>
                                <span className="chapter-title-modal">
                                  📖 {chapter.title || chapter.name || `Chapter ${chapterIndex + 1}`}
                                </span>
                                <span className="chapter-sections-count-modal">
                                  {chapterSections.length > 0 
                                    ? `(${chapterSections.length} section${chapterSections.length !== 1 ? 's' : ''})`
                                    : '(No sections)'
                                  }
                                </span>
                              </div>
                              {chapterExpanded && (
                                <div className="chapter-content-wrapper">
                                  {/* Display chapter content if available */}
                                  {(chapter.text || chapter.description || chapter.content) && (
                                    <div className="chapter-content-modal">
                                      <div className="chapter-content-header">
                                        <h4 className="chapter-content-title">Chapter Content</h4>
                                      </div>
                                      <div className="chapter-text-modal">
                                        <p className="chapter-text-content">
                                          {chapter.text || chapter.description || chapter.content}
                                        </p>
                                      </div>
                                    </div>
                                  )}
                                  
                                  {/* Display sections under the chapter */}
                                  {chapterSections.length > 0 && (
                                    <div className="sections-list-modal">
                                      {chapterSections.map((section, sectionIndex) => {
                                        const sectionKey = `${chapterIndex}_${sectionIndex}`;
                                        const sectionExpanded = expandedSections[sectionKey] !== undefined 
                                          ? expandedSections[sectionKey] 
                                          : true;
                                        
                                        return (
                                          <div key={section.section_id || section.id || sectionIndex} className="section-item-modal">
                                            <div 
                                              className="section-header-modal"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setExpandedSections(prev => ({
                                                  ...prev,
                                                  [sectionKey]: !prev[sectionKey]
                                                }));
                                              }}
                                            >
                                              <button className="section-toggle-modal">
                                                {sectionExpanded ? '▼' : '▶'}
                                              </button>
                                              <span className="section-title-modal">
                                                📄 {section.title || section.name || `Section ${sectionIndex + 1}`}
                                              </span>
                                            </div>
                                            {sectionExpanded && (
                                              <div className="section-content-modal">
                                                {(section.text || section.description || section.content) ? (
                                                  <p className="section-text-modal">
                                                    {section.text || section.description || section.content}
                                                  </p>
                                                ) : (
                                                  <p className="section-text-modal" style={{ fontStyle: 'italic', opacity: 0.7 }}>
                                                    No content available for this section.
                                                  </p>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                  
                                  {/* Show message if no content and no sections */}
                                  {!chapter.text && !chapter.description && !chapter.content && chapterSections.length === 0 && (
                                    <div className="section-item-modal">
                                      <p style={{ color: 'rgba(255, 255, 255, 0.7)', fontStyle: 'italic', padding: '10px' }}>
                                        No content or sections available for this chapter.
                                      </p>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      
                      {/* Show standalone sections (sections not in any chapter) if they exist */}
                      {(() => {
                        // Collect all sections that are in chapters
                        const allChapterSections = [];
                        if (chapters && chapters.length > 0) {
                          chapters.forEach((chapter, chapterIndex) => {
                            // Get sections from nested structure
                            if (chapter.sections && Array.isArray(chapter.sections)) {
                              allChapterSections.push(...chapter.sections);
                            }
                            
                            // Also get sections from flat array that match this chapter
                            if (sections && sections.length > 0) {
                              const chapterId = chapter.chapter_id;
                              const chapterIndexMatch = chapter.chapter_index !== undefined ? chapter.chapter_index : chapterIndex;
                              
                              sections.forEach(section => {
                                const sectionChapterId = section.chapter_id;
                                const sectionChapterIndex = section.chapter_index;
                                
                                if (
                                  (chapterId && sectionChapterId && sectionChapterId === chapterId) ||
                                  (sectionChapterIndex !== undefined && sectionChapterIndex === chapterIndexMatch)
                                ) {
                                  allChapterSections.push(section);
                                }
                              });
                            }
                          });
                        }
                        
                        // Get standalone sections (sections not in any chapter)
                        const standaloneSections = sections ? sections.filter(section => {
                          // Check if this section is already in a chapter
                          return !allChapterSections.some(chapSec => 
                            (chapSec.section_id && chapSec.section_id === section.section_id) ||
                            (chapSec.id && chapSec.id === section.id) ||
                            (chapSec.title === section.title && chapSec.name === section.name)
                          );
                        }) : [];
                        
                        if (standaloneSections.length > 0) {
                          return (
                        <div className="standalone-sections-container">
                          <h4 className="standalone-sections-title">📄 Additional Sections</h4>
                          <div className="sections-list-modal">
                            {standaloneSections.map((section, index) => {
                              const sectionKey = `standalone_${index}`;
                              const sectionExpanded = expandedSections[sectionKey] !== undefined 
                                ? expandedSections[sectionKey] 
                                : true;
                              
                              return (
                                <div key={section.section_id || index} className="section-item-modal">
                                  <div 
                                    className="section-header-modal"
                                    onClick={() => setExpandedSections(prev => ({
                                      ...prev,
                                      [sectionKey]: !prev[sectionKey]
                                    }))}
                                  >
                                    <button className="section-toggle-modal">
                                      {sectionExpanded ? '▼' : '▶'}
                                    </button>
                                    <span className="section-title-modal">
                                      📄 {section.title || section.name || `Section ${index + 1}`}
                                    </span>
                                  </div>
                                  {sectionExpanded && (section.text || section.description || section.content) && (
                                    <div className="section-content-modal">
                                      <p className="section-text-modal">
                                        {section.text || section.description || section.content}
                                      </p>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                          );
                        }
                        return null;
                      })()}
                    </>
                  );
                } 
                // If we have sections but no chapters, show sections directly
                else if (sections && sections.length > 0) {
                  return (
                    <div className="sections-list-modal">
                      {sections.map((section, index) => {
                        const sectionKey = `standalone_${index}`;
                        const sectionExpanded = expandedSections[sectionKey] !== undefined 
                          ? expandedSections[sectionKey] 
                          : true;
                        
                        return (
                          <div key={section.section_id || index} className="section-item-modal">
                            <div 
                              className="section-header-modal"
                              onClick={() => setExpandedSections(prev => ({
                                ...prev,
                                [sectionKey]: !prev[sectionKey]
                              }))}
                            >
                              <button className="section-toggle-modal">
                                {sectionExpanded ? '▼' : '▶'}
                              </button>
                              <span className="section-title-modal">
                                📄 {section.title || section.name || `Section ${index + 1}`}
                              </span>
                            </div>
                            {sectionExpanded && (section.text || section.description || section.content) && (
                              <div className="section-content-modal">
                                <p className="section-text-modal">
                                  {section.text || section.description || section.content}
                                </p>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                } 
                // No chapters or sections
                else {
                  return (
                    <p className="no-chapters">No chapters or sections available for this book.</p>
                  );
                }
              })()}
            </div>
          </div>

          {/* Objectives Sidebar */}
          <div className="book-modal-sidebar">
            <div className="book-modal-objectives-section">
              <h3>📋 Learning Objectives</h3>
              {objectives.length > 0 ? (
                <div className="objectives-list-modal">
                  {objectives.map((objective, index) => (
                    <div key={objective.id || index} className="objective-item-modal">
                      <span className="objective-number-modal">{index + 1}.</span>
                      <span className="objective-text-modal">{objective.text}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="no-objectives">No objectives available for this book.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default BookModal;

