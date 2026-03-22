import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';
import CourseList from './components/CourseList';
import CourseDetails from './components/CourseDetails';
import BookList from './components/BookList';
import UploadedBooksList from './components/UploadedBooksList';
import BookSearch from './components/BookSearch';
import BookDetails from './components/BookDetails';
import BookModal from './components/BookModal';
import SectionModal from './components/SectionModal';
import CreateAssessment from './components/CreateAssessment';
import AssessmentList from './components/AssessmentList';
import AssessmentViewer from './components/AssessmentViewer';
import BookUpload from './components/BookUpload';
import CourseCreation from './components/CourseCreation';
import ConfirmationDialog from './components/ConfirmationDialog';
import Login from './components/Login';
import Loading from './components/Loading';
import PerformanceDashboard from './components/PerformanceDashboard';
import AttemptDetailsPage from './components/AttemptDetailsPage';
import StudentRecommendations from './components/StudentRecommendations';
import FeedbackForm from './components/FeedbackForm';
import { staticBooks } from './data/books';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [authToken, setAuthToken] = useState(null);
  const [uploadedBooks, setUploadedBooks] = useState([]);
  const [createdCourses, setCreatedCourses] = useState([]);
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [selectedBook, setSelectedBook] = useState(null);
  const [selectedBookForModal, setSelectedBookForModal] = useState(null);
  const [selectedSection, setSelectedSection] = useState(null);
  const [assessments, setAssessments] = useState([]);
  const [showCreateAssessment, setShowCreateAssessment] = useState(false);
  const [assessmentSource, setAssessmentSource] = useState(null);
  const [selectedAssessment, setSelectedAssessment] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [uploadProgress, setUploadProgress] = useState({
    isUploading: false,
    message: '',
    error: null,
    success: false,
    uploadingBookId: null
  });
  const [showAssessments, setShowAssessments] = useState(false);
  const [showBookUpload, setShowBookUpload] = useState(false);
  const [showCourseCreation, setShowCourseCreation] = useState(false);
  const [bookSearchQuery, setBookSearchQuery] = useState('');
  const [uploadedBookSearchQuery, setUploadedBookSearchQuery] = useState('');
  const [archivedCourseIds, setArchivedCourseIds] = useState([]);
  const [showArchivedCourses, setShowArchivedCourses] = useState(false);
  const [confirmationDialog, setConfirmationDialog] = useState({
    isOpen: false,
    title: '',
    message: '',
    type: 'archive',
    onConfirm: null,
    courseId: null,
    assessmentId: null
  });
  const [logoutDialog, setLogoutDialog] = useState({
    isOpen: false
  });
  const [attemptDetailsCourse, setAttemptDetailsCourse] = useState(null);
  const [showPerformancePrediction, setShowPerformancePrediction] = useState(false);
  const [showStudentRecommendations, setShowStudentRecommendations] = useState(false);
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);

  // Combine static and uploaded books
  const allBooks = [...staticBooks, ...uploadedBooks];
  
  // Filter books based on search query
  const filterBooks = (booksList, query) => {
    if (!query.trim()) return booksList;
    const lowerQuery = query.toLowerCase();
    return booksList.filter(book => 
      book.title?.toLowerCase().includes(lowerQuery) ||
      book.project_name?.toLowerCase().includes(lowerQuery) ||
      book.description?.toLowerCase().includes(lowerQuery) ||
      book.filename?.toLowerCase().includes(lowerQuery)
    );
  };

  const books = filterBooks(allBooks, bookSearchQuery);
  const filteredUploadedBooks = filterBooks(uploadedBooks, uploadedBookSearchQuery);
  
  // Use only dynamic courses (no static/mock data)
  const allCourses = createdCourses;
  
  // Filter courses by archive status
  const activeCourses = allCourses.filter(course => !archivedCourseIds.includes(course.id));
  const archivedCourses = allCourses.filter(course => archivedCourseIds.includes(course.id));
  
  // Show active or archived courses based on toggle
  const courses = showArchivedCourses ? archivedCourses : activeCourses;
  
  // Archive/unarchive handlers
  const handleArchiveCourse = (courseId, e) => {
    if (e && e.stopPropagation) {
      e.stopPropagation(); // Prevent course click
    }
    
    // Find course to get title for confirmation
    const allCoursesList = createdCourses;
    const course = allCoursesList.find(c => c.id === courseId);
    const courseTitle = course ? course.title : 'this course';
    
    // Show confirmation dialog
    setConfirmationDialog({
      isOpen: true,
      title: 'Archive Course',
      message: `Are you sure you want to archive "${courseTitle}"?\n\nThis course will be moved to the archived section and hidden from the main view. You can unarchive it later.`,
      type: 'archive',
      onConfirm: () => {
        const updatedArchived = [...archivedCourseIds, courseId];
        setArchivedCourseIds(updatedArchived);
        localStorage.setItem('archivedCourseIds', JSON.stringify(updatedArchived));
        setConfirmationDialog(prev => ({ ...prev, isOpen: false }));
      },
      courseId: courseId
    });
  };
  
  const handleUnarchiveCourse = (courseId, e) => {
    if (e && e.stopPropagation) {
      e.stopPropagation(); // Prevent course click
    }
    
    // Find course to get title for confirmation
    const allCoursesList = createdCourses;
    const course = allCoursesList.find(c => c.id === courseId);
    const courseTitle = course ? course.title : 'this course';
    
    // Show confirmation dialog
    setConfirmationDialog({
      isOpen: true,
      title: 'Unarchive Course',
      message: `Are you sure you want to unarchive "${courseTitle}"?\n\nThis course will be moved back to the active courses section.`,
      type: 'unarchive',
      onConfirm: () => {
        const updatedArchived = archivedCourseIds.filter(id => id !== courseId);
        setArchivedCourseIds(updatedArchived);
        localStorage.setItem('archivedCourseIds', JSON.stringify(updatedArchived));
        setConfirmationDialog(prev => ({ ...prev, isOpen: false }));
      },
      courseId: courseId
    });
  };

  const handleCloseConfirmation = () => {
    setConfirmationDialog(prev => ({ ...prev, isOpen: false }));
  };

  // Load assessments from API (MongoDB is source of truth)
  const loadAssessments = async () => {
    try {
      const response = await axios.get(`${API_BASE}/assessments`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      if (response.data && Array.isArray(response.data)) {
        setAssessments(response.data);
        localStorage.setItem('assessments', JSON.stringify(response.data));
      }
    } catch (err) {
      console.error('Error loading assessments from API:', err);
      // Fallback to localStorage
      const savedAssessments = localStorage.getItem('assessments');
      if (savedAssessments) {
        try {
          setAssessments(JSON.parse(savedAssessments));
        } catch (e) {
          console.error('Error loading assessments from localStorage:', e);
        }
      }
    }
  };

  // Check authentication on mount
  useEffect(() => {
    const token = localStorage.getItem('authToken');
    const savedUser = localStorage.getItem('user');
    
    if (token && savedUser) {
      try {
        setAuthToken(token);
        setUser(JSON.parse(savedUser));
        setIsAuthenticated(true);
      } catch (e) {
        console.error('Error loading user from localStorage:', e);
        localStorage.removeItem('authToken');
        localStorage.removeItem('user');
      }
    }
  }, []);

  // Load uploaded books and courses from backend API and localStorage on mount
  useEffect(() => {
    if (!isAuthenticated) return;

    // Load from backend API
    const loadUploadedBooks = async () => {
      try {
        // Try the v1 API endpoint first (matching the upload endpoint pattern)
        let response;
        try {
          response = await axios.get(`http://127.0.0.1:5000/api/books/uploaded`, {
            headers: {
              'Authorization': `Bearer ${authToken}`
            }
          });
        } catch (v1Err) {
          // Fallback to the regular API endpoint
          response = await axios.get(`${API_BASE}/books/uploaded`, {
            headers: {
              'Authorization': `Bearer ${authToken}`
            }
          });
        }
        
        // Update the book list regardless of whether it's empty or not
        if (response.data) {
          setUploadedBooks(Array.isArray(response.data) ? response.data : []);
          localStorage.setItem('uploadedBooks', JSON.stringify(Array.isArray(response.data) ? response.data : []));
        }
      } catch (err) {
        console.error('Error loading uploaded books from API:', err);
        // Fallback to localStorage
        const savedBooks = localStorage.getItem('uploadedBooks');
        if (savedBooks) {
          try {
            setUploadedBooks(JSON.parse(savedBooks));
          } catch (e) {
            console.error('Error loading uploaded books from localStorage:', e);
          }
        }
      }
    };

    loadUploadedBooks();

    // Load courses from API (MongoDB is source of truth)
    const loadCourses = async () => {
      try {
        const response = await axios.get(`${API_BASE}/courses`, {
          headers: {
            'Authorization': `Bearer ${authToken}`
          }
        });
        if (response.data && response.data.length > 0) {
          setCreatedCourses(response.data);
          localStorage.setItem('createdCourses', JSON.stringify(response.data));
        }
      } catch (err) {
        console.error('Error loading courses from API:', err);
        // Fallback to localStorage
        const savedCourses = localStorage.getItem('createdCourses');
        if (savedCourses) {
          try {
            setCreatedCourses(JSON.parse(savedCourses));
          } catch (e) {
            console.error('Error loading courses from localStorage:', e);
          }
        }
      }
    };

    loadCourses();

    // Load assessments from API (MongoDB is source of truth)
    const loadAssessmentsInEffect = async () => {
      await loadAssessments();
    };
    loadAssessmentsInEffect();

    // Load archived course IDs from localStorage
    const savedArchived = localStorage.getItem('archivedCourseIds');
    if (savedArchived) {
      try {
        setArchivedCourseIds(JSON.parse(savedArchived));
      } catch (e) {
        console.error('Error loading archived courses:', e);
      }
    }
  }, [isAuthenticated, authToken]);

  // Books are now loaded from static data, no API call needed
  // useEffect(() => {
  //   loadBooks();
  // }, []);

  const handleCourseClick = (courseId) => {
    const course = courses.find(c => c.id === courseId);
    setSelectedCourse(course);
    setSelectedBook(null);
    setSelectedSection(null);
  };

  const handleBookClick = async (bookId) => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await axios.get(`${API_BASE}/books/${bookId}`);
      console.log('bookId------------------------++', response.data);
      setSelectedBookForModal(response.data);
      setLoading(false);
    } catch (err) {
      setError('Failed to load book details: ' + (err.message || 'Unknown error'));
      setLoading(false);
    }
  };

  const handleCloseBookModal = () => {
    setSelectedBookForModal(null);
  };

  const handleBackToCourses = () => {
    setSelectedCourse(null);
    setSelectedBook(null);
    setSelectedSection(null);
  };

  const handleBackToCourse = () => {
    setSelectedBook(null);
    setSelectedSection(null);
  };

  const handleSectionClick = (section) => {
    setSelectedSection(section);
  };

  const handleCloseModal = () => {
    setSelectedSection(null);
  };

  const handleCreateAssessment = (sourceData) => {
    setAssessmentSource(sourceData);
    setShowCreateAssessment(true);
  };

  const handleAssessmentCreated = async (assessmentData) => {
    // Assessment is already saved to MongoDB by the backend
    // Reload assessments from API to get the latest data (MongoDB is source of truth)
    await loadAssessments();
    setShowCreateAssessment(false);
    setAssessmentSource(null);
  };

  const handleAssessmentClick = (assessment) => {
    setSelectedAssessment(assessment);
  };

  const handleCloseAssessmentViewer = () => {
    setSelectedAssessment(null);
  };

  const handleDeleteAssessment = async (assessmentId) => {
    const assessment = assessments.find(a => a.id === assessmentId);
    const assessmentTitle = assessment ? assessment.title : 'this assessment';
    
    setConfirmationDialog({
      isOpen: true,
      title: 'Delete Assessment',
      message: `Are you sure you want to delete "${assessmentTitle}"? This action cannot be undone.`,
      type: 'delete',
      onConfirm: async () => {
        try {
          // Delete assessment from MongoDB via API
          const response = await axios.delete(`${API_BASE}/assessments/${assessmentId}`);
          
          if (response.data.success) {
            // Reload assessments from API to reflect the deletion
            await loadAssessments();
            handleCloseConfirmation();
          } else {
            console.error('Failed to delete assessment:', response.data.error);
            alert('Failed to delete assessment. Please try again.');
          }
        } catch (error) {
          console.error('Error deleting assessment:', error);
          alert('Error deleting assessment. Please try again.');
        }
      },
      assessmentId: assessmentId
    });
  };

  const handleCloseCreateAssessment = () => {
    setShowCreateAssessment(false);
    setAssessmentSource(null);
  };

  const handleBookUploaded = async (result, error) => {
    if (error) {
      // Upload failed - clear uploading state immediately
      setUploadProgress({
        isUploading: false,
        message: '',
        error: error,
        success: false,
        uploadingBookId: null
      });
      // Clear error after 5 seconds
      setTimeout(() => {
        setUploadProgress(prev => ({ ...prev, error: null }));
      }, 5000);
    } else if (result !== null && result !== undefined) {
      // Upload HTTP request completed successfully - clear uploading state immediately
      // This happens as soon as /v1/api/books/upload returns a response
      setUploadProgress({
        isUploading: false,
        message: '',
        error: null,
        success: true,
        uploadingBookId: null
      });
      
      // Upload succeeded - result contains book_id, status, etc.
      const bookId = result.book_id || result._id || result.id;
      
      // Reload books from API to get the updated list
      try {
        // Try the v1 API endpoint first (matching the upload endpoint pattern)
        let response;
        try {
          response = await axios.get(`http://127.0.0.1:5000/api/books/uploaded`, {
            headers: {
              'Authorization': `Bearer ${authToken}`
            }
          });
        } catch (v1Err) {
          // Fallback to the regular API endpoint
          response = await axios.get(`${API_BASE}/books/uploaded`, {
            headers: {
              'Authorization': `Bearer ${authToken}`
            }
          });
        }
        
        // Update the book list regardless of whether it's empty or not
        if (response.data) {
          setUploadedBooks(Array.isArray(response.data) ? response.data : []);
          localStorage.setItem('uploadedBooks', JSON.stringify(Array.isArray(response.data) ? response.data : []));
        }
      } catch (err) {
        console.error('Error reloading uploaded books after upload:', err);
        // If API call fails, add the newly uploaded book to the list as fallback
        if (result && bookId) {
          setUploadedBooks(prev => {
            // Check if book already exists in the list
            const exists = prev.some(book => (book.id === bookId || book._id === bookId || book.book_id === bookId));
            if (!exists) {
              return [...prev, result];
            }
            return prev;
          });
        }
      }
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setUploadProgress(prev => ({ ...prev, success: false }));
      }, 3000);
    } else {
      // Upload started (result and error are both null)
      setUploadProgress({
        isUploading: true,
        message: 'Uploading book...',
        error: null,
        success: false,
        uploadingBookId: null // Will be set when we get book_id from response
      });
    }
  };


  const handleCourseCreated = async (course) => {
    // Course is already saved to MongoDB by the backend
    // Reload courses from API to get the latest data (MongoDB is source of truth)
    try {
      const response = await axios.get(`${API_BASE}/courses`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      if (response.data) {
        setCreatedCourses(response.data);
        localStorage.setItem('createdCourses', JSON.stringify(response.data));
      }
    } catch (err) {
      console.error('Error reloading courses after creation:', err);
      // Fallback: add course locally
      const newCourse = {
        ...course,
        id: course.id || `course-${Date.now()}`,
        books: course.books || [],
        totalSections: course.totalSections || 0,
        projectCount: course.projectCount || 1
      };
      const updatedCourses = [...createdCourses, newCourse];
      setCreatedCourses(updatedCourses);
      localStorage.setItem('createdCourses', JSON.stringify(updatedCourses));
    }
  };

  const handleLogin = (userData, token) => {
    setUser(userData);
    setAuthToken(token);
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    setLogoutDialog({ isOpen: true });
  };

  const confirmLogout = () => {
    localStorage.removeItem('authToken');
    localStorage.removeItem('user');
    setUser(null);
    setAuthToken(null);
    setIsAuthenticated(false);
    // Reset app state
    setSelectedCourse(null);
    setSelectedBook(null);
    setSelectedSection(null);
    setShowAssessments(false);
    setShowBookUpload(false);
    setShowCourseCreation(false);
    setLogoutDialog({ isOpen: false });
  };

  const cancelLogout = () => {
    setLogoutDialog({ isOpen: false });
  };

  // Show login if not authenticated
  if (!isAuthenticated) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <div className="App">
      <div className="container">
        <header className="header">
          <div className="header-top">
            <div>
              <h1>📚 InstaPrep Platform</h1>
              <p>Active Learning along with exam preparation</p>
            </div>
            <div className="header-user">
              {user && (
                <span className="user-name">👤 {user.name || user.email}</span>
              )}
              <button 
                className="btn-logout"
                onClick={handleLogout}
                title="Logout"
              >
                🚪 Logout
              </button>
            </div>
          </div>
          <div className="header-actions">
            <button 
              className="btn-header-action"
              onClick={() => setShowBookUpload(true)}
            >
              📤 Upload Book
            </button>
            <button 
              className="btn-header-action"
              onClick={() => setShowCourseCreation(true)}
            >
              ➕ Create Course
            </button>
            {!showAssessments && (
              <button 
                className="btn-header-action"
                onClick={() => setShowArchivedCourses(!showArchivedCourses)}
              >
                {showArchivedCourses ? '📚 Active' : '📦 Archived'} Courses ({showArchivedCourses ? archivedCourses.length : activeCourses.length})
              </button>
            )}
            <button 
              className="btn-view-assessments"
              onClick={() => setShowAssessments(!showAssessments)}
            >
              {showAssessments ? '📚 Hide' : '📝 View'} Assessments ({assessments.length})
            </button>
            <button 
              className="btn-header-action btn-performance-prediction"
              onClick={() => {
                setShowPerformancePrediction(true);
                setSelectedCourse(null);
                setSelectedBook(null);
                setSelectedAssessment(null);
                setShowAssessments(false);
                setAttemptDetailsCourse(null);
                setShowStudentRecommendations(false);
              }}
            >
              📊 Performance Prediction (Adaptive/Personalized)
            </button>
            <button 
              className="btn-header-action btn-recommendations"
              onClick={() => {
                setShowStudentRecommendations(true);
                setSelectedCourse(null);
                setSelectedBook(null);
                setSelectedAssessment(null);
                setShowAssessments(false);
                setAttemptDetailsCourse(null);
                setShowPerformancePrediction(false);
              }}
            >
              📚 My Recommendations
            </button>
            <button
              className="btn-header-action btn-feedback"
              onClick={() => setShowFeedbackForm(true)}
            >
              💬 Feedback
            </button>
          </div>
        </header>

        {/* Performance Prediction Dashboard - Separate Page */}
        {showPerformancePrediction && !attemptDetailsCourse && (
          <div>
            <button 
              className="back-button" 
              onClick={() => {
                setShowPerformancePrediction(false);
                setAttemptDetailsCourse(null);
              }}
            >
              ← Back to Main
            </button>
            <PerformanceDashboard 
              user={user} 
              authToken={authToken}
              onViewAttemptDetails={(coursePred) => setAttemptDetailsCourse(coursePred)}
            />
          </div>
        )}

        {attemptDetailsCourse && (
          <AttemptDetailsPage
            courseId={attemptDetailsCourse.course_id}
            courseTitle={attemptDetailsCourse.course_title}
            user={user}
            authToken={authToken}
            onBack={() => setAttemptDetailsCourse(null)}
          />
        )}

        {/* Student Recommendations Page */}
        {showStudentRecommendations && (
          <StudentRecommendations
            user={user}
            authToken={authToken}
            onBack={() => {
              setShowStudentRecommendations(false);
            }}
          />
        )}

        {/* Main Content - Only show when NOT on Performance Prediction or Recommendations page */}
        {!showPerformancePrediction && !attemptDetailsCourse && !showStudentRecommendations && (
          <>
            {selectedCourse && !selectedBook && (
              <button className="back-button" onClick={handleBackToCourses}>
                ← Back to Courses
              </button>
            )}

            {selectedBook && (
              <button className="back-button" onClick={handleBackToCourse}>
                ← Back to {selectedCourse ? selectedCourse.title : 'Books'}
              </button>
            )}

        {error && (
          <div className="error-message">
            {error}
          </div>
        )}

        {uploadProgress.isUploading && (
          <div className="upload-progress-notification">
            <div className="upload-progress-content">
              <div className="upload-progress-spinner"></div>
              <span className="upload-progress-text">{uploadProgress.message}</span>
            </div>
          </div>
        )}

        {uploadProgress.success && (
          <div className="upload-success-notification">
            <div className="upload-success-content">
              <span className="upload-success-icon">✓</span>
              <span className="upload-success-text">Book uploaded successfully!</span>
            </div>
          </div>
        )}

        {uploadProgress.error && (
          <div className="upload-error-notification">
            <div className="upload-error-content">
              <span className="upload-error-icon">✗</span>
              <span className="upload-error-text">{uploadProgress.error}</span>
            </div>
          </div>
        )}

        {loading && (
          <Loading
            message="Loading..."
            overlay={false}
            size="medium"
          />
        )}

        {!loading && !error && !selectedCourse && !selectedBook && !showAssessments && (
          <>
            <div style={{ marginBottom: '50px' }}>
              <h2 style={{ color: 'white', marginBottom: '20px', textAlign: 'center', fontSize: '2em', fontWeight: '800', textShadow: '2px 2px 4px rgba(0, 0, 0, 0.3)' }}>
                {showArchivedCourses ? '📦 Archived' : '🎓 Active'} Courses ({courses.length})
              </h2>
              <CourseList 
                courses={courses} 
                onCourseClick={handleCourseClick}
                onArchive={handleArchiveCourse}
                onUnarchive={handleUnarchiveCourse}
                isArchived={showArchivedCourses}
                user={user}
                authToken={authToken}
              />
            </div>

            <div style={{ marginBottom: '50px', paddingTop: '30px', borderTop: '3px solid rgba(255, 255, 255, 0.3)' }}>
              {uploadedBooks.length > 0 && (
                <div style={{ marginBottom: '40px' }}>
                  <h2 style={{ color: 'white', marginBottom: '20px', textAlign: 'center', fontSize: '1.6em', fontWeight: '700', textShadow: '2px 2px 4px rgba(0, 0, 0, 0.3)' }}>
                    📚 All Books ({uploadedBooks.length})
                  </h2>
                  <BookSearch 
                    searchQuery={uploadedBookSearchQuery}
                    onSearchChange={setUploadedBookSearchQuery}
                    placeholder="Search uploaded books..."
                  />
                  {filteredUploadedBooks.length > 0 ? (
                    <UploadedBooksList books={filteredUploadedBooks} onBookClick={handleBookClick} uploadProgress={uploadProgress} />
                  ) : uploadedBookSearchQuery ? (
                    <div className="no-books" style={{ textAlign: 'center', color: 'white', padding: '40px', fontSize: '1.1em' }}>
                      No books found matching "{uploadedBookSearchQuery}"
                    </div>
                  ) : (
                    <UploadedBooksList books={uploadedBooks} onBookClick={handleBookClick} uploadProgress={uploadProgress} />
                  )}
                </div>
              )}
              
              {/* {allBooks.length > 0 && (
                <div>
                  <h2 style={{ color: 'white', marginBottom: '20px', textAlign: 'center', fontSize: '1.6em', fontWeight: '700', textShadow: '2px 2px 4px rgba(0, 0, 0, 0.3)' }}>
                    📖 All Books ({allBooks.length})
                  </h2>
                  <BookSearch 
                    searchQuery={bookSearchQuery}
                    onSearchChange={setBookSearchQuery}
                    placeholder="Search all books..."
                  />
                  {books.length > 0 ? (
                    <BookList books={books} />
                  ) : bookSearchQuery ? (
                    <div className="no-books" style={{ textAlign: 'center', color: 'white', padding: '40px', fontSize: '1.1em' }}>
                      No books found matching "{bookSearchQuery}"
                    </div>
                  ) : (
                    <BookList books={allBooks} />
                  )}
                </div>
              )} */}
            </div>
          </>
        )}

        {showAssessments && (
          <div style={{ marginBottom: '30px' }}>
            <h2 style={{ color: 'white', marginBottom: '20px', textAlign: 'center', fontSize: '2em', fontWeight: '800', textShadow: '2px 2px 4px rgba(0, 0, 0, 0.3)' }}>
              Your Assessments
            </h2>
            <AssessmentList 
              assessments={assessments}
              onAssessmentClick={handleAssessmentClick}
              onDelete={handleDeleteAssessment}
            />
          </div>
        )}

        {!loading && !error && selectedCourse && !selectedBook && (
          <CourseDetails 
            course={selectedCourse} 
            onBookClick={handleBookClick}
            onCreateAssessment={handleCreateAssessment}
            onArchive={handleArchiveCourse}
            onUnarchive={handleUnarchiveCourse}
            isArchived={archivedCourseIds.includes(selectedCourse.id)}
          />
        )}

        {!loading && !error && selectedBook && (
          <BookDetails 
            book={selectedBook} 
            onSectionClick={handleSectionClick}
            onCreateAssessment={handleCreateAssessment}
          />
        )}

        {selectedBookForModal && (
          <BookModal 
            book={selectedBookForModal} 
            onClose={handleCloseBookModal}
          />
        )}

        {selectedSection && (
          <SectionModal 
            section={selectedSection} 
            onClose={handleCloseModal}
            onCreateAssessment={handleCreateAssessment}
          />
        )}

        {showCreateAssessment && assessmentSource && (
          <CreateAssessment
            source={assessmentSource.source}
            sourceType={assessmentSource.sourceType}
            selectedSections={assessmentSource.selectedSections || []}
            onClose={handleCloseCreateAssessment}
            onCreate={handleAssessmentCreated}
          />
        )}

        {selectedAssessment && (
          <AssessmentViewer
            assessment={selectedAssessment}
            onClose={handleCloseAssessmentViewer}
            user={user}
            authToken={authToken}
          />
        )}
          </>
        )}

        {showBookUpload && (
          <BookUpload
            onClose={() => setShowBookUpload(false)}
            onBookUploaded={handleBookUploaded}
          />
        )}

        {showCourseCreation && (
          <CourseCreation
            books={uploadedBooks.filter(book => book.status !== 'pending')}
            onClose={() => setShowCourseCreation(false)}
            onCourseCreated={handleCourseCreated}
          />
        )}

        <button
          className="floating-feedback-btn"
          onClick={() => setShowFeedbackForm(true)}
          title="Share feedback"
        >
          💬 Feedback
        </button>

        {showFeedbackForm && (
          <FeedbackForm
            user={user}
            onClose={() => setShowFeedbackForm(false)}
          />
        )}

        <ConfirmationDialog
          isOpen={confirmationDialog.isOpen}
          title={confirmationDialog.title}
          message={confirmationDialog.message}
          type={confirmationDialog.type}
          confirmText={
            confirmationDialog.type === 'archive' ? 'Archive' :
            confirmationDialog.type === 'unarchive' ? 'Unarchive' :
            confirmationDialog.type === 'delete' ? 'Delete' :
            'Confirm'
          }
          cancelText="Cancel"
          onConfirm={confirmationDialog.onConfirm || (() => {})}
          onCancel={handleCloseConfirmation}
        />

        <ConfirmationDialog
          isOpen={logoutDialog.isOpen}
          title="Logout"
          message="Are you sure you want to logout? You will need to sign in again to access the platform."
          type="logout"
          confirmText="Logout"
          cancelText="Cancel"
          onConfirm={confirmLogout}
          onCancel={cancelLogout}
        />
      </div>
    </div>
  );
}

export default App;

