import React, { useState, useEffect, useMemo } from 'react';
import './PerformanceDashboard.css';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

// Component for editing recommendations
function RecommendationEditForm({ item, category, onSave, onCancel }) {
  const [title, setTitle] = useState(item.title || '');
  const [url, setUrl] = useState(item.url || '');
  const [meta, setMeta] = useState(item.duration || item.readTime || item.format || '');

  const handleSubmit = (e) => {
    e.preventDefault();
    const updatedData = {
      title,
      url,
      ...(category === 'videos' && { duration: meta }),
      ...(category === 'blogs' && { readTime: meta }),
      ...(category === 'courseMaterials' && { format: meta })
    };
    onSave(updatedData);
  };

  return (
    <form className="recommendation-edit-form" onSubmit={handleSubmit}>
      <input
        type="text"
        className="recommendation-edit-input"
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
      />
      <input
        type="url"
        className="recommendation-edit-input"
        placeholder="URL"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        required
      />
      <input
        type="text"
        className="recommendation-edit-input"
        placeholder={category === 'videos' ? 'Duration (e.g., 15:30)' : category === 'blogs' ? 'Read time (e.g., 5 min)' : 'Format (e.g., PDF)'}
        value={meta}
        onChange={(e) => setMeta(e.target.value)}
      />
      <div className="recommendation-edit-actions">
        <button type="submit" className="recommendation-save-btn">💾 Save</button>
        <button type="button" onClick={onCancel} className="recommendation-cancel-btn">❌ Cancel</button>
      </div>
    </form>
  );
}

function PerformanceDashboard({ user, authToken, onViewAttemptDetails }) {
  const [prediction, setPrediction] = useState(null);
  const [coursePredictions, setCoursePredictions] = useState([]);
  const [modelInfo, setModelInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [error, setError] = useState(null);
  const [expandedCourseCards, setExpandedCourseCards] = useState({});
  const [courseSearchQuery, setCourseSearchQuery] = useState('');
  const [studentSearchQuery, setStudentSearchQuery] = useState('');
  const [selectedCourseForChart, setSelectedCourseForChart] = useState(null); // Selected course ID for chart display
  const [selectedStudentForChart, setSelectedStudentForChart] = useState(null); // Selected student ID for chart display
  const [boostedCourses, setBoostedCourses] = useState(new Set());
  const [boostedStudents, setBoostedStudents] = useState(new Set());
  const [courseRecommendations, setCourseRecommendations] = useState({});
  const [studentRecommendations, setStudentRecommendations] = useState({});
  const [editingRecommendation, setEditingRecommendation] = useState(null); // { type: 'course'|'student', id: courseId/studentId, category: 'videos'|'blogs'|'courseMaterials', itemId: itemId }
  const [addingRecommendation, setAddingRecommendation] = useState(null); // { type: 'course'|'student', id: courseId/studentId, category: 'videos'|'blogs'|'courseMaterials' }
  const [expandedMetrics, setExpandedMetrics] = useState({}); // { 'course-{id}': true/false, 'student-{id}': true/false }
  const [coursesData, setCoursesData] = useState({}); // { courseId: { books, selected_chapters, selected_sections } }
  const [assessmentsData, setAssessmentsData] = useState([]); // Array of all assessments
  const [recommendationsModal, setRecommendationsModal] = useState(null); // { type: 'course'|'student', id: courseId/studentId, title: string }

  useEffect(() => {
    if (user && user.id) {
      fetchPrediction();
      fetchCoursePredictions();
      fetchModelInfo();
      fetchAssessments();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const fetchPrediction = async () => {
    if (!user?.id) return;

    setLoading(true);
    setError(null);

    try {
      const headers = {
        'Content-Type': 'application/json',
      };

      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const response = await fetch(`${API_BASE}/ml/student-performance/${user.id}`, {
        method: 'GET',
        headers: headers,
      });

      if (response.status === 503 || response.status === 404) {
        // Model not trained yet or no data
        const data = await response.json();
        setError(data.error || 'Model not available');
        setPrediction(null);
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to fetch prediction');
      }

      const data = await response.json();
      if (data.success && data.prediction) {
        setPrediction(data.prediction);
      }
    } catch (err) {
      console.error('Error fetching prediction:', err);
      setError('Failed to load prediction');
    } finally {
      setLoading(false);
    }
  };

  const fetchCoursePredictions = async () => {
    if (!user?.id) return;

    setLoadingCourses(true);
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
          setCoursePredictions(data.predictions);
          // Fetch course data for each course to calculate book coverage
          fetchCoursesData(data.predictions);
        }
      }
    } catch (err) {
      console.error('Error fetching course predictions:', err);
    } finally {
      setLoadingCourses(false);
    }
  };

  const fetchCoursesData = async (predictions) => {
    const coursesMap = {};
    const courseIds = [...new Set(predictions.map(p => p.course_id))];
    
    try {
      const headers = {
        'Content-Type': 'application/json',
      };

      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      // Fetch all courses
      const response = await fetch(`${API_BASE}/courses`, {
        method: 'GET',
        headers: headers,
      });

      if (response.ok) {
        const allCourses = await response.json();
        // Filter courses that are in our predictions
        allCourses.forEach(course => {
          if (courseIds.includes(course.id)) {
            coursesMap[course.id] = course;
          }
        });
        setCoursesData(coursesMap);
      }
    } catch (err) {
      console.error('Error fetching courses data:', err);
    }
  };

  const fetchAssessments = async () => {
    try {
      const headers = {
        'Content-Type': 'application/json',
      };

      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const response = await fetch(`${API_BASE}/assessments`, {
        method: 'GET',
        headers: headers,
      });

      if (response.ok) {
        const assessments = await response.json();
        setAssessmentsData(Array.isArray(assessments) ? assessments : []);
      }
    } catch (err) {
      console.error('Error fetching assessments:', err);
    }
  };

  // Calculate book overall coverage for a course (works on chapters and sections for each book)
  const calculateBookCoverage = (courseId, coursePrediction = null) => {
    const course = coursesData[courseId];
    if (!course) {
      // If no course data, estimate based on attempts
      if (coursePrediction && coursePrediction.attempts && coursePrediction.attempts.length > 0) {
        const estimatedCoverage = Math.min(100, coursePrediction.attempts.length * 15);
        return {
          coverage: estimatedCoverage,
          totalChapters: 0,
          coveredChapters: 0,
          totalSections: 0,
          coveredSections: 0,
          totalBooks: 0,
          bookDetails: []
        };
      }
      return { 
        coverage: 0, 
        totalChapters: 0, 
        coveredChapters: 0,
        totalSections: 0, 
        coveredSections: 0, 
        totalBooks: 0,
        bookDetails: []
      };
    }

    // Get selected sections and chapters from course
    const selectedSections = course.selected_sections || [];
    const selectedChapters = course.selected_chapters || [];
    const books = course.books || [];

    // Track all chapters and sections per book
    const chapterIds = new Set();
    const sectionIds = new Set();
    const chapterToSectionsMap = {}; // Map chapter_id to its sections
    const bookToChaptersMap = {}; // Map book_id to its chapters
    const bookToSectionsMap = {}; // Map book_id to its sections

    // Process each book in the course
    books.forEach(book => {
      const bookId = book.id || book.book_id;
      if (!bookId) return;

      bookToChaptersMap[bookId] = new Set();
      bookToSectionsMap[bookId] = new Set();

      // Parse chapters from book
      let bookChapters = [];
      if (book.chapters && Array.isArray(book.chapters)) {
        bookChapters = book.chapters;
      } else if (typeof book.chapters === 'string') {
        try {
          bookChapters = JSON.parse(book.chapters);
        } catch (e) {
          bookChapters = [];
        }
      }

      // Process selected chapters for this book
      const bookSelectedChapters = Array.isArray(selectedChapters) 
        ? selectedChapters.filter(ch => (ch.book_id || ch.bookId) === bookId)
        : [];

      bookSelectedChapters.forEach(chapter => {
        const chapterId = chapter.chapter_id || chapter.chapter_index;
        const chapterKey = `${bookId}_${chapterId}`;
        
        if (!chapterIds.has(chapterKey)) {
          chapterIds.add(chapterKey);
          chapterToSectionsMap[chapterKey] = new Set();
          bookToChaptersMap[bookId].add(chapterKey);
        }
        
        // Find the chapter in book chapters
        const chapterData = bookChapters.find((ch, idx) => 
          (ch.chapter_id === chapterId) || 
          (ch.id === chapterId) || 
          (chapterId !== undefined && idx === chapterId)
        );

        if (chapterData && chapterData.sections) {
          const chapterSections = Array.isArray(chapterData.sections) 
            ? chapterData.sections 
            : [];
          chapterSections.forEach(section => {
            const sectionId = section.section_id || section.id;
            if (sectionId) {
              sectionIds.add(sectionId);
              chapterToSectionsMap[chapterKey].add(sectionId);
              bookToSectionsMap[bookId].add(sectionId);
            }
          });
        }
      });

      // Process selected sections for this book (standalone sections not in chapters)
      const bookSelectedSections = Array.isArray(selectedSections)
        ? selectedSections.filter(s => (s.book_id || s.bookId) === bookId)
        : [];

      bookSelectedSections.forEach(section => {
        const sectionId = section.section_id || section.id;
        if (sectionId && !sectionIds.has(sectionId)) {
          sectionIds.add(sectionId);
          bookToSectionsMap[bookId].add(sectionId);
        }
      });
    });

    const totalChapters = chapterIds.size;
    const totalSections = sectionIds.size;

    // Find assessments for this course
    const courseAssessments = assessmentsData.filter(assessment => {
      // Check if assessment is for this course
      if (assessment.sourceType === 'course' && assessment.sourceId === courseId) {
        return true;
      }
      // Check if assessment has selectedSections that match course sections
      if (assessment.selectedSections && Array.isArray(assessment.selectedSections)) {
        return assessment.selectedSections.some(section => {
          const sectionId = section.section_id || section.id;
          return sectionId && sectionIds.has(sectionId);
        });
      }
      // Check if assessment source is a book in this course
      if (assessment.sourceType === 'book' && assessment.sourceId) {
        return books.some(b => (b.id || b.book_id) === assessment.sourceId);
      }
      return false;
    });

    // Track covered chapters and sections
    const coveredChapterIds = new Set();
    const coveredSectionIds = new Set();

    // Process each assessment to determine coverage
    courseAssessments.forEach(assessment => {
      if (assessment.selectedSections && Array.isArray(assessment.selectedSections) && assessment.selectedSections.length > 0) {
        // Assessment has specific sections selected
        assessment.selectedSections.forEach(section => {
          const sectionId = section.section_id || section.id;
          if (sectionId && sectionIds.has(sectionId)) {
            coveredSectionIds.add(sectionId);
            
            // Find which chapter this section belongs to
            Object.keys(chapterToSectionsMap).forEach(chapterKey => {
              if (chapterToSectionsMap[chapterKey].has(sectionId)) {
                coveredChapterIds.add(chapterKey);
              }
            });
          }
        });
      } else if (assessment.sourceType === 'course' && assessment.sourceId === courseId) {
        // If assessment is for entire course, mark all chapters and sections as covered
        chapterIds.forEach(chapterKey => coveredChapterIds.add(chapterKey));
        sectionIds.forEach(sectionId => coveredSectionIds.add(sectionId));
      } else if (assessment.sourceType === 'book' && assessment.sourceId) {
        // If assessment is for entire book, mark all chapters and sections of that book as covered
        const bookId = assessment.sourceId;
        if (bookToChaptersMap[bookId]) {
          bookToChaptersMap[bookId].forEach(chapterKey => coveredChapterIds.add(chapterKey));
        }
        if (bookToSectionsMap[bookId]) {
          bookToSectionsMap[bookId].forEach(sectionId => coveredSectionIds.add(sectionId));
        }
      }
    });

    const coveredChapters = coveredChapterIds.size;
    const coveredSections = coveredSectionIds.size;

    // Calculate overall coverage (weighted: 40% chapters, 60% sections)
    let overallCoverage = 0;
    if (totalChapters > 0 && totalSections > 0) {
      const chapterCoverage = (coveredChapters / totalChapters) * 100;
      const sectionCoverage = (coveredSections / totalSections) * 100;
      overallCoverage = (chapterCoverage * 0.4) + (sectionCoverage * 0.6);
    } else if (totalChapters > 0) {
      overallCoverage = (coveredChapters / totalChapters) * 100;
    } else if (totalSections > 0) {
      overallCoverage = (coveredSections / totalSections) * 100;
    } else if (coursePrediction && coursePrediction.attempts && coursePrediction.attempts.length > 0) {
      // Fallback: estimate based on attempts
      overallCoverage = Math.min(100, coursePrediction.attempts.length * 15);
    }

    // Calculate uncovered chapters and sections
    const uncoveredChapterIds = Array.from(chapterIds).filter(ch => !coveredChapterIds.has(ch));
    const uncoveredSectionIds = Array.from(sectionIds).filter(s => !coveredSectionIds.has(s));

    // Track objectives from books and sections
    const allObjectives = new Set();
    const coveredObjectiveIds = new Set();
    const objectiveToSectionMap = {}; // Map objective_id to section_id
    const objectiveToChapterMap = {}; // Map objective_id to chapter_id

    // Collect objectives from books
    books.forEach(book => {
      const bookId = book.id || book.book_id;
      if (!bookId) return;

      // Get objectives from book
      if (book.objectives && Array.isArray(book.objectives)) {
        book.objectives.forEach(obj => {
          const objId = obj.id || obj.objective_id;
          if (objId) {
            allObjectives.add(objId);
          }
        });
      }

      // Parse chapters from book to get objectives from chapters and sections
      let bookChapters = [];
      if (book.chapters && Array.isArray(book.chapters)) {
        bookChapters = book.chapters;
      } else if (typeof book.chapters === 'string') {
        try {
          bookChapters = JSON.parse(book.chapters);
        } catch (e) {
          bookChapters = [];
        }
      }

      // Get objectives from chapters and sections
      bookChapters.forEach((chapter, chapterIdx) => {
        const chapterId = chapter.chapter_id || chapter.id || chapterIdx;
        const chapterKey = `${bookId}_${chapterId}`;
        
        // Objectives from chapter
        if (chapter.objectives && Array.isArray(chapter.objectives)) {
          chapter.objectives.forEach(obj => {
            const objId = obj.id || obj.objective_id;
            if (objId) {
              allObjectives.add(objId);
              objectiveToChapterMap[objId] = chapterKey;
            }
          });
        }

        // Objectives from sections
        if (chapter.sections && Array.isArray(chapter.sections)) {
          chapter.sections.forEach(section => {
            const sectionId = section.section_id || section.id;
            if (sectionId && sectionIds.has(sectionId)) {
              if (section.objectives && Array.isArray(section.objectives)) {
                section.objectives.forEach(obj => {
                  const objId = obj.id || obj.objective_id;
                  if (objId) {
                    allObjectives.add(objId);
                    objectiveToSectionMap[objId] = sectionId;
                    objectiveToChapterMap[objId] = chapterKey;
                  }
                });
              }
            }
          });
        }
      });
    });

    // Mark objectives as covered if their section/chapter is covered
    allObjectives.forEach(objId => {
      const sectionId = objectiveToSectionMap[objId];
      const chapterKey = objectiveToChapterMap[objId];
      
      if (sectionId && coveredSectionIds.has(sectionId)) {
        coveredObjectiveIds.add(objId);
      } else if (chapterKey && coveredChapterIds.has(chapterKey)) {
        coveredObjectiveIds.add(objId);
      }
    });

    const uncoveredObjectiveIds = Array.from(allObjectives).filter(objId => !coveredObjectiveIds.has(objId));

    // Get detailed information about uncovered items
    const uncoveredChapters = [];
    const uncoveredSections = [];
    const uncoveredObjectives = [];

    // Get uncovered chapters details
    uncoveredChapterIds.forEach(chapterKey => {
      const [bookId, chapterId] = chapterKey.split('_');
      const book = books.find(b => (b.id || b.book_id) === bookId);
      if (book) {
        let bookChapters = [];
        if (book.chapters && Array.isArray(book.chapters)) {
          bookChapters = book.chapters;
        } else if (typeof book.chapters === 'string') {
          try {
            bookChapters = JSON.parse(book.chapters);
          } catch (e) {
            bookChapters = [];
          }
        }

        const chapterData = bookChapters.find((ch, idx) => 
          (ch.chapter_id === chapterId) || 
          (ch.id === chapterId) || 
          (chapterId !== undefined && idx === parseInt(chapterId))
        );

        if (chapterData) {
          uncoveredChapters.push({
            bookId,
            bookTitle: book.title || 'Unknown Book',
            chapterId,
            chapterTitle: chapterData.title || chapterData.name || `Chapter ${chapterId}`,
            chapterKey
          });
        }
      }
    });

    // Get uncovered sections details
    uncoveredSectionIds.forEach(sectionId => {
      // Find which book and chapter this section belongs to
      let found = false;
      books.forEach(book => {
        const bookId = book.id || book.book_id;
        if (!bookId) return;

        let bookChapters = [];
        if (book.chapters && Array.isArray(book.chapters)) {
          bookChapters = book.chapters;
        } else if (typeof book.chapters === 'string') {
          try {
            bookChapters = JSON.parse(book.chapters);
          } catch (e) {
            bookChapters = [];
          }
        }

        bookChapters.forEach((chapter, chapterIdx) => {
          const chapterId = chapter.chapter_id || chapter.id || chapterIdx;
          const chapterKey = `${bookId}_${chapterId}`;
          
          if (chapter.sections && Array.isArray(chapter.sections)) {
            const sectionData = chapter.sections.find(s => 
              (s.section_id || s.id) === sectionId
            );
            
            if (sectionData && !found) {
              uncoveredSections.push({
                bookId,
                bookTitle: book.title || 'Unknown Book',
                chapterId,
                chapterTitle: chapter.title || chapter.name || `Chapter ${chapterId}`,
                sectionId,
                sectionTitle: sectionData.title || sectionData.name || `Section ${sectionId}`,
                chapterKey
              });
              found = true;
            }
          }
        });

        // Check standalone sections
        if (book.sections && Array.isArray(book.sections)) {
          const sectionData = book.sections.find(s => 
            (s.section_id || s.id) === sectionId
          );
          
          if (sectionData && !found) {
            uncoveredSections.push({
              bookId,
              bookTitle: book.title || 'Unknown Book',
              chapterId: null,
              chapterTitle: null,
              sectionId,
              sectionTitle: sectionData.title || sectionData.name || `Section ${sectionId}`,
              chapterKey: null
            });
            found = true;
          }
        }
      });
    });

    // Get uncovered objectives details
    uncoveredObjectiveIds.forEach(objId => {
      const sectionId = objectiveToSectionMap[objId];
      const chapterKey = objectiveToChapterMap[objId];
      
      // Find objective text from books
      let objectiveText = '';
      books.forEach(book => {
        if (book.objectives && Array.isArray(book.objectives)) {
          const obj = book.objectives.find(o => (o.id || o.objective_id) === objId);
          if (obj) {
            objectiveText = obj.text || obj.description || obj.title || '';
          }
        }

        if (!objectiveText) {
          let bookChapters = [];
          if (book.chapters && Array.isArray(book.chapters)) {
            bookChapters = book.chapters;
          } else if (typeof book.chapters === 'string') {
            try {
              bookChapters = JSON.parse(book.chapters);
            } catch (e) {
              bookChapters = [];
            }
          }

          bookChapters.forEach(chapter => {
            if (chapter.objectives && Array.isArray(chapter.objectives)) {
              const obj = chapter.objectives.find(o => (o.id || o.objective_id) === objId);
              if (obj) {
                objectiveText = obj.text || obj.description || obj.title || '';
              }
            }

            if (chapter.sections && Array.isArray(chapter.sections)) {
              chapter.sections.forEach(section => {
                if (section.objectives && Array.isArray(section.objectives)) {
                  const obj = section.objectives.find(o => (o.id || o.objective_id) === objId);
                  if (obj) {
                    objectiveText = obj.text || obj.description || obj.title || '';
                  }
                }
              });
            }
          });
        }
      });

      if (objectiveText) {
        uncoveredObjectives.push({
          objectiveId: objId,
          objectiveText,
          sectionId,
          chapterKey
        });
      }
    });

    // Create book details for display
    const bookDetails = books.map(book => {
      const bookId = book.id || book.book_id;
      const bookChapters = bookToChaptersMap[bookId] ? bookToChaptersMap[bookId].size : 0;
      const bookSections = bookToSectionsMap[bookId] ? bookToSectionsMap[bookId].size : 0;
      const coveredBookChapters = bookToChaptersMap[bookId] 
        ? Array.from(bookToChaptersMap[bookId]).filter(ch => coveredChapterIds.has(ch)).length
        : 0;
      const coveredBookSections = bookToSectionsMap[bookId]
        ? Array.from(bookToSectionsMap[bookId]).filter(s => coveredSectionIds.has(s)).length
        : 0;

      return {
        bookId,
        bookTitle: book.title || 'Unknown Book',
        totalChapters: bookChapters,
        coveredChapters: coveredBookChapters,
        totalSections: bookSections,
        coveredSections: coveredBookSections
      };
    });

    return {
      coverage: Math.round(overallCoverage),
      totalChapters,
      coveredChapters,
      uncoveredChapters: uncoveredChapters.length,
      totalSections,
      coveredSections,
      uncoveredSections: uncoveredSections.length,
      totalObjectives: allObjectives.size,
      coveredObjectives: coveredObjectiveIds.size,
      uncoveredObjectives: uncoveredObjectiveIds.length,
      totalBooks: books.length,
      bookDetails,
      uncoveredChaptersDetails: uncoveredChapters,
      uncoveredSectionsDetails: uncoveredSections,
      uncoveredObjectivesDetails: uncoveredObjectives
    };
  };

  const fetchModelInfo = async () => {
    try {
      const response = await fetch(`${API_BASE}/ml/model-info`);
      if (response.ok) {
        const data = await response.json();
        setModelInfo(data);
      }
    } catch (err) {
      console.error('Error fetching model info:', err);
    }
  };

  const getScoreColor = (score) => {
    if (score >= 80) return '#48bb78'; // Green
    if (score >= 60) return '#ed8936'; // Orange
    return '#f56565'; // Red
  };

  const getPerformanceLabel = (score) => {
    if (score >= 80) return 'Excellent';
    if (score >= 60) return 'Good';
    if (score >= 40) return 'Fair';
    return 'Needs Improvement';
  };

  // Calculate pass/fail probability based on predicted score and confidence interval
  const calculatePassFailProbability = (predictedScore, confidenceInterval) => {
    const PASS_THRESHOLD = 60; // 60% is the passing threshold
    
    if (!predictedScore && predictedScore !== 0) {
      return { passProbability: 0, failProbability: 0 };
    }

    // If confidence interval is available, use it for more accurate calculation
    if (confidenceInterval && confidenceInterval.length === 2) {
      const [minScore, maxScore] = confidenceInterval;
      
      // If entire interval is above threshold, high pass probability
      if (minScore >= PASS_THRESHOLD) {
        return { passProbability: 95, failProbability: 5 };
      }
      
      // If entire interval is below threshold, high fail probability
      if (maxScore < PASS_THRESHOLD) {
        return { passProbability: 5, failProbability: 95 };
      }
      
      // If threshold is within the interval, calculate based on position
      const intervalWidth = maxScore - minScore;
      const distanceAboveThreshold = maxScore - PASS_THRESHOLD;
      const passProbability = Math.max(10, Math.min(90, (distanceAboveThreshold / intervalWidth) * 100));
      
      return {
        passProbability: Math.round(passProbability),
        failProbability: Math.round(100 - passProbability)
      };
    }
    
    // Fallback: use predicted score only
    if (predictedScore >= PASS_THRESHOLD) {
      // Higher score = higher pass probability
      const passProb = Math.min(95, 50 + ((predictedScore - PASS_THRESHOLD) / 40) * 45);
      return {
        passProbability: Math.round(passProb),
        failProbability: Math.round(100 - passProb)
      };
    } else {
      // Lower score = higher fail probability
      const failProb = Math.min(95, 50 + ((PASS_THRESHOLD - predictedScore) / 60) * 45);
      return {
        passProbability: Math.round(100 - failProb),
        failProbability: Math.round(failProb)
      };
    }
  };

  // Calculate comprehensive metrics for a course
  const calculateCourseMetrics = (coursePred) => {
    const attempts = coursePred.attempts || [];
    const scores = attempts.map(a => a.score || 0).filter(s => s > 0);
    
    if (scores.length === 0) {
      return {
        averageScore: coursePred.predicted_score || 0,
        medianScore: coursePred.predicted_score || 0,
        standardDeviation: 0,
        scoreTrend: 'stable',
        totalAttempts: coursePred.attempt_count || 0,
        successRate: 0,
        averageCorrect: 0,
        averageTotal: 0,
        lastAttemptDate: null,
        firstAttemptDate: null,
        timeSpan: null,
        riskLevel: 'unknown'
      };
    }

    // Calculate average
    const averageScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    
    // Calculate median
    const sortedScores = [...scores].sort((a, b) => a - b);
    const medianScore = sortedScores.length % 2 === 0
      ? (sortedScores[sortedScores.length / 2 - 1] + sortedScores[sortedScores.length / 2]) / 2
      : sortedScores[Math.floor(sortedScores.length / 2)];
    
    // Calculate standard deviation
    const variance = scores.reduce((sum, s) => sum + Math.pow(s - averageScore, 2), 0) / scores.length;
    const standardDeviation = Math.sqrt(variance);
    
    // Calculate trend (comparing first half vs second half)
    const firstHalf = sortedScores.slice(0, Math.floor(sortedScores.length / 2));
    const secondHalf = sortedScores.slice(Math.floor(sortedScores.length / 2));
    const firstHalfAvg = firstHalf.reduce((sum, s) => sum + s, 0) / firstHalf.length;
    const secondHalfAvg = secondHalf.reduce((sum, s) => sum + s, 0) / secondHalf.length;
    const trendDiff = secondHalfAvg - firstHalfAvg;
    let scoreTrend = 'stable';
    if (trendDiff > 3) scoreTrend = 'improving';
    else if (trendDiff < -3) scoreTrend = 'declining';
    
    // Success rate (percentage of attempts >= 60%)
    const successCount = scores.filter(s => s >= 60).length;
    const successRate = (successCount / scores.length) * 100;
    
    // Average questions
    const totalCorrect = attempts.reduce((sum, a) => sum + (a.correct || 0), 0);
    const totalQuestions = attempts.reduce((sum, a) => sum + (a.total || 0), 0);
    const averageCorrect = attempts.length > 0 ? totalCorrect / attempts.length : 0;
    const averageTotal = attempts.length > 0 ? totalQuestions / attempts.length : 0;
    
    // Dates
    const attemptDates = attempts
      .map(a => a.attempted_at ? new Date(a.attempted_at) : null)
      .filter(d => d !== null)
      .sort((a, b) => a - b);
    const firstAttemptDate = attemptDates.length > 0 ? attemptDates[0] : null;
    const lastAttemptDate = attemptDates.length > 0 ? attemptDates[attemptDates.length - 1] : null;
    const timeSpan = firstAttemptDate && lastAttemptDate
      ? Math.ceil((lastAttemptDate - firstAttemptDate) / (1000 * 60 * 60 * 24)) // days
      : null;
    
    // Risk level
    let riskLevel = 'low';
    if (averageScore < 50) riskLevel = 'high';
    else if (averageScore < 60) riskLevel = 'medium';
    else if (standardDeviation > 15) riskLevel = 'medium';
    
    return {
      averageScore: Math.round(averageScore * 100) / 100,
      medianScore: Math.round(medianScore * 100) / 100,
      standardDeviation: Math.round(standardDeviation * 100) / 100,
      scoreTrend,
      totalAttempts: attempts.length,
      successRate: Math.round(successRate * 100) / 100,
      averageCorrect: Math.round(averageCorrect * 100) / 100,
      averageTotal: Math.round(averageTotal * 100) / 100,
      lastAttemptDate,
      firstAttemptDate,
      timeSpan,
      riskLevel
    };
  };

  // Calculate comprehensive metrics for a student
  const calculateStudentMetrics = (studentPred, allCoursePredictions) => {
    // Get all attempts for this student
    const allAttempts = [];
    allCoursePredictions.forEach(coursePred => {
      if (coursePred.attempts) {
        coursePred.attempts.forEach(attempt => {
          if (attempt.user_id === studentPred.user_id) {
            allAttempts.push(attempt);
          }
        });
      }
    });

    const scores = allAttempts.map(a => a.score || 0).filter(s => s > 0);
    
    if (scores.length === 0) {
      return {
        averageScore: studentPred.predicted_score || 0,
        medianScore: studentPred.predicted_score || 0,
        standardDeviation: 0,
        scoreTrend: 'stable',
        successRate: 0,
        averageCorrect: 0,
        averageTotal: 0,
        lastAttemptDate: null,
        firstAttemptDate: null,
        timeSpan: null,
        riskLevel: 'unknown',
        engagementLevel: 'low'
      };
    }

    // Calculate average
    const averageScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    
    // Calculate median
    const sortedScores = [...scores].sort((a, b) => a - b);
    const medianScore = sortedScores.length % 2 === 0
      ? (sortedScores[sortedScores.length / 2 - 1] + sortedScores[sortedScores.length / 2]) / 2
      : sortedScores[Math.floor(sortedScores.length / 2)];
    
    // Calculate standard deviation
    const variance = scores.reduce((sum, s) => sum + Math.pow(s - averageScore, 2), 0) / scores.length;
    const standardDeviation = Math.sqrt(variance);
    
    // Calculate trend
    const firstHalf = sortedScores.slice(0, Math.floor(sortedScores.length / 2));
    const secondHalf = sortedScores.slice(Math.floor(sortedScores.length / 2));
    const firstHalfAvg = firstHalf.length > 0 ? firstHalf.reduce((sum, s) => sum + s, 0) / firstHalf.length : averageScore;
    const secondHalfAvg = secondHalf.length > 0 ? secondHalf.reduce((sum, s) => sum + s, 0) / secondHalf.length : averageScore;
    const trendDiff = secondHalfAvg - firstHalfAvg;
    let scoreTrend = 'stable';
    if (trendDiff > 3) scoreTrend = 'improving';
    else if (trendDiff < -3) scoreTrend = 'declining';
    
    // Success rate
    const successCount = scores.filter(s => s >= 60).length;
    const successRate = (successCount / scores.length) * 100;
    
    // Average questions
    const totalCorrect = allAttempts.reduce((sum, a) => sum + (a.correct || 0), 0);
    const totalQuestions = allAttempts.reduce((sum, a) => sum + (a.total || 0), 0);
    const averageCorrect = allAttempts.length > 0 ? totalCorrect / allAttempts.length : 0;
    const averageTotal = allAttempts.length > 0 ? totalQuestions / allAttempts.length : 0;
    
    // Dates
    const attemptDates = allAttempts
      .map(a => a.attempted_at ? new Date(a.attempted_at) : null)
      .filter(d => d !== null)
      .sort((a, b) => a - b);
    const firstAttemptDate = attemptDates.length > 0 ? attemptDates[0] : null;
    const lastAttemptDate = attemptDates.length > 0 ? attemptDates[attemptDates.length - 1] : null;
    const timeSpan = firstAttemptDate && lastAttemptDate
      ? Math.ceil((lastAttemptDate - firstAttemptDate) / (1000 * 60 * 60 * 24)) // days
      : null;
    
    // Risk level
    let riskLevel = 'low';
    if (averageScore < 50) riskLevel = 'high';
    else if (averageScore < 60) riskLevel = 'medium';
    else if (standardDeviation > 15) riskLevel = 'medium';
    
    // Engagement level (based on attempts per course and recency)
    const attemptsPerCourse = allAttempts.length / (studentPred.total_courses || 1);
    const daysSinceLastAttempt = lastAttemptDate ? Math.ceil((new Date() - lastAttemptDate) / (1000 * 60 * 60 * 24)) : 999;
    let engagementLevel = 'low';
    if (attemptsPerCourse >= 5 && daysSinceLastAttempt <= 7) engagementLevel = 'high';
    else if (attemptsPerCourse >= 3 && daysSinceLastAttempt <= 30) engagementLevel = 'medium';
    
    return {
      averageScore: Math.round(averageScore * 100) / 100,
      medianScore: Math.round(medianScore * 100) / 100,
      standardDeviation: Math.round(standardDeviation * 100) / 100,
      scoreTrend,
      successRate: Math.round(successRate * 100) / 100,
      averageCorrect: Math.round(averageCorrect * 100) / 100,
      averageTotal: Math.round(averageTotal * 100) / 100,
      lastAttemptDate,
      firstAttemptDate,
      timeSpan,
      riskLevel,
      engagementLevel
    };
  };

  const toggleCourseCardExpanded = (courseId) => {
    setExpandedCourseCards(prev => ({
      ...prev,
      [courseId]: !prev[courseId]
    }));
  };


  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return dateString;
    }
  };

  const formatChartDate = (date) => {
    if (!date) return '';
    try {
      const d = date instanceof Date ? date : new Date(date);
      return d.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric',
        year: 'numeric'
      });
    } catch (e) {
      return '';
    }
  };

  const fetchRecommendations = async (courseId, studentId = null) => {
    try {
      const headers = {
        'Content-Type': 'application/json',
      };

      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      // TODO: Replace with actual API endpoint
      // const response = await fetch(`${API_BASE}/recommendations?course_id=${courseId}${studentId ? `&user_id=${studentId}` : ''}`, {
      //   method: 'GET',
      //   headers: headers,
      // });

      // For now, generate dummy recommendations
      const dummyRecommendations = {
        videos: [
          { id: 1, title: 'Introduction to Course Concepts', url: 'https://example.com/video1', duration: '15:30', type: 'video' },
          { id: 2, title: 'Advanced Techniques Tutorial', url: 'https://example.com/video2', duration: '22:45', type: 'video' },
          { id: 3, title: 'Practice Problems Walkthrough', url: 'https://example.com/video3', duration: '18:20', type: 'video' }
        ],
        blogs: [
          { id: 1, title: 'Best Practices for Success', url: 'https://example.com/blog1', readTime: '5 min', type: 'blog' },
          { id: 2, title: 'Common Mistakes to Avoid', url: 'https://example.com/blog2', readTime: '8 min', type: 'blog' }
        ],
        courseMaterials: [
          { id: 1, title: 'Chapter 3 Study Guide', url: 'https://example.com/material1', format: 'PDF', type: 'material' },
          { id: 2, title: 'Practice Quiz Questions', url: 'https://example.com/material2', format: 'PDF', type: 'material' },
          { id: 3, title: 'Supplementary Reading', url: 'https://example.com/material3', format: 'DOC', type: 'material' }
        ]
      };

      return dummyRecommendations;
    } catch (error) {
      console.error('Error fetching recommendations:', error);
      return null;
    }
  };

  const handleOpenRecommendations = async (type, id, title) => {
    // Fetch recommendations if not already loaded
    if (type === 'course') {
      if (!courseRecommendations[id]) {
        const recommendations = await fetchRecommendations(id, user?.id);
        if (recommendations) {
          setCourseRecommendations(prev => ({
            ...prev,
            [id]: recommendations
          }));
        }
      }
    } else if (type === 'student') {
      if (!studentRecommendations[id]) {
        const recommendations = await fetchRecommendations(null, id);
        if (recommendations) {
          setStudentRecommendations(prev => ({
            ...prev,
            [id]: recommendations
          }));
        }
      }
    }
    
    setRecommendationsModal({ type, id, title });
  };

  const handleCloseRecommendationsModal = () => {
    setRecommendationsModal(null);
  };

  const handleBoostCourse = async (courseId) => {
    const isCurrentlyBoosted = boostedCourses.has(courseId);
    
    setBoostedCourses(prev => {
      const newSet = new Set(prev);
      if (isCurrentlyBoosted) {
        newSet.delete(courseId);
      } else {
        newSet.add(courseId);
      }
      return newSet;
    });

    if (!isCurrentlyBoosted) {
      // Fetch recommendations when boosting
      const recommendations = await fetchRecommendations(courseId, user?.id);
      if (recommendations) {
        setCourseRecommendations(prev => ({
          ...prev,
          [courseId]: recommendations
        }));
      }
    } else {
      // Remove recommendations when unboosting
      setCourseRecommendations(prev => {
        const updated = { ...prev };
        delete updated[courseId];
        return updated;
      });
    }
    
    // TODO: Call API to boost/unboost course
    // Example: fetch(`${API_BASE}/courses/${courseId}/boost`, { method: 'POST' })
  };

  const handleAddRecommendation = (type, entityId, category, newData) => {
    // Generate a new ID for the item
    const newId = Date.now(); // Simple ID generation
    
    if (type === 'course') {
      setCourseRecommendations(prev => {
        const updated = { ...prev };
        if (!updated[entityId]) {
          updated[entityId] = { videos: [], blogs: [], courseMaterials: [] };
        }
        updated[entityId] = {
          ...updated[entityId],
          [category]: [...(updated[entityId][category] || []), { ...newData, id: newId }]
        };
        return updated;
      });
    } else {
      setStudentRecommendations(prev => {
        const updated = { ...prev };
        if (!updated[entityId]) {
          updated[entityId] = { videos: [], blogs: [], courseMaterials: [] };
        }
        updated[entityId] = {
          ...updated[entityId],
          [category]: [...(updated[entityId][category] || []), { ...newData, id: newId }]
        };
        return updated;
      });
    }
    setAddingRecommendation(null);
    // TODO: Call API to add recommendation
    // Example: fetch(`${API_BASE}/recommendations`, { method: 'POST', body: JSON.stringify(newData) })
  };

  const handleDeleteRecommendation = (type, entityId, category, itemId) => {
    if (type === 'course') {
      setCourseRecommendations(prev => {
        const updated = { ...prev };
        if (updated[entityId] && updated[entityId][category]) {
          updated[entityId] = {
            ...updated[entityId],
            [category]: updated[entityId][category].filter(item => item.id !== itemId)
          };
        }
        return updated;
      });
    } else {
      setStudentRecommendations(prev => {
        const updated = { ...prev };
        if (updated[entityId] && updated[entityId][category]) {
          updated[entityId] = {
            ...updated[entityId],
            [category]: updated[entityId][category].filter(item => item.id !== itemId)
          };
        }
        return updated;
      });
    }
    // TODO: Call API to delete recommendation
    // Example: fetch(`${API_BASE}/recommendations/${itemId}`, { method: 'DELETE' })
  };

  const handleUpdateRecommendation = (type, entityId, category, itemId, updatedData) => {
    if (type === 'course') {
      setCourseRecommendations(prev => {
        const updated = { ...prev };
        if (updated[entityId] && updated[entityId][category]) {
          updated[entityId] = {
            ...updated[entityId],
            [category]: updated[entityId][category].map(item => 
              item.id === itemId ? { ...item, ...updatedData } : item
            )
          };
        }
        return updated;
      });
    } else {
      setStudentRecommendations(prev => {
        const updated = { ...prev };
        if (updated[entityId] && updated[entityId][category]) {
          updated[entityId] = {
            ...updated[entityId],
            [category]: updated[entityId][category].map(item => 
              item.id === itemId ? { ...item, ...updatedData } : item
            )
          };
        }
        return updated;
      });
    }
    setEditingRecommendation(null);
    // TODO: Call API to update recommendation
    // Example: fetch(`${API_BASE}/recommendations/${itemId}`, { method: 'PUT', body: JSON.stringify(updatedData) })
  };

  const handleBoostStudent = async (studentId) => {
    const isCurrentlyBoosted = boostedStudents.has(studentId);
    
    setBoostedStudents(prev => {
      const newSet = new Set(prev);
      if (isCurrentlyBoosted) {
        newSet.delete(studentId);
      } else {
        newSet.add(studentId);
      }
      return newSet;
    });

    if (!isCurrentlyBoosted) {
      // Fetch student-specific recommendations
      // For students, we might want to fetch recommendations based on their courses
      const recommendations = await fetchRecommendations(null, studentId);
      if (recommendations) {
        setStudentRecommendations(prev => ({
          ...prev,
          [studentId]: recommendations
        }));
      }
    } else {
      // Remove recommendations when unboosting
      setStudentRecommendations(prev => {
        const updated = { ...prev };
        delete updated[studentId];
        return updated;
      });
    }
    
    // TODO: Call API to boost/unboost student
    // Example: fetch(`${API_BASE}/students/${studentId}/boost`, { method: 'POST' })
  };

  // TODO: Remove dummy data once real data is working
  // Dummy course predictions for layout preview - memoized to maintain stable reference
  const dummyCoursePredictions = useMemo(() => [
    {
      course_id: 'dummy-course-1',
      course_title: 'Introduction to Science',
      predicted_score: 82,
      confidence_interval: [78, 86],
      attempt_count: 5,
        attempts: [
          {
            attempt_id: 'attempt-1',
            assessment_id: 'assessment-1',
            assessment_title: 'Test 1',
            score: 85,
            correct: 17,
            total: 20,
            attempted_at: '2024-01-15T10:30:00'
          },
          {
            attempt_id: 'attempt-2',
            assessment_id: 'assessment-2',
            assessment_title: 'Quiz 1',
            score: 80,
            correct: 16,
            total: 20,
            attempted_at: '2024-01-14T14:20:00'
          }
      ]
    },
    {
      course_id: 'dummy-course-2',
      course_title: 'Mathematics Fundamentals',
      predicted_score: 75,
      confidence_interval: [70, 80],
      attempt_count: 8,
        attempts: [
          {
            attempt_id: 'attempt-3',
            assessment_id: 'assessment-3',
            assessment_title: 'Math Test 1',
            score: 72,
            correct: 18,
            total: 25,
            attempted_at: '2024-01-16T09:15:00'
          },
          {
            attempt_id: 'attempt-4',
            assessment_id: 'assessment-4',
            assessment_title: 'Math Quiz 1',
            score: 78,
            correct: 19,
            total: 25,
            attempted_at: '2024-01-13T16:45:00'
          }
        ]
    },
    {
      course_id: 'dummy-course-3',
      course_title: 'Chemistry Basics',
      predicted_score: 68,
      confidence_interval: [63, 73],
      attempt_count: 3,
        attempts: [
          {
            attempt_id: 'attempt-5',
            assessment_id: 'assessment-5',
            assessment_title: 'Chemistry Test',
            score: 65,
            correct: 13,
            total: 20,
            attempted_at: '2024-01-12T11:00:00'
          }
        ]
    },
    {
      course_id: 'dummy-course-4',
      course_title: 'Physics Principles',
      predicted_score: 90,
      confidence_interval: [85, 95],
      attempt_count: 12,
        attempts: [
          {
            attempt_id: 'attempt-6',
            assessment_id: 'assessment-6',
            assessment_title: 'Physics Final',
            score: 92,
            correct: 23,
            total: 25,
            attempted_at: '2024-01-17T13:30:00'
          },
          {
            attempt_id: 'attempt-7',
            assessment_id: 'assessment-7',
            assessment_title: 'Physics Midterm',
            score: 88,
            correct: 22,
            total: 25,
            attempted_at: '2024-01-10T10:00:00'
          }
        ]
    },
    {
      course_id: 'dummy-course-5',
      course_title: 'Biology Essentials',
      predicted_score: 55,
      confidence_interval: [50, 60],
      attempt_count: 2,
        attempts: [
          {
            attempt_id: 'attempt-8',
            assessment_id: 'assessment-8',
            assessment_title: 'Biology Quiz',
            score: 50,
            correct: 10,
            total: 20,
            attempted_at: '2024-01-11T15:20:00'
          }
        ]
    }
  ], []); // Empty dependency array - this is constant dummy data

  // Memoize allCoursePredictions so it doesn't recalculate when search queries change
  // This ensures the Student Predictions chart remains completely independent of search
  const allCoursePredictions = useMemo(() => {
    return coursePredictions.length > 0 ? coursePredictions : dummyCoursePredictions;
  }, [coursePredictions]);
  const isShowingDummyData = coursePredictions.length === 0 && !loadingCourses;

  // Filter course predictions based on search query
  const displayCoursePredictions = allCoursePredictions.filter(coursePred => {
    if (!courseSearchQuery.trim()) return true;
    const query = courseSearchQuery.toLowerCase();
    return coursePred.course_title?.toLowerCase().includes(query);
  });

  // Extract and compute student predictions from course predictions
  const getStudentPredictions = () => {
    const studentsMap = {};
    
    // Collect all students from course predictions
    // IMPORTANT: Use allCoursePredictions (NOT displayCoursePredictions) to be independent of course search
    // This ensures the Student Predictions chart is detached from all search queries
    allCoursePredictions.forEach(coursePred => {
      if (coursePred.attempts && coursePred.attempts.length > 0) {
        coursePred.attempts.forEach(attempt => {
          const studentId = attempt.user_id;
          if (!studentsMap[studentId]) {
            studentsMap[studentId] = {
              user_id: studentId,
              user_name: attempt.user_name || 'Unknown Student',
              user_email: attempt.user_email || '',
              attempts: [],
              courses: new Set()
            };
          }
          studentsMap[studentId].attempts.push(attempt);
          studentsMap[studentId].courses.add(coursePred.course_id);
        });
      }
    });

    // Calculate statistics for each student
    return Object.values(studentsMap).map(student => {
      const scores = student.attempts.map(a => a.score || 0);
      const totalCorrect = student.attempts.reduce((sum, a) => sum + (a.correct || 0), 0);
      const totalQuestions = student.attempts.reduce((sum, a) => sum + (a.total || 0), 0);
      
      const avgScore = scores.length > 0 
        ? scores.reduce((sum, s) => sum + s, 0) / scores.length 
        : 0;
      
      return {
        user_id: student.user_id,
        user_name: student.user_name,
        user_email: student.user_email,
        predicted_score: Math.round(avgScore),
        total_attempts: student.attempts.length,
        total_courses: student.courses.size,
        highest_score: scores.length > 0 ? Math.max(...scores) : 0,
        lowest_score: scores.length > 0 ? Math.min(...scores) : 0,
        overall_accuracy: totalQuestions > 0 ? (totalCorrect / totalQuestions) * 100 : 0,
        confidence_interval: [
          Math.max(0, Math.round(avgScore - 10)),
          Math.min(100, Math.round(avgScore + 10))
        ]
      };
    }).sort((a, b) => {
      // Sort by predicted score (highest first), then by name
      if (b.predicted_score !== a.predicted_score) {
        return b.predicted_score - a.predicted_score;
      }
      return a.user_name.localeCompare(b.user_name);
    });
  };

  // Memoize allStudentPredictions so it doesn't recalculate when studentSearchQuery changes
  // This ensures the chart remains completely independent of student search
  const allStudentPredictions = useMemo(() => getStudentPredictions(), [allCoursePredictions]);

  // Filter student predictions based on search query (for the grid display only, NOT for chart)
  const studentPredictions = useMemo(() => {
    if (!studentSearchQuery.trim()) return allStudentPredictions;
    const query = studentSearchQuery.toLowerCase().trim();
    return allStudentPredictions.filter(studentPred => {
      // Search by name
      if (studentPred.user_name?.toLowerCase().includes(query)) return true;
      // Search by email
      if (studentPred.user_email?.toLowerCase().includes(query)) return true;
      // Search by user ID
      if (studentPred.user_id?.toLowerCase().includes(query)) return true;
      // Search by score range (e.g., ">80", "<60", "70-90")
      if (query.startsWith('>') || query.startsWith('<') || query.includes('-')) {
        const score = studentPred.predicted_score || 0;
        if (query.startsWith('>')) {
          const threshold = parseInt(query.substring(1));
          if (!isNaN(threshold) && score > threshold) return true;
        } else if (query.startsWith('<')) {
          const threshold = parseInt(query.substring(1));
          if (!isNaN(threshold) && score < threshold) return true;
        } else if (query.includes('-')) {
          const [min, max] = query.split('-').map(s => parseInt(s.trim()));
          if (!isNaN(min) && !isNaN(max) && score >= min && score <= max) return true;
        }
      }
      return false;
    });
  }, [allStudentPredictions, studentSearchQuery]);

  if (!user) {
    return null;
  }

  return (
    <div className="performance-dashboard">
      <div className="dashboard-header">
        <h3>📊 Performance Prediction (Adaptive/Personalized)</h3>
        <button 
          className="btn-refresh" 
          onClick={() => {
            fetchPrediction();
            fetchCoursePredictions();
          }}
          disabled={loading || loadingCourses}
          title="Refresh predictions"
        >
          🔄
        </button>
      </div>

      {/* Course-specific predictions - Main content */}
      {loadingCourses && coursePredictions.length === 0 && !isShowingDummyData ? (
        <div className="dashboard-loading">
          <div className="spinner"></div>
          <span>Loading course predictions...</span>
        </div>
      ) : allCoursePredictions.length > 0 ? (
        <div className="course-predictions-main">
          <h4 className="section-title">📚 Course Predictions (Adaptive)</h4>
          
          {/* Course Selection Dropdown for Chart */}
          <div className="chart-course-selector">
            <label htmlFor="course-chart-select" style={{ marginRight: '10px', fontWeight: '600', color: '#333' }}>
              Select Course for Chart:
            </label>
            <select
              id="course-chart-select"
              value={selectedCourseForChart || ''}
              onChange={(e) => setSelectedCourseForChart(e.target.value || null)}
              style={{
                padding: '8px 12px',
                borderRadius: '8px',
                border: '2px solid #667eea',
                fontSize: '0.95em',
                backgroundColor: '#ffffff',
                color: '#333',
                cursor: 'pointer',
                minWidth: '250px'
              }}
            >
              <option value="">-- Select a Course --</option>
              {allCoursePredictions.map(coursePred => (
                <option key={coursePred.course_id} value={coursePred.course_id}>
                  {coursePred.course_title}
                </option>
              ))}
            </select>
          </div>
          
          {/* Progress Chart for Course Predictions - X,Y Graph (Date/Time vs Confidence Score) */}
          <div className="course-predictions-chart">
            <div className="chart-container">
              {(() => {
                // Filter to selected course for chart (or all if none selected)
                const coursesForChart = selectedCourseForChart
                  ? allCoursePredictions.filter(cp => cp.course_id === selectedCourseForChart)
                  : allCoursePredictions;
                
                // Collect actual confidence scores and predicted confidence scores
                const actualConfidencePoints = [];
                const predictedConfidencePoints = [];
                
                coursesForChart.forEach(coursePred => {
                  // Calculate predicted confidence score from confidence interval
                  // Confidence = 100 - (interval width), so narrower intervals = higher confidence
                  const intervalWidth = coursePred.confidence_interval 
                    ? coursePred.confidence_interval[1] - coursePred.confidence_interval[0]
                    : 20; // Default width if not available
                  const predictedConfidence = Math.max(0, 100 - intervalWidth);
                  
                  // Collect actual confidence scores from attempts
                  if (coursePred.attempts && coursePred.attempts.length > 0) {
                    coursePred.attempts.forEach(attempt => {
                      if (attempt.attempted_at) {
                        // Calculate actual confidence based on how close actual score is to predicted
                        // If actual score is close to predicted, confidence is higher
                        const actualScore = attempt.score || 0;
                        const predictedScore = coursePred.predicted_score || 0;
                        const scoreDiff = Math.abs(actualScore - predictedScore);
                        // Confidence decreases as difference increases (max difference = 100)
                        const actualConfidence = Math.max(0, 100 - scoreDiff);
                        
                        actualConfidencePoints.push({
                          date: new Date(attempt.attempted_at),
                          confidence: actualConfidence,
                          course_title: coursePred.course_title,
                          course_id: coursePred.course_id
                        });
                      }
                    });
                  }
                  
                  // Collect predicted confidence score for each attempt date
                  if (coursePred.attempts && coursePred.attempts.length > 0) {
                    coursePred.attempts.forEach(attempt => {
                      if (attempt.attempted_at) {
                        predictedConfidencePoints.push({
                          date: new Date(attempt.attempted_at),
                          confidence: predictedConfidence,
                          course_title: coursePred.course_title,
                          course_id: coursePred.course_id
                        });
                      }
                    });
                  }
                });
                
                // Combine all data points for range calculation
                const allPoints = [...actualConfidencePoints, ...predictedConfidencePoints];

                // Sort by date
                actualConfidencePoints.sort((a, b) => a.date - b.date);
                predictedConfidencePoints.sort((a, b) => a.date - b.date);
                
                // Limit to reasonable number of points for display (same limit for both)
                const maxPoints = 50;
                const displayActualPoints = actualConfidencePoints.slice(-maxPoints); // Last 50 points
                const displayPredictedPoints = predictedConfidencePoints.slice(-maxPoints); // Last 50 points
                
                if (allPoints.length === 0) {
                  return (
                    <>
                      <div className="chart-no-data">No attempt data available for chart</div>
                      {/* No chart labels when there's no data */}
                    </>
                  );
                }

                // Calculate date range from all points
                const allDates = allPoints.map(p => p.date).sort((a, b) => a - b);
                const minDate = allDates[0];
                const maxDate = allDates[allDates.length - 1];
                const dateRange = maxDate - minDate || 1; // Avoid division by zero
                
                // Calculate confidence range (0-100 for both actual and predicted)
                const allConfidences = allPoints.map(p => p.confidence).filter(c => c !== undefined);
                const minConf = Math.min(...allConfidences, 0);
                const maxConf = Math.max(...allConfidences, 100);
                const confRange = maxConf - minConf || 100;

                return (
                  <>
                    <svg className="chart-svg" viewBox="0 0 800 420" preserveAspectRatio="xMidYMid meet">
                      {/* Y-axis label */}
                      <text
                        x="25"
                        y="200"
                        fill="#000"
                        fontSize="14"
                        fontWeight="600"
                        textAnchor="middle"
                        transform="rotate(-90 25 200)"
                      >
                        Confidence Score (%)
                      </text>
                    
                    {/* Y-axis labels and grid lines (Confidence Score) */}
                    {[0, 25, 50, 75, 100].map((value) => {
                      const y = 350 - ((value - minConf) / confRange) * 300;
                      if (y < 50 || y > 350) return null;
                      return (
                        <g key={value}>
                          <line
                            x1="60"
                            y1={y}
                            x2="780"
                            y2={y}
                            stroke="rgba(102, 126, 234, 0.3)"
                            strokeWidth="1"
                          />
                          <text
                            x="55"
                            y={y + 5}
                            fill="#000"
                            fontSize="12"
                            textAnchor="end"
                            fontWeight="600"
                          >
                            {value}%
                          </text>
                        </g>
                      );
                    })}
                    
                    {/* X-axis labels (Date/Time) */}
                    {(() => {
                      const numLabels = 8;
                      const labels = [];
                      for (let i = 0; i < numLabels; i++) {
                        const ratio = i / (numLabels - 1);
                        const date = new Date(minDate.getTime() + dateRange * ratio);
                        const x = 80 + (ratio * 700);
                        labels.push({ x, date });
                      }
                      return labels.map((label, idx) => (
                        <text
                          key={idx}
                          x={label.x}
                          y="390"
                          fill="#333"
                          fontSize="10"
                          textAnchor="middle"
                          transform={`rotate(-45 ${label.x} 390)`}
                          fontWeight="500"
                        >
                          {formatChartDate(label.date)}
                        </text>
                      ));
                    })()}
                    
                    {/* X-axis line */}
                    <line
                      x1="60"
                      y1="350"
                      x2="780"
                      y2="350"
                      stroke="#667eea"
                      strokeWidth="2"
                    />
                    
                    {/* Y-axis line */}
                    <line
                      x1="60"
                      y1="50"
                      x2="60"
                      y2="350"
                      stroke="#667eea"
                      strokeWidth="2"
                    />
                    
                    {/* Predicted Confidence Score line and points */}
                    {displayPredictedPoints.map((point, index) => {
                      const x = 80 + ((point.date - minDate) / dateRange) * 700;
                      const y = 350 - ((point.confidence - minConf) / confRange) * 300;
                      
                      // Draw line connecting to previous point
                      if (index > 0) {
                        const prevPoint = displayPredictedPoints[index - 1];
                        const prevX = 80 + ((prevPoint.date - minDate) / dateRange) * 700;
                        const prevY = 350 - ((prevPoint.confidence - minConf) / confRange) * 300;
                        
                        return (
                          <g key={`predicted-line-${index}`}>
                            <line
                              x1={prevX}
                              y1={prevY}
                              x2={x}
                              y2={y}
                              stroke="#667eea"
                              strokeWidth="2"
                              strokeDasharray="5,5"
                              opacity="0.7"
                            />
                            <circle
                              cx={x}
                              cy={y}
                              r="5"
                              fill="#667eea"
                              stroke="#667eea"
                              strokeWidth="2"
                              opacity="0.8"
                            />
                            <title>{point.course_title}: {point.confidence.toFixed(1)}% predicted confidence on {formatChartDate(point.date)}</title>
                          </g>
                        );
                      }
                      
                      return (
                        <g key={`predicted-point-${index}`}>
                          <circle
                            cx={x}
                            cy={y}
                            r="5"
                            fill="#667eea"
                            stroke="#667eea"
                            strokeWidth="2"
                            opacity="0.8"
                          />
                          <title>{point.course_title}: {point.confidence.toFixed(1)}% predicted confidence on {formatChartDate(point.date)}</title>
                        </g>
                      );
                    })}
                    
                    {/* Legend for Predicted line */}
                    {displayPredictedPoints.length > 0 && (() => {
                      const lastPoint = displayPredictedPoints[displayPredictedPoints.length - 1];
                      const x = 80 + ((lastPoint.date - minDate) / dateRange) * 700;
                      const y = 350 - ((lastPoint.confidence - minConf) / confRange) * 300;
                      
                      return (
                        <text
                          x={x + 10}
                          y={y}
                          fill="#667eea"
                          fontSize="11"
                          fontWeight="600"
                          dominantBaseline="middle"
                        >
                          Predicted
                        </text>
                      );
                    })()}
                    
                    {/* Actual Confidence Score line and points */}
                    {displayActualPoints.map((point, index) => {
                      const x = 80 + ((point.date - minDate) / dateRange) * 700;
                      const y = 350 - ((point.confidence - minConf) / confRange) * 300;
                      const color = getScoreColor(point.confidence);
                      
                      // Draw line connecting to previous point
                      if (index > 0) {
                        const prevPoint = displayActualPoints[index - 1];
                        const prevX = 80 + ((prevPoint.date - minDate) / dateRange) * 700;
                        const prevY = 350 - ((prevPoint.confidence - minConf) / confRange) * 300;
                        
                        return (
                          <g key={`actual-line-${index}`}>
                            <line
                              x1={prevX}
                              y1={prevY}
                              x2={x}
                              y2={y}
                              stroke={color}
                              strokeWidth="2"
                              opacity="0.7"
                            />
                            <circle
                              cx={x}
                              cy={y}
                              r="5"
                              fill={color}
                              stroke="#667eea"
                              strokeWidth="2"
                            />
                            <title>{point.course_title}: {point.confidence.toFixed(1)}% actual confidence on {formatChartDate(point.date)}</title>
                          </g>
                        );
                      }
                      
                      return (
                        <g key={`actual-point-${index}`}>
                          <circle
                            cx={x}
                            cy={y}
                            r="5"
                            fill={color}
                            stroke="#667eea"
                            strokeWidth="2"
                          />
                          <title>{point.course_title}: {point.confidence.toFixed(1)}% actual confidence on {formatChartDate(point.date)}</title>
                        </g>
                      );
                    })}
                    
                    {/* Legend for Actual line */}
                    {displayActualPoints.length > 0 && (() => {
                      const lastPoint = displayActualPoints[displayActualPoints.length - 1];
                      const x = 80 + ((lastPoint.date - minDate) / dateRange) * 700;
                      const y = 350 - ((lastPoint.confidence - minConf) / confRange) * 300;
                      const color = getScoreColor(lastPoint.confidence);
                      
                      return (
                        <text
                          x={x + 10}
                          y={y}
                          fill={color}
                          fontSize="11"
                          fontWeight="600"
                          dominantBaseline="middle"
                        >
                          Actual
                        </text>
                      );
                    })()}
                    </svg>
                    {/* Chart labels - only show when there's data */}
                    {allPoints.length > 0 && (
                      <div className="chart-labels">
                        <div className="chart-x-label">Date</div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>

          {/* Search input below chart */}
          <div className="course-search-container">
            <input
              type="text"
              className="course-search-input"
              placeholder="🔍 Search courses..."
              value={courseSearchQuery}
              onChange={(e) => setCourseSearchQuery(e.target.value)}
            />
          </div>
          
          <div className="course-predictions-grid">
            {displayCoursePredictions.length > 0 ? (
              displayCoursePredictions.map((coursePred) => (
              <div 
                key={coursePred.course_id} 
                className="course-prediction-card"
                style={{
                  borderLeft: `4px solid ${getScoreColor(coursePred.predicted_score)}`,
                  cursor: 'pointer'
                }}
                onClick={() => handleOpenRecommendations('course', coursePred.course_id, coursePred.course_title)}
              >
                <div className="course-prediction-header">
                  <h5 className="course-name">{coursePred.course_title}</h5>
                  <div className="course-header-right">
                    <div 
                      className="course-prediction-score"
                      style={{ color: getScoreColor(coursePred.predicted_score) }}
                    >
                      {coursePred.predicted_score}%
                    </div>
                    <button
                      className={`boost-button ${boostedCourses.has(coursePred.course_id) ? 'boosted' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleBoostCourse(coursePred.course_id);
                      }}
                      title={boostedCourses.has(coursePred.course_id) ? 'Unboost course' : 'Boost course'}
                    >
                      {boostedCourses.has(coursePred.course_id) ? '🚀' : '⚡'}
                    </button>
                    <button
                      className="recommendations-button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenRecommendations('course', coursePred.course_id, coursePred.course_title);
                      }}
                      title="View Recommended Materials"
                    >
                      📚
                    </button>
                  </div>
                </div>
                
                {/* Progress bar for course */}
                <div className="course-prediction-progress">
                  <div 
                    className="progress-bar" 
                    style={{ 
                      width: `${Math.min(coursePred.predicted_score, 100)}%`,
                      backgroundColor: getScoreColor(coursePred.predicted_score)
                    }}
                  />
                </div>

                <div className="course-prediction-body">
                  {coursePred.confidence_interval && (
                    <div className="course-prediction-range">
                      <span className="range-label">Confidence Range:</span>
                      <span className="range-value">
                        {coursePred.confidence_interval[0]}% - {coursePred.confidence_interval[1]}%
                      </span>
                    </div>
                  )}
                  {coursePred.attempt_count > 0 && (
                    <div className="course-prediction-stats">
                      <span>📝 {coursePred.attempt_count} attempt{coursePred.attempt_count !== 1 ? 's' : ''}</span>
                    </div>
                  )}
                  {/* Pass/Fail Probability */}
                  {(() => {
                    const { passProbability, failProbability } = calculatePassFailProbability(
                      coursePred.predicted_score,
                      coursePred.confidence_interval
                    );
                    return (
                      <div className="pass-fail-probability">
                        <div className="probability-row">
                          <span className="probability-label">✅ Success:</span>
                          <span className="probability-value pass" style={{ color: '#48bb78' }}>
                            {passProbability}%
                          </span>
                  </div>
                        <div className="probability-row">
                          <span className="probability-label">❌ Fail:</span>
                          <span className="probability-value fail" style={{ color: '#f56565' }}>
                            {failProbability}%
                          </span>
                </div>
                    </div>
                    );
                  })()}
                  
                  {/* Book Overall Coverage */}
                  {(() => {
                    const bookCoverage = calculateBookCoverage(coursePred.course_id, coursePred);
                    return (
                      <div className="book-coverage-section">
                        <div className="book-coverage-header">
                          <span className="book-coverage-label">📚 Books Overall Coverage:</span>
                          <span className="book-coverage-value" style={{ 
                            color: bookCoverage.coverage >= 70 ? '#48bb78' : 
                                   bookCoverage.coverage >= 40 ? '#ed8936' : '#f56565' 
                          }}>
                            {bookCoverage.coverage}%
                          </span>
                        </div>
                        {(bookCoverage.totalChapters > 0 || bookCoverage.totalSections > 0) && (
                          <div className="book-coverage-details">
                            {bookCoverage.totalChapters > 0 && (
                              <span className="coverage-detail">
                                📖 {bookCoverage.coveredChapters} / {bookCoverage.totalChapters} chapters covered
                                {bookCoverage.uncoveredChapters > 0 && (
                                  <span style={{ color: '#f56565', marginLeft: '4px' }}>
                                    ({bookCoverage.uncoveredChapters} not covered)
                                  </span>
                                )}
                              </span>
                            )}
                            {bookCoverage.totalSections > 0 && (
                              <span className="coverage-detail">
                                {bookCoverage.totalChapters > 0 ? ' • ' : ''}
                                📄 {bookCoverage.coveredSections} / {bookCoverage.totalSections} sections covered
                                {bookCoverage.uncoveredSections > 0 && (
                                  <span style={{ color: '#f56565', marginLeft: '4px' }}>
                                    ({bookCoverage.uncoveredSections} not covered)
                                  </span>
                                )}
                              </span>
                            )}
                            {bookCoverage.totalObjectives > 0 && (
                              <span className="coverage-detail">
                                {bookCoverage.totalChapters > 0 || bookCoverage.totalSections > 0 ? ' • ' : ''}
                                🎯 {bookCoverage.coveredObjectives} / {bookCoverage.totalObjectives} objectives covered
                                {bookCoverage.uncoveredObjectives > 0 && (
                                  <span style={{ color: '#f56565', marginLeft: '4px' }}>
                                    ({bookCoverage.uncoveredObjectives} not covered)
                                  </span>
                                )}
                              </span>
                            )}
                            {bookCoverage.totalBooks > 0 && (
                              <span className="coverage-detail">
                                • 📚 {bookCoverage.totalBooks} book{bookCoverage.totalBooks !== 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        )}
                        {bookCoverage.bookDetails && bookCoverage.bookDetails.length > 0 && (
                          <div className="book-coverage-books">
                            {bookCoverage.bookDetails.map((book, idx) => (
                              <div key={book.bookId || idx} className="book-coverage-book-item">
                                <span className="book-name">{book.bookTitle}</span>
                                {book.totalChapters > 0 && (
                                  <span className="book-stats">
                                    📖 {book.coveredChapters}/{book.totalChapters} chapters
                                  </span>
                                )}
                                {book.totalSections > 0 && (
                                  <span className="book-stats">
                                    📄 {book.coveredSections}/{book.totalSections} sections
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        
                        {/* Show Not Covered Items */}
                        {(bookCoverage.uncoveredChapters > 0 || bookCoverage.uncoveredSections > 0 || bookCoverage.uncoveredObjectives > 0) && (
                          <button
                            className="uncovered-toggle-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedMetrics(prev => ({
                                ...prev,
                                [`uncovered-${coursePred.course_id}`]: !prev[`uncovered-${coursePred.course_id}`]
                              }));
                            }}
                          >
                            {expandedMetrics[`uncovered-${coursePred.course_id}`] ? '▼ Hide' : '▶ Show'} Not Covered Items
                          </button>
                        )}
                        
                        {expandedMetrics[`uncovered-${coursePred.course_id}`] && (
                          <div className="uncovered-items-section">
                            {bookCoverage.uncoveredChapters > 0 && (
                              <div className="uncovered-category">
                                <h6 className="uncovered-category-title">
                                  📖 Not Covered Chapters ({bookCoverage.uncoveredChapters})
                                </h6>
                                <div className="uncovered-items-list">
                                  {bookCoverage.uncoveredChaptersDetails && bookCoverage.uncoveredChaptersDetails.length > 0 ? (
                                    bookCoverage.uncoveredChaptersDetails.map((chapter, idx) => (
                                      <div key={idx} className="uncovered-item">
                                        <span className="uncovered-item-book">{chapter.bookTitle}</span>
                                        <span className="uncovered-item-title">{chapter.chapterTitle}</span>
                                      </div>
                                    ))
                                  ) : (
                                    <div className="no-uncovered-items">No uncovered chapters details available</div>
                                  )}
                                </div>
                              </div>
                            )}
                            
                            {bookCoverage.uncoveredSections > 0 && (
                              <div className="uncovered-category">
                                <h6 className="uncovered-category-title">
                                  📄 Not Covered Sections ({bookCoverage.uncoveredSections})
                                </h6>
                                <div className="uncovered-items-list">
                                  {bookCoverage.uncoveredSectionsDetails && bookCoverage.uncoveredSectionsDetails.length > 0 ? (
                                    bookCoverage.uncoveredSectionsDetails.map((section, idx) => (
                                      <div key={idx} className="uncovered-item">
                                        <span className="uncovered-item-book">{section.bookTitle}</span>
                                        {section.chapterTitle && (
                                          <span className="uncovered-item-chapter">→ {section.chapterTitle}</span>
                                        )}
                                        <span className="uncovered-item-title">{section.sectionTitle}</span>
                                      </div>
                                    ))
                                  ) : (
                                    <div className="no-uncovered-items">No uncovered sections details available</div>
                                  )}
                                </div>
                              </div>
                            )}
                            
                            {bookCoverage.uncoveredObjectives > 0 && (
                              <div className="uncovered-category">
                                <h6 className="uncovered-category-title">
                                  🎯 Not Covered Objectives ({bookCoverage.uncoveredObjectives})
                                </h6>
                                <div className="uncovered-items-list">
                                  {bookCoverage.uncoveredObjectivesDetails && bookCoverage.uncoveredObjectivesDetails.length > 0 ? (
                                    bookCoverage.uncoveredObjectivesDetails.map((objective, idx) => (
                                      <div key={idx} className="uncovered-item objective-item">
                                        <span className="uncovered-item-text">{objective.objectiveText}</span>
                                      </div>
                                    ))
                                  ) : (
                                    <div className="no-uncovered-items">No uncovered objectives details available</div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        <div className="book-coverage-progress">
                          <div 
                            className="coverage-progress-bar" 
                            style={{ 
                              width: `${bookCoverage.coverage}%`,
                              backgroundColor: bookCoverage.coverage >= 70 ? '#48bb78' : 
                                             bookCoverage.coverage >= 40 ? '#ed8936' : '#f56565'
                            }}
                          />
                    </div>
                      </div>
                    );
                  })()}
                  
                  {/* Performance label */}
                  <div className="course-performance-label">
                    {getPerformanceLabel(coursePred.predicted_score)}
                      </div>
                  
                  {/* Metrics Toggle Button */}
                  <button
                    className="metrics-toggle-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedMetrics(prev => ({
                        ...prev,
                        [`course-${coursePred.course_id}`]: !prev[`course-${coursePred.course_id}`]
                      }));
                    }}
                  >
                    {expandedMetrics[`course-${coursePred.course_id}`] ? '📉 Hide' : '📊 View'} All Metrics
                  </button>
                  
                  {/* Comprehensive Metrics Section */}
                  {expandedMetrics[`course-${coursePred.course_id}`] && (() => {
                    const metrics = calculateCourseMetrics(coursePred);
                    return (
                      <div className="comprehensive-metrics">
                        <h6 className="metrics-title">📈 Comprehensive Metrics</h6>
                        <div className="metrics-grid">
                          <div className="metric-item">
                            <span className="metric-label">Score Trend:</span>
                            <span className={`metric-value trend-${metrics.scoreTrend}`}>
                              {metrics.scoreTrend === 'improving' ? '📈 Improving' : 
                               metrics.scoreTrend === 'declining' ? '📉 Declining' : '➡️ Stable'}
                            </span>
                                </div>
                          <div className="metric-item">
                            <span className="metric-label">Risk Level:</span>
                            <span className={`metric-value risk-${metrics.riskLevel}`}>
                              {metrics.riskLevel === 'high' ? '🔴 High' : 
                               metrics.riskLevel === 'medium' ? '🟡 Medium' : '🟢 Low'}
                            </span>
                              </div>
                          <div className="metric-item">
                            <span className="metric-label">Avg Questions Correct:</span>
                            <span className="metric-value">{metrics.averageCorrect.toFixed(1)}</span>
                          </div>
                          <div className="metric-item">
                            <span className="metric-label">Avg Questions Total:</span>
                            <span className="metric-value">{metrics.averageTotal.toFixed(1)}</span>
                          </div>
                          {metrics.firstAttemptDate && (
                            <div className="metric-item">
                              <span className="metric-label">First Attempt:</span>
                              <span className="metric-value">{formatDate(metrics.firstAttemptDate)}</span>
                        </div>
                      )}
                          {metrics.lastAttemptDate && (
                            <div className="metric-item">
                              <span className="metric-label">Last Attempt:</span>
                              <span className="metric-value">{formatDate(metrics.lastAttemptDate)}</span>
                    </div>
                          )}
                          {metrics.timeSpan !== null && (
                            <div className="metric-item">
                              <span className="metric-label">Time Span:</span>
                              <span className="metric-value">{metrics.timeSpan} days</span>
                      </div>
                          )}
                                </div>
                              </div>
                            );
                  })()}
                        </div>
                
                {/* Recommendations removed - now shown in modal */}
              </div>
              ))
            ) : (
              <div className="no-results-message">
                <p>No courses found matching "{courseSearchQuery}"</p>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* Student Predictions Section */}
      {(allCoursePredictions.length > 0 || allStudentPredictions.length > 0) && (
        <div className="student-predictions-section">
          <h4 className="section-title">👥 Student Predictions (Personalized)</h4>
          
          {/* Student Selection Dropdown for Chart */}
          <div className="chart-course-selector">
            <label htmlFor="student-chart-select" style={{ marginRight: '10px', fontWeight: '600', color: '#333' }}>
              Select Student for Chart:
            </label>
            <select
              id="student-chart-select"
              value={selectedStudentForChart || ''}
              onChange={(e) => setSelectedStudentForChart(e.target.value || null)}
              style={{
                padding: '8px 12px',
                borderRadius: '8px',
                border: '2px solid #667eea',
                fontSize: '0.95em',
                backgroundColor: '#ffffff',
                color: '#333',
                cursor: 'pointer',
                minWidth: '250px'
              }}
            >
              <option value="">-- Select a Student --</option>
              {allStudentPredictions.map(studentPred => (
                <option key={studentPred.user_id} value={studentPred.user_id}>
                  {studentPred.user_name || studentPred.user_email || 'Unknown Student'}
                </option>
              ))}
            </select>
          </div>
          
          {/* Progress Chart for Student Predictions - X,Y Graph (Date/Time vs Confidence Score) */}
          {/* NOTE: This chart is completely independent of studentSearchQuery - it only uses allStudentPredictions and selectedStudentForChart */}
          <div className="student-predictions-chart">
            <div className="chart-container">
              {(() => {
                // Filter to selected student for chart (or all if none selected)
                // IMPORTANT: Uses allStudentPredictions (NOT studentPredictions) to be independent of search
                const studentsForChart = selectedStudentForChart
                  ? allStudentPredictions.filter(sp => sp.user_id === selectedStudentForChart)
                  : allStudentPredictions;
                
                // Collect actual confidence scores and predicted confidence scores
                // Use allCoursePredictions (not displayCoursePredictions) to be independent of course search
                const actualConfidencePoints = [];
                const predictedConfidencePoints = [];
                
                allCoursePredictions.forEach(coursePred => {
                  if (coursePred.attempts && coursePred.attempts.length > 0) {
                    coursePred.attempts.forEach(attempt => {
                      if (attempt.attempted_at && attempt.user_id) {
                        // Find the student prediction for this user (must be in studentsForChart)
                        const studentPred = studentsForChart.find(s => s.user_id === attempt.user_id);
                        if (studentPred) {
                          // Calculate predicted confidence score from confidence interval
                          const intervalWidth = studentPred.confidence_interval 
                            ? studentPred.confidence_interval[1] - studentPred.confidence_interval[0]
                            : 20;
                          const predictedConfidence = Math.max(0, 100 - intervalWidth);
                          
                          // Calculate actual confidence based on how close actual score is to predicted
                          const actualScore = attempt.score || 0;
                          const predictedScore = studentPred.predicted_score || 0;
                          const scoreDiff = Math.abs(actualScore - predictedScore);
                          // Confidence decreases as difference increases (max difference = 100)
                          const actualConfidence = Math.max(0, 100 - scoreDiff);
                          
                          actualConfidencePoints.push({
                            date: new Date(attempt.attempted_at),
                            confidence: actualConfidence,
                            student_name: studentPred.user_name,
                            user_id: attempt.user_id
                          });
                          
                          predictedConfidencePoints.push({
                            date: new Date(attempt.attempted_at),
                            confidence: predictedConfidence,
                            student_name: studentPred.user_name,
                            user_id: attempt.user_id
                          });
                        }
                      }
                    });
                  }
                });

                // Combine all data points for range calculation
                const allPoints = [...actualConfidencePoints, ...predictedConfidencePoints];
                
                // Sort by date
                actualConfidencePoints.sort((a, b) => a.date - b.date);
                predictedConfidencePoints.sort((a, b) => a.date - b.date);
                
                // Limit to reasonable number of points for display (same limit for both)
                const maxPoints = 50;
                let displayActualPoints = actualConfidencePoints.slice(-maxPoints);
                let displayPredictedPoints = predictedConfidencePoints.slice(-maxPoints);
                
                // Use dummy data if no real data available
                let usingDummyData = false;
                if (allPoints.length === 0) {
                  usingDummyData = true;
                  // Generate dummy data points for the last 30 days
                  // Use deterministic values (based on index) instead of Math.random() to prevent chart changes on re-render
                  const today = new Date();
                  const studentNames = ['John Doe', 'Jane Smith', 'Mike Johnson', 'Sarah Williams', 'David Brown'];
                  const predictedConf = 85; // Fixed predicted confidence for dummy data
                  for (let i = 29; i >= 0; i--) {
                    const date = new Date(today);
                    date.setDate(date.getDate() - i);
                    // Deterministic actual confidence score based on index (70-95 range)
                    const actualConf = 70 + ((i * 7) % 26); // Deterministic value based on index
                    const studentName = studentNames[i % studentNames.length]; // Deterministic student name based on index
                    
                    displayActualPoints.push({
                      date: date,
                      confidence: actualConf,
                      student_name: studentName,
                      user_id: `dummy-${i}`
                    });
                    
                    displayPredictedPoints.push({
                      date: date,
                      confidence: predictedConf,
                      student_name: studentName,
                      user_id: `dummy-${i}`
                    });
                  }
                }

                // Calculate date range from all points
                const allDates = allPoints.length > 0 
                  ? allPoints.map(p => p.date).sort((a, b) => a - b)
                  : displayActualPoints.map(p => p.date).sort((a, b) => a - b);
                const minDate = allDates[0];
                const maxDate = allDates[allDates.length - 1];
                const dateRange = maxDate - minDate || 1;
                
                // Calculate confidence range
                const allConfidences = allPoints.length > 0
                  ? allPoints.map(p => p.confidence).filter(c => c !== undefined)
                  : [...displayActualPoints, ...displayPredictedPoints].map(p => p.confidence).filter(c => c !== undefined);
                const minConf = Math.min(...allConfidences, 0);
                const maxConf = Math.max(...allConfidences, 100);
                const confRange = maxConf - minConf || 100;

                return (
                  <>
                    <svg className="chart-svg" viewBox="0 0 800 420" preserveAspectRatio="xMidYMid meet">
                      {/* Y-axis label */}
                      <text
                        x="25"
                        y="200"
                        fill="#000"
                        fontSize="14"
                        fontWeight="600"
                        textAnchor="middle"
                        transform="rotate(-90 25 200)"
                      >
                        Confidence Score (%)
                      </text>
                      
                      {/* Y-axis labels and grid lines (Confidence Score) */}
                      {[0, 25, 50, 75, 100].map((value) => {
                        const y = 350 - ((value - minConf) / confRange) * 300;
                        if (y < 50 || y > 350) return null;
                        return (
                          <g key={value}>
                            <line
                              x1="60"
                              y1={y}
                              x2="780"
                              y2={y}
                              stroke="rgba(102, 126, 234, 0.3)"
                              strokeWidth="1"
                            />
                            <text
                              x="55"
                              y={y + 5}
                              fill="#000"
                              fontSize="12"
                              textAnchor="end"
                              fontWeight="600"
                            >
                              {value}%
                            </text>
                          </g>
                        );
                      })}
                      
                      {/* X-axis labels (Date/Time) */}
                      {(() => {
                        const numLabels = 8;
                        const labels = [];
                        for (let i = 0; i < numLabels; i++) {
                          const ratio = i / (numLabels - 1);
                          const date = new Date(minDate.getTime() + dateRange * ratio);
                          const x = 80 + (ratio * 700);
                          labels.push({ x, date });
                        }
                        return labels.map((label, idx) => (
                          <text
                            key={idx}
                            x={label.x}
                            y="390"
                            fill="#333"
                            fontSize="10"
                            textAnchor="middle"
                            transform={`rotate(-45 ${label.x} 390)`}
                            fontWeight="500"
                          >
                            {formatChartDate(label.date)}
                          </text>
                        ));
                      })()}
                      
                      {/* X-axis line */}
                      <line
                        x1="60"
                        y1="350"
                        x2="780"
                        y2="350"
                        stroke="#667eea"
                        strokeWidth="2"
                      />
                      
                      {/* Y-axis line */}
                      <line
                        x1="60"
                        y1="50"
                        x2="60"
                        y2="350"
                        stroke="#667eea"
                        strokeWidth="2"
                      />
                      
                      {/* Predicted Confidence Score line and points */}
                      {displayPredictedPoints.map((point, index) => {
                        const x = 80 + ((point.date - minDate) / dateRange) * 700;
                        const y = 350 - ((point.confidence - minConf) / confRange) * 300;
                        
                        // Draw line connecting to previous point
                        if (index > 0) {
                          const prevPoint = displayPredictedPoints[index - 1];
                          const prevX = 80 + ((prevPoint.date - minDate) / dateRange) * 700;
                          const prevY = 350 - ((prevPoint.confidence - minConf) / confRange) * 300;
                          
                          return (
                            <g key={`predicted-line-${index}`}>
                              <line
                                x1={prevX}
                                y1={prevY}
                                x2={x}
                                y2={y}
                                stroke="#667eea"
                                strokeWidth="2"
                                strokeDasharray="5,5"
                                opacity="0.7"
                              />
                              <circle
                                cx={x}
                                cy={y}
                                r="5"
                                fill="#667eea"
                                stroke="#667eea"
                                strokeWidth="2"
                                opacity="0.8"
                              />
                              <title>{point.student_name}: {point.confidence.toFixed(1)}% predicted confidence on {formatChartDate(point.date)}</title>
                            </g>
                          );
                        }
                        
                        return (
                          <g key={`predicted-point-${index}`}>
                            <circle
                              cx={x}
                              cy={y}
                              r="5"
                              fill="#667eea"
                              stroke="#667eea"
                              strokeWidth="2"
                              opacity="0.8"
                            />
                            <title>{point.student_name}: {point.confidence.toFixed(1)}% predicted confidence on {formatChartDate(point.date)}</title>
                          </g>
                        );
                      })}
                      
                      {/* Actual Confidence Score line and points */}
                      {displayActualPoints.map((point, index) => {
                        const x = 80 + ((point.date - minDate) / dateRange) * 700;
                        const y = 350 - ((point.confidence - minConf) / confRange) * 300;
                        const color = getScoreColor(point.confidence);
                        
                        // Draw line connecting to previous point
                        if (index > 0) {
                          const prevPoint = displayActualPoints[index - 1];
                          const prevX = 80 + ((prevPoint.date - minDate) / dateRange) * 700;
                          const prevY = 350 - ((prevPoint.confidence - minConf) / confRange) * 300;
                          
                          return (
                            <g key={`actual-line-${index}`}>
                              <line
                                x1={prevX}
                                y1={prevY}
                                x2={x}
                                y2={y}
                                stroke={color}
                                strokeWidth="2"
                                opacity="0.7"
                              />
                              <circle
                                cx={x}
                                cy={y}
                                r="5"
                                fill={color}
                                stroke="#667eea"
                                strokeWidth="2"
                              />
                              <title>{point.student_name}: {point.confidence.toFixed(1)}% actual confidence on {formatChartDate(point.date)}</title>
                            </g>
                          );
                        }
                        
                        return (
                          <g key={`actual-point-${index}`}>
                            <circle
                              cx={x}
                              cy={y}
                              r="5"
                              fill={color}
                              stroke="#667eea"
                              strokeWidth="2"
                            />
                            <title>{point.student_name}: {point.confidence.toFixed(1)}% actual confidence on {formatChartDate(point.date)}</title>
                          </g>
                        );
                      })}
                      
                      {/* Legend for Predicted line */}
                      {displayPredictedPoints.length > 0 && (() => {
                        const lastPoint = displayPredictedPoints[displayPredictedPoints.length - 1];
                        const x = 80 + ((lastPoint.date - minDate) / dateRange) * 700;
                        const y = 350 - ((lastPoint.confidence - minConf) / confRange) * 300;
                        
                        return (
                          <text
                            x={x + 10}
                            y={y}
                            fill="#667eea"
                            fontSize="11"
                            fontWeight="600"
                            dominantBaseline="middle"
                          >
                            Predicted
                          </text>
                        );
                      })()}
                      
                      {/* Legend for Actual line */}
                      {displayActualPoints.length > 0 && (() => {
                        const lastPoint = displayActualPoints[displayActualPoints.length - 1];
                        const x = 80 + ((lastPoint.date - minDate) / dateRange) * 700;
                        const y = 350 - ((lastPoint.confidence - minConf) / confRange) * 300;
                        const color = getScoreColor(lastPoint.confidence);
                        
                        return (
                          <text
                            x={x + 10}
                            y={y + 15}
                            fill={color}
                            fontSize="11"
                            fontWeight="600"
                            dominantBaseline="middle"
                          >
                            Actual
                          </text>
                        );
                      })()}
                    </svg>
                  </>
                );
              })()}
              
              {/* Chart labels - always show (either real or dummy data will be displayed) */}
              <div className="chart-labels">
                <div className="chart-x-label">Date</div>
              </div>
            </div>
          </div>

          {/* Search input below chart */}
          <div className="course-search-container">
            <input
              type="text"
              className="course-search-input"
              placeholder="🔍 Search students by name, email, or score (e.g., >80, <60, 70-90)..."
              value={studentSearchQuery}
              onChange={(e) => setStudentSearchQuery(e.target.value)}
            />
          </div>
          
          <div className="student-predictions-grid">
            {studentPredictions.length > 0 ? (
              studentPredictions.map((studentPred) => (
              <div 
                key={studentPred.user_id} 
                className="student-prediction-card"
                style={{
                  borderLeft: `4px solid ${getScoreColor(studentPred.predicted_score)}`,
                  cursor: 'pointer'
                }}
                onClick={() => handleOpenRecommendations('student', studentPred.user_id, studentPred.user_name || studentPred.user_email || 'Unknown Student')}
              >
                <div className="student-prediction-header">
                  <h5 className="student-name">{studentPred.user_name}</h5>
                  <div className="student-header-right">
                    <div 
                      className="student-prediction-score"
                      style={{ color: getScoreColor(studentPred.predicted_score) }}
                    >
                      {studentPred.predicted_score}%
                    </div>
                    <button
                      className={`boost-button ${boostedStudents.has(studentPred.user_id) ? 'boosted' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleBoostStudent(studentPred.user_id);
                      }}
                      title={boostedStudents.has(studentPred.user_id) ? 'Unboost student' : 'Boost student'}
                    >
                      {boostedStudents.has(studentPred.user_id) ? '🚀' : '⚡'}
                    </button>
                    <button
                      className="recommendations-button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenRecommendations('student', studentPred.user_id, studentPred.user_name || studentPred.user_email || 'Unknown Student');
                      }}
                      title="View Recommended Materials"
                    >
                      📚
                    </button>
                  </div>
                </div>
                
                {/* Progress bar for student */}
                <div className="student-prediction-progress">
                  <div 
                    className="progress-bar" 
                    style={{ 
                      width: `${Math.min(studentPred.predicted_score, 100)}%`,
                      backgroundColor: getScoreColor(studentPred.predicted_score)
                    }}
                  />
                </div>

                <div className="student-prediction-body">
                  {studentPred.confidence_interval && (
                    <div className="student-prediction-range">
                      <span className="range-label">Range:</span>
                      <span className="range-value">
                        {studentPred.confidence_interval[0]}% - {studentPred.confidence_interval[1]}%
                      </span>
                    </div>
                  )}
                  <div className="student-prediction-stats">
                    <span>📚 {studentPred.total_courses} course{studentPred.total_courses !== 1 ? 's' : ''}</span>
                    <span> • 📝 {studentPred.total_attempts} attempt{studentPred.total_attempts !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="student-prediction-stats-detail">
                    <span>Highest: {Math.round(studentPred.highest_score)}%</span>
                    <span> • Lowest: {Math.round(studentPred.lowest_score)}%</span>
                  </div>
                  {/* Pass/Fail Probability */}
                  {(() => {
                    const { passProbability, failProbability } = calculatePassFailProbability(
                      studentPred.predicted_score,
                      studentPred.confidence_interval
                    );
                    return (
                      <div className="pass-fail-probability">
                        <div className="probability-row">
                          <span className="probability-label">✅ Pass:</span>
                          <span className="probability-value pass" style={{ color: '#48bb78' }}>
                            {passProbability}%
                          </span>
                        </div>
                        <div className="probability-row">
                          <span className="probability-label">❌ Fail:</span>
                          <span className="probability-value fail" style={{ color: '#f56565' }}>
                            {failProbability}%
                          </span>
                        </div>
                      </div>
                    );
                  })()}
                  <div className="student-performance-label">
                    {getPerformanceLabel(studentPred.predicted_score)}
                  </div>
                  
                  {/* Metrics Toggle Button */}
                  <button
                    className="metrics-toggle-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedMetrics(prev => ({
                        ...prev,
                        [`student-${studentPred.user_id}`]: !prev[`student-${studentPred.user_id}`]
                      }));
                    }}
                  >
                    {expandedMetrics[`student-${studentPred.user_id}`] ? '📉 Hide' : '📊 View'} All Metrics
                  </button>
                  
                  {/* Comprehensive Metrics Section */}
                  {expandedMetrics[`student-${studentPred.user_id}`] && (() => {
                    const metrics = calculateStudentMetrics(studentPred, allCoursePredictions);
                    return (
                      <div className="comprehensive-metrics">
                        <h6 className="metrics-title">📈 Comprehensive Metrics</h6>
                        <div className="metrics-grid">
                          <div className="metric-item">
                            <span className="metric-label">Score Trend:</span>
                            <span className={`metric-value trend-${metrics.scoreTrend}`}>
                              {metrics.scoreTrend === 'improving' ? '📈 Improving' : 
                               metrics.scoreTrend === 'declining' ? '📉 Declining' : '➡️ Stable'}
                            </span>
                          </div>
                          <div className="metric-item">
                            <span className="metric-label">Overall Accuracy:</span>
                            <span className="metric-value">{Math.round(studentPred.overall_accuracy)}%</span>
                          </div>
                          <div className="metric-item">
                            <span className="metric-label">Risk Level:</span>
                            <span className={`metric-value risk-${metrics.riskLevel}`}>
                              {metrics.riskLevel === 'high' ? '🔴 High' : 
                               metrics.riskLevel === 'medium' ? '🟡 Medium' : '🟢 Low'}
                            </span>
                          </div>
                          <div className="metric-item">
                            <span className="metric-label">Engagement Level:</span>
                            <span className={`metric-value engagement-${metrics.engagementLevel}`}>
                              {metrics.engagementLevel === 'high' ? '🟢 High' : 
                               metrics.engagementLevel === 'medium' ? '🟡 Medium' : '🔴 Low'}
                            </span>
                          </div>
                          <div className="metric-item">
                            <span className="metric-label">Avg Questions Correct:</span>
                            <span className="metric-value">{metrics.averageCorrect.toFixed(1)}</span>
                          </div>
                          <div className="metric-item">
                            <span className="metric-label">Avg Questions Total:</span>
                            <span className="metric-value">{metrics.averageTotal.toFixed(1)}</span>
                          </div>
                          {metrics.firstAttemptDate && (
                            <div className="metric-item">
                              <span className="metric-label">First Attempt:</span>
                              <span className="metric-value">{formatDate(metrics.firstAttemptDate)}</span>
                            </div>
                          )}
                          {metrics.lastAttemptDate && (
                            <div className="metric-item">
                              <span className="metric-label">Last Attempt:</span>
                              <span className="metric-value">{formatDate(metrics.lastAttemptDate)}</span>
                            </div>
                          )}
                          {metrics.timeSpan !== null && (
                            <div className="metric-item">
                              <span className="metric-label">Time Span:</span>
                              <span className="metric-value">{metrics.timeSpan} days</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
                
                {/* Recommendations removed - now shown in modal */}
                    </div>
              ))
            ) : (
              <div className="no-results-message">
                <p>No students found matching "{studentSearchQuery}"</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Overall prediction as summary (optional, shown if available) */}
      {prediction && !loading && coursePredictions.length > 0 && (
        <div className="overall-summary-section">
          <h4 className="section-title">📈 Overall Performance</h4>
          <div className="overall-summary">
            <div className="overall-score" style={{ color: getScoreColor(prediction.predicted_score) }}>
              {prediction.predicted_score}%
            </div>
            <div className="overall-label">{getPerformanceLabel(prediction.predicted_score)}</div>
          </div>
        </div>
      )}

      {error && !loading && !loadingCourses && coursePredictions.length === 0 && (
        <div className="dashboard-error">
          <p>⚠️ {error}</p>
          {error.includes('Model not') && (
            <p className="help-text">
              The prediction model needs to be trained. Contact an administrator.
            </p>
          )}
        </div>
      )}

      {/* Recommendations Modal */}
      {recommendationsModal && (() => {
        const { type, id, title } = recommendationsModal;
        const recommendations = type === 'course' 
          ? courseRecommendations[id] 
          : studentRecommendations[id];
        
        return (
          <div className="recommendations-modal-overlay" onClick={handleCloseRecommendationsModal}>
            <div className="recommendations-modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="recommendations-modal-header">
                <h3>📚 Recommended Materials - {title}</h3>
                <button className="modal-close-btn" onClick={handleCloseRecommendationsModal}>×</button>
              </div>
              
              <div className="recommendations-modal-body">
                {recommendations ? (
                  <>
                    {/* Videos */}
                    <div className="recommendations-category">
                      <div className="recommendations-category-header">
                        <span className="recommendations-category-title">🎥 Videos</span>
                        {!(addingRecommendation?.type === type && addingRecommendation?.id === id && addingRecommendation?.category === 'videos') && (
                          <button
                            className="recommendation-add-btn"
                            onClick={() => setAddingRecommendation({ type, id, category: 'videos' })}
                            title="Add video"
                          >
                            ➕ Add
                          </button>
                        )}
                      </div>
                      {(addingRecommendation?.type === type && addingRecommendation?.id === id && addingRecommendation?.category === 'videos') && (
                        <RecommendationEditForm 
                          item={{ title: '', url: '', duration: '' }}
                          category="videos"
                          onSave={(data) => handleAddRecommendation(type, id, 'videos', data)}
                          onCancel={() => setAddingRecommendation(null)}
                        />
                      )}
                      {recommendations.videos && recommendations.videos.length > 0 && (
                        <div className="recommendations-list">
                          {recommendations.videos.map((video) => {
                            const isEditing = editingRecommendation?.type === type && 
                                              editingRecommendation?.id === id && 
                                              editingRecommendation?.category === 'videos' && 
                                              editingRecommendation?.itemId === video.id;
                            
                            if (isEditing) {
                              return <RecommendationEditForm 
                                key={video.id}
                                item={video}
                                category="videos"
                                onSave={(data) => handleUpdateRecommendation(type, id, 'videos', video.id, data)}
                                onCancel={() => setEditingRecommendation(null)}
                              />;
                            }
                            
                            return (
                              <div key={video.id} className="recommendation-item video-item">
                                <a 
                                  href={video.url} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="recommendation-link"
                                >
                                  <span className="recommendation-title">{video.title}</span>
                                  <span className="recommendation-meta">{video.duration}</span>
                                </a>
                                <div className="recommendation-actions">
                                  <button 
                                    className="recommendation-edit-btn"
                                    onClick={() => setEditingRecommendation({ type, id, category: 'videos', itemId: video.id })}
                                    title="Edit"
                                  >
                                    ✏️
                                  </button>
                                  <button 
                                    className="recommendation-delete-btn"
                                    onClick={() => handleDeleteRecommendation(type, id, 'videos', video.id)}
                                    title="Delete"
                                  >
                                    🗑️
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    
                    {/* Blogs */}
                    <div className="recommendations-category">
                      <div className="recommendations-category-header">
                        <span className="recommendations-category-title">📝 Blogs</span>
                        {!(addingRecommendation?.type === type && addingRecommendation?.id === id && addingRecommendation?.category === 'blogs') && (
                          <button
                            className="recommendation-add-btn"
                            onClick={() => setAddingRecommendation({ type, id, category: 'blogs' })}
                            title="Add blog"
                          >
                            ➕ Add
                          </button>
                        )}
                      </div>
                      {(addingRecommendation?.type === type && addingRecommendation?.id === id && addingRecommendation?.category === 'blogs') && (
                        <RecommendationEditForm 
                          item={{ title: '', url: '', readTime: '' }}
                          category="blogs"
                          onSave={(data) => handleAddRecommendation(type, id, 'blogs', data)}
                          onCancel={() => setAddingRecommendation(null)}
                        />
                      )}
                      {recommendations.blogs && recommendations.blogs.length > 0 && (
                        <div className="recommendations-list">
                          {recommendations.blogs.map((blog) => {
                            const isEditing = editingRecommendation?.type === type && 
                                              editingRecommendation?.id === id && 
                                              editingRecommendation?.category === 'blogs' && 
                                              editingRecommendation?.itemId === blog.id;
                            
                            if (isEditing) {
                              return <RecommendationEditForm 
                                key={blog.id}
                                item={blog}
                                category="blogs"
                                onSave={(data) => handleUpdateRecommendation(type, id, 'blogs', blog.id, data)}
                                onCancel={() => setEditingRecommendation(null)}
                              />;
                            }
                            
                            return (
                              <div key={blog.id} className="recommendation-item blog-item">
                                <a 
                                  href={blog.url} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="recommendation-link"
                                >
                                  <span className="recommendation-title">{blog.title}</span>
                                  <span className="recommendation-meta">{blog.readTime}</span>
                                </a>
                                <div className="recommendation-actions">
                                  <button 
                                    className="recommendation-edit-btn"
                                    onClick={() => setEditingRecommendation({ type, id, category: 'blogs', itemId: blog.id })}
                                    title="Edit"
                                  >
                                    ✏️
                                  </button>
                                  <button 
                                    className="recommendation-delete-btn"
                                    onClick={() => handleDeleteRecommendation(type, id, 'blogs', blog.id)}
                                    title="Delete"
                                  >
                                    🗑️
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    
                    {/* Course Materials */}
                    <div className="recommendations-category">
                      <div className="recommendations-category-header">
                        <span className="recommendations-category-title">📄 Course Materials</span>
                        {!(addingRecommendation?.type === type && addingRecommendation?.id === id && addingRecommendation?.category === 'courseMaterials') && (
                          <button
                            className="recommendation-add-btn"
                            onClick={() => setAddingRecommendation({ type, id, category: 'courseMaterials' })}
                            title="Add course material"
                          >
                            ➕ Add
                          </button>
                        )}
                      </div>
                      {(addingRecommendation?.type === type && addingRecommendation?.id === id && addingRecommendation?.category === 'courseMaterials') && (
                        <RecommendationEditForm 
                          item={{ title: '', url: '', format: '' }}
                          category="courseMaterials"
                          onSave={(data) => handleAddRecommendation(type, id, 'courseMaterials', data)}
                          onCancel={() => setAddingRecommendation(null)}
                        />
                      )}
                      {recommendations.courseMaterials && recommendations.courseMaterials.length > 0 && (
                        <div className="recommendations-list">
                          {recommendations.courseMaterials.map((material) => {
                            const isEditing = editingRecommendation?.type === type && 
                                              editingRecommendation?.id === id && 
                                              editingRecommendation?.category === 'courseMaterials' && 
                                              editingRecommendation?.itemId === material.id;
                            
                            if (isEditing) {
                              return <RecommendationEditForm 
                                key={material.id}
                                item={material}
                                category="courseMaterials"
                                onSave={(data) => handleUpdateRecommendation(type, id, 'courseMaterials', material.id, data)}
                                onCancel={() => setEditingRecommendation(null)}
                              />;
                            }
                            
                            return (
                              <div key={material.id} className="recommendation-item material-item">
                                <a 
                                  href={material.url} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="recommendation-link"
                                >
                                  <span className="recommendation-title">{material.title}</span>
                                  <span className="recommendation-meta">{material.format}</span>
                                </a>
                                <div className="recommendation-actions">
                                  <button 
                                    className="recommendation-edit-btn"
                                    onClick={() => setEditingRecommendation({ type, id, category: 'courseMaterials', itemId: material.id })}
                                    title="Edit"
                                  >
                                    ✏️
                                  </button>
                                  <button 
                                    className="recommendation-delete-btn"
                                    onClick={() => handleDeleteRecommendation(type, id, 'courseMaterials', material.id)}
                                    title="Delete"
                                  >
                                    🗑️
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </>
            ) : (
                  <div className="no-recommendations-message">
                    <p>No recommendations available yet. Click the 📚 button to load recommendations.</p>
              </div>
            )}
          </div>
        </div>
            </div>
        );
      })()}

    </div>
  );
}

export default PerformanceDashboard;
