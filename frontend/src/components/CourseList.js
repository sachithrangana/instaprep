import React, { useState, useEffect } from 'react';
import './CourseList.css';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

function CourseList({ courses, onCourseClick, onArchive, onUnarchive, isArchived = false, user, authToken }) {
  const [expandedCards, setExpandedCards] = useState({});
  const [coursePredictions, setCoursePredictions] = useState({});
  const [loadingPredictions, setLoadingPredictions] = useState(false);
  const [enrollments, setEnrollments] = useState({}); // { courseId: { enrolled: true/false, enrollment: {...} } }
  const [enrolling, setEnrolling] = useState({}); // Track which courses are being enrolled/unenrolled

  // Define loadCoursePredictions before useEffect (hooks must be called in order)
  const loadCoursePredictions = async () => {
    if (!user?.id) return;

    setLoadingPredictions(true);
    try {
      const headers = {
        'Content-Type': 'application/json',
      };

      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const response = await fetch(`${API_BASE}/ml/student-performance-courses/${user.id}`, {
        method: 'GET',
        headers: headers,
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.predictions) {
          // Create a map of course_id -> prediction
          const predictionsMap = {};
          data.predictions.forEach(pred => {
            predictionsMap[pred.course_id] = pred;
          });
          setCoursePredictions(predictionsMap);
        }
      }
    } catch (err) {
      console.error('Error loading course predictions:', err);
    } finally {
      setLoadingPredictions(false);
    }
  };

  // Load enrollment status for all courses
  const loadEnrollments = async () => {
    if (!user?.id || isArchived) return;

    try {
      const headers = {
        'Content-Type': 'application/json',
      };

      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      // Check enrollment status for each course
      const enrollmentPromises = courses.map(async (course) => {
        try {
          const response = await fetch(`${API_BASE}/enrollments/${user.id}/${course.id}`, {
            method: 'GET',
            headers: headers,
          });

          if (response.ok) {
            const data = await response.json();
            return {
              courseId: course.id,
              enrolled: data.enrolled || false,
              enrollment: data.enrollment || null
            };
          }
        } catch (err) {
          console.error(`Error checking enrollment for course ${course.id}:`, err);
        }
        return { courseId: course.id, enrolled: false, enrollment: null };
      });

      const enrollmentResults = await Promise.all(enrollmentPromises);
      const enrollmentMap = {};
      enrollmentResults.forEach(result => {
        enrollmentMap[result.courseId] = {
          enrolled: result.enrolled,
          enrollment: result.enrollment
        };
      });
      setEnrollments(enrollmentMap);
    } catch (err) {
      console.error('Error loading enrollments:', err);
    }
  };

  // Load course predictions - MUST be before any early returns
  useEffect(() => {
    if (user && user.id && !isArchived) {
      loadCoursePredictions();
      loadEnrollments();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, courses]);

  const getScoreColor = (score) => {
    if (score >= 80) return '#48bb78'; // Green
    if (score >= 60) return '#ed8936'; // Orange
    return '#f56565'; // Red
  };

  // Early return AFTER all hooks
  if (courses.length === 0) {
    return (
      <div className="no-courses">
        <p>No {isArchived ? 'archived' : ''} courses found.</p>
      </div>
    );
  }

  const handleArchiveClick = (e, courseId) => {
    e.stopPropagation();
    if (onArchive) {
      onArchive(courseId, e);
    }
  };

  const handleUnarchiveClick = (e, courseId) => {
    e.stopPropagation();
    if (onUnarchive) {
      onUnarchive(courseId, e);
    }
  };

  const toggleCardExpanded = (courseId, e) => {
    e.stopPropagation();
    setExpandedCards(prev => ({
      ...prev,
      [courseId]: !prev[courseId]
    }));
  };

  const handleEnroll = async (e, courseId) => {
    e.stopPropagation();
    if (!user?.id) return;

    setEnrolling(prev => ({ ...prev, [courseId]: true }));

    try {
      const headers = {
        'Content-Type': 'application/json',
      };

      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const response = await fetch(`${API_BASE}/enrollments`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          user_id: user.id,
          course_id: courseId
        })
      });

      if (response.ok) {
        const data = await response.json();
        setEnrollments(prev => ({
          ...prev,
          [courseId]: {
            enrolled: true,
            enrollment: data.enrollment
          }
        }));
      } else {
        const errorData = await response.json();
        alert(errorData.error || 'Failed to enroll in course');
      }
    } catch (err) {
      console.error('Error enrolling in course:', err);
      alert('Failed to enroll in course');
    } finally {
      setEnrolling(prev => ({ ...prev, [courseId]: false }));
    }
  };

  const handleUnenroll = async (e, courseId) => {
    e.stopPropagation();
    if (!user?.id) return;

    if (!window.confirm('Are you sure you want to unenroll from this course?')) {
      return;
    }

    setEnrolling(prev => ({ ...prev, [courseId]: true }));

    try {
      const headers = {
        'Content-Type': 'application/json',
      };

      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const response = await fetch(`${API_BASE}/enrollments/${user.id}/${courseId}`, {
        method: 'DELETE',
        headers: headers,
      });

      if (response.ok) {
        setEnrollments(prev => ({
          ...prev,
          [courseId]: {
            enrolled: false,
            enrollment: null
          }
        }));
      } else {
        const errorData = await response.json();
        alert(errorData.error || 'Failed to unenroll from course');
      }
    } catch (err) {
      console.error('Error unenrolling from course:', err);
      alert('Failed to unenroll from course');
    } finally {
      setEnrolling(prev => ({ ...prev, [courseId]: false }));
    }
  };

  // Helper to get selected chapters for a book
  const getSelectedChaptersForBook = (course, bookId) => {
    if (!course.selected_chapters) return [];
    
    if (Array.isArray(course.selected_chapters)) {
      return course.selected_chapters.filter(ch => ch.book_id === bookId);
    } else if (typeof course.selected_chapters === 'object') {
      const chapterIndices = course.selected_chapters[bookId] || [];
      return chapterIndices.map(idx => ({ chapter_index: idx }));
    }
    return [];
  };

  // Helper to get selected sections for a chapter
  const getSelectedSectionsForChapter = (course, bookId, chapterId) => {
    if (!course.selected_sections) return [];
    
    if (Array.isArray(course.selected_sections)) {
      return course.selected_sections.filter(s => 
        s.book_id === bookId && s.chapter_id === chapterId
      );
    } else if (typeof course.selected_sections === 'object') {
      const chapterIndex = typeof chapterId === 'number' ? chapterId : parseInt(chapterId.toString().split('_').pop());
      const sectionIndices = course.selected_sections[bookId]?.[chapterIndex] || [];
      return sectionIndices.map(idx => ({ section_index: idx }));
    }
    return [];
  };

  return (
    <div className="courses-grid">
      {courses.map((course) => (
        <div
          key={course.id}
          className="course-card"
          onClick={() => onCourseClick(course.id)}
        >
          <div className="course-header">
            <h3>{course.title}</h3>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              {coursePredictions[course.id] && (
                <div 
                  className="course-prediction-badge"
                  style={{ 
                    backgroundColor: getScoreColor(coursePredictions[course.id].predicted_score),
                    color: 'white',
                    padding: '4px 10px',
                    borderRadius: '12px',
                    fontSize: '0.85em',
                    fontWeight: '700',
                    minWidth: '50px',
                    textAlign: 'center'
                  }}
                  title={`Predicted score: ${coursePredictions[course.id].predicted_score}%`}
                >
                  📊 {coursePredictions[course.id].predicted_score}%
                </div>
              )}
              {!isArchived && user && enrollments[course.id]?.enrolled && (
                <div 
                  className="enrollment-badge"
                  style={{ 
                    backgroundColor: '#48bb78',
                    color: 'white',
                    padding: '4px 10px',
                    borderRadius: '12px',
                    fontSize: '0.85em',
                    fontWeight: '600'
                  }}
                  title="Enrolled"
                >
                  ✓ Enrolled
                </div>
              )}
              <div className="course-badge">
                {course.involvedBooksCount !== undefined && course.involvedBooksCount !== null 
                  ? course.involvedBooksCount 
                  : (course.books ? course.books.length : 0)} books
              </div>
              {!isArchived && user && (
                enrollments[course.id]?.enrolled ? (
                  <button
                    className="enroll-btn unenroll-btn"
                    onClick={(e) => handleUnenroll(e, course.id)}
                    disabled={enrolling[course.id]}
                    title="Unenroll from course"
                    style={{ 
                      backgroundColor: '#f56565',
                      color: 'white',
                      border: 'none',
                      padding: '6px 12px',
                      borderRadius: '6px',
                      cursor: enrolling[course.id] ? 'not-allowed' : 'pointer',
                      fontSize: '0.85em',
                      fontWeight: '600',
                      opacity: enrolling[course.id] ? 0.6 : 1
                    }}
                  >
                    {enrolling[course.id] ? '...' : 'Unenroll'}
                  </button>
                ) : (
                  <button
                    className="enroll-btn"
                    onClick={(e) => handleEnroll(e, course.id)}
                    disabled={enrolling[course.id]}
                    title="Enroll in course"
                    style={{ 
                      backgroundColor: '#4299e1',
                      color: 'white',
                      border: 'none',
                      padding: '6px 12px',
                      borderRadius: '6px',
                      cursor: enrolling[course.id] ? 'not-allowed' : 'pointer',
                      fontSize: '0.85em',
                      fontWeight: '600',
                      opacity: enrolling[course.id] ? 0.6 : 1
                    }}
                  >
                    {enrolling[course.id] ? '...' : 'Enroll'}
                  </button>
                )
              )}
              {isArchived ? (
                <button
                  className="archive-btn unarchive-btn"
                  onClick={(e) => handleUnarchiveClick(e, course.id)}
                  title="Unarchive course"
                >
                  📤
                </button>
              ) : (
                <button
                  className="archive-btn"
                  onClick={(e) => handleArchiveClick(e, course.id)}
                  title="Archive course"
                >
                  📦
                </button>
              )}
            </div>
          </div>
          <p className="course-description">{course.description}</p>
          <div className="course-stats">
            <span className="stat-item">
              <strong>{(() => {
                // Priority: selectedChaptersCount (required chapters) > totalChapters > calculate from arrays
                if (course.selectedChaptersCount !== undefined && course.selectedChaptersCount !== null) {
                  return course.selectedChaptersCount;
                }
                if (course.totalChapters !== undefined && course.totalChapters !== null) {
                  return course.totalChapters;
                }
                // Calculate from selected_chapters array if available
                if (course.selected_chapters) {
                  if (Array.isArray(course.selected_chapters)) {
                    const uniqueChapters = new Set();
                    course.selected_chapters.forEach(ch => {
                      if (ch && ch.book_id && ch.chapter_id) {
                        const key = `${ch.book_id}_${ch.chapter_id}`;
                        uniqueChapters.add(key);
                      }
                    });
                    return uniqueChapters.size;
                  } else if (typeof course.selected_chapters === 'object') {
                    let count = 0;
                    Object.values(course.selected_chapters).forEach(chapterIndices => {
                      if (Array.isArray(chapterIndices)) {
                        count += chapterIndices.length;
                      }
                    });
                    return count;
                  }
                }
                return 0;
              })()}</strong> chapters
            </span>
            <span className="stat-item">
              <strong>{(() => {
                // Priority: selectedSectionsCount (required sections) > totalSections > calculate from arrays
                if (course.selectedSectionsCount !== undefined && course.selectedSectionsCount !== null) {
                  return course.selectedSectionsCount;
                }
                if (course.totalSections !== undefined && course.totalSections !== null) {
                  return course.totalSections;
                }
                // Calculate from selected_sections array if available
                if (course.selected_sections) {
                  if (Array.isArray(course.selected_sections)) {
                    return course.selected_sections.length;
                  } else if (typeof course.selected_sections === 'object') {
                    let count = 0;
                    Object.values(course.selected_sections).forEach(chapterSections => {
                      if (typeof chapterSections === 'object') {
                        Object.values(chapterSections).forEach(sectionIndices => {
                          if (Array.isArray(sectionIndices)) {
                            count += sectionIndices.length;
                          }
                        });
                      }
                    });
                    return count;
                  }
                }
                return 0;
              })()}</strong> sections
            </span>
          </div>
          
          {/* Show selected chapters and sections - check if we have any selected content */}
          {(() => {
            // Check if we have selected chapters
            const hasSelectedChapters = course.selected_chapters && (
              (Array.isArray(course.selected_chapters) && course.selected_chapters.length > 0) ||
              (typeof course.selected_chapters === 'object' && course.selected_chapters !== null && Object.keys(course.selected_chapters).length > 0)
            );
            // Check if we have selected sections
            const hasSelectedSections = course.selected_sections && (
              (Array.isArray(course.selected_sections) && course.selected_sections.length > 0) ||
              (typeof course.selected_sections === 'object' && course.selected_sections !== null && Object.keys(course.selected_sections).length > 0)
            );
            // Also check if we have counts that indicate selections
            const hasCounts = (course.selectedChaptersCount && course.selectedChaptersCount > 0) || 
                              (course.selectedSectionsCount && course.selectedSectionsCount > 0);
            return (hasSelectedChapters || hasSelectedSections || hasCounts) && course.books && course.books.length > 0;
          })() && (
            <div className="course-selections">
              <button 
                className="course-selections-toggle"
                onClick={(e) => toggleCardExpanded(course.id, e)}
              >
                <span>{expandedCards[course.id] ? '▼' : '▶'}</span>
                <span>Selected Chapters & Sections</span>
              </button>
              {expandedCards[course.id] && course.books && course.books.length > 0 && (
                <div className="course-selections-content">
                  {course.books.map((book) => {
                    const bookId = book.book_id || book.id;
                    const selectedChapters = getSelectedChaptersForBook(course, bookId);
                    // Only show books that have selected chapters/sections
                    if (!selectedChapters || selectedChapters.length === 0) return null;
                    
                    return (
                      <div key={bookId} className="course-card-book">
                        <div className="course-card-book-title">{book.title}</div>
                        <div className="course-card-chapters">
                          {/* Only show chapters that are in selected_chapters array */}
                          {selectedChapters.map((selectedChapter, idx) => {
                            const chapterId = selectedChapter.chapter_id;
                            const chapterIndex = selectedChapter.chapter_index;
                            // Only get sections that are in selected_sections array
                            const selectedSections = getSelectedSectionsForChapter(course, bookId, chapterId || chapterIndex);
                            
                            // Try to get chapter title from book data
                            let chapterTitle = `Chapter ${chapterIndex !== undefined ? chapterIndex + 1 : idx + 1}`;
                            
                            // Parse chapters if they're stored as JSON string
                            let chaptersList = book.chapters;
                            if (chaptersList) {
                              try {
                                if (typeof chaptersList === 'string') {
                                  const parsed = JSON.parse(chaptersList);
                                  chaptersList = parsed.chapters || parsed;
                                }
                                if (Array.isArray(chaptersList)) {
                                  const chapter = chapterId 
                                    ? chaptersList.find(ch => ch.chapter_id === chapterId)
                                    : (chapterIndex !== undefined ? chaptersList[chapterIndex] : null);
                                  if (chapter) {
                                    chapterTitle = chapter.title || chapter.name || chapterTitle;
                                  }
                                }
                              } catch (e) {
                                // If parsing fails, use default title
                              }
                            }
                            
                            return (
                              <div key={chapterId || chapterIndex || idx} className="course-card-chapter">
                                <span className="course-card-chapter-title">• {chapterTitle}</span>
                                {/* Only show section count if there are selected sections */}
                                {selectedSections.length > 0 && (
                                  <span className="course-card-sections-count">
                                    ({selectedSections.length} section{selectedSections.length !== 1 ? 's' : ''})
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default CourseList;
