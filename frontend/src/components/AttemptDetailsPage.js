import React, { useState, useEffect } from 'react';
import './AttemptDetailsPage.css';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

function AttemptDetailsPage({ courseId, courseTitle, user, authToken, onBack }) {
  const [attempts, setAttempts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedAttemptDetails, setSelectedAttemptDetails] = useState(null);
  const [expandedStudents, setExpandedStudents] = useState({});

  // Dummy data for testing
  const getDummyAttempts = () => {
    return [
      {
        attempt_id: 'attempt-1',
        assessment_id: 'assessment-1',
        assessment_title: 'Midterm Exam - Chapter 1-3',
        score: 85,
        correct: 17,
        total: 20,
        attempted_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        user_id: 'user-1',
        user_name: 'John Doe',
        user_email: 'john.doe@example.com'
      },
      {
        attempt_id: 'attempt-2',
        assessment_id: 'assessment-1',
        assessment_title: 'Midterm Exam - Chapter 1-3',
        score: 90,
        correct: 18,
        total: 20,
        attempted_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        user_id: 'user-1',
        user_name: 'John Doe',
        user_email: 'john.doe@example.com'
      },
      {
        attempt_id: 'attempt-3',
        assessment_id: 'assessment-2',
        assessment_title: 'Final Exam - All Chapters',
        score: 92,
        correct: 23,
        total: 25,
        attempted_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
        user_id: 'user-1',
        user_name: 'John Doe',
        user_email: 'john.doe@example.com'
      },
      {
        attempt_id: 'attempt-4',
        assessment_id: 'assessment-1',
        assessment_title: 'Midterm Exam - Chapter 1-3',
        score: 75,
        correct: 15,
        total: 20,
        attempted_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        user_id: 'user-2',
        user_name: 'Jane Smith',
        user_email: 'jane.smith@example.com'
      },
      {
        attempt_id: 'attempt-5',
        assessment_id: 'assessment-2',
        assessment_title: 'Final Exam - All Chapters',
        score: 88,
        correct: 22,
        total: 25,
        attempted_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        user_id: 'user-2',
        user_name: 'Jane Smith',
        user_email: 'jane.smith@example.com'
      },
      {
        attempt_id: 'attempt-6',
        assessment_id: 'assessment-3',
        assessment_title: 'Quiz - Chapter 1',
        score: 95,
        correct: 19,
        total: 20,
        attempted_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
        user_id: 'user-2',
        user_name: 'Jane Smith',
        user_email: 'jane.smith@example.com'
      },
      {
        attempt_id: 'attempt-7',
        assessment_id: 'assessment-1',
        assessment_title: 'Midterm Exam - Chapter 1-3',
        score: 70,
        correct: 14,
        total: 20,
        attempted_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        user_id: 'user-3',
        user_name: 'Bob Johnson',
        user_email: 'bob.johnson@example.com'
      },
      {
        attempt_id: 'attempt-8',
        assessment_id: 'assessment-3',
        assessment_title: 'Quiz - Chapter 1',
        score: 80,
        correct: 16,
        total: 20,
        attempted_at: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
        user_id: 'user-3',
        user_name: 'Bob Johnson',
        user_email: 'bob.johnson@example.com'
      },
      {
        attempt_id: 'attempt-9',
        assessment_id: 'assessment-2',
        assessment_title: 'Final Exam - All Chapters',
        score: 72,
        correct: 18,
        total: 25,
        attempted_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        user_id: 'user-3',
        user_name: 'Bob Johnson',
        user_email: 'bob.johnson@example.com'
      },
      {
        attempt_id: 'attempt-10',
        assessment_id: 'assessment-4',
        assessment_title: 'Practice Test - Chapter 2',
        score: 65,
        correct: 13,
        total: 20,
        attempted_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
        user_id: 'user-4',
        user_name: 'Alice Williams',
        user_email: 'alice.williams@example.com'
      },
      {
        attempt_id: 'attempt-11',
        assessment_id: 'assessment-1',
        assessment_title: 'Midterm Exam - Chapter 1-3',
        score: 78,
        correct: 15.6,
        total: 20,
        attempted_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
        user_id: 'user-4',
        user_name: 'Alice Williams',
        user_email: 'alice.williams@example.com'
      }
    ];
  };

  useEffect(() => {
    if (courseId && user?.id) {
      // For now, use dummy data
      // TODO: Replace with fetchAttempts() when API is ready
      setLoading(true);
      setTimeout(() => {
        const dummyAttempts = getDummyAttempts();
        setAttempts(dummyAttempts);
        setLoading(false);
      }, 500);
      
      // Uncomment when API is ready:
      // fetchAttempts();
    }
  }, [courseId, user?.id]);

  const fetchAttempts = async () => {
    if (!user?.id || !courseId) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/ml/student-performance-courses/${user.id}`, {
        headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
      });

      if (!response.ok) {
        throw new Error('Failed to fetch course attempts');
      }

      const data = await response.json();
      
      // Find the course in the predictions
      const coursePrediction = data.predictions?.find(p => p.course_id === courseId);
      
      if (coursePrediction && coursePrediction.attempts) {
        setAttempts(coursePrediction.attempts);
      } else {
        setAttempts([]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAttemptItemClick = (attempt, allAttempts) => {
    // Calculate statistics for the student who made this attempt
    const studentId = attempt.user_id;
    const studentAttempts = allAttempts.filter(a => a.user_id === studentId);
    
    const stats = {
      total_attempts: studentAttempts.length,
      avg_score: studentAttempts.reduce((sum, a) => sum + a.score, 0) / studentAttempts.length,
      highest_score: Math.max(...studentAttempts.map(a => a.score)),
      lowest_score: Math.min(...studentAttempts.map(a => a.score)),
      total_correct: studentAttempts.reduce((sum, a) => sum + (a.correct || 0), 0),
      total_questions: studentAttempts.reduce((sum, a) => sum + (a.total || 0), 0),
      student_name: attempt.user_name,
      student_email: attempt.user_email,
      attempts: studentAttempts
    };
    
    setSelectedAttemptDetails(stats);
  };

  const getPerformanceLabel = (score) => {
    if (score >= 90) return 'EXCELLENT';
    if (score >= 75) return 'GOOD';
    if (score >= 60) return 'SATISFACTORY';
    return 'NEEDS IMPROVEMENT';
  };

  const getScoreColor = (score) => {
    if (score >= 90) return '#4caf50';
    if (score >= 75) return '#8bc34a';
    if (score >= 60) return '#ffc107';
    return '#f44336';
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Group attempts by student
  const groupAttemptsByStudent = (attempts) => {
    const studentsMap = {};
    
    attempts.forEach(attempt => {
      const studentId = attempt.user_id;
      if (!studentsMap[studentId]) {
        studentsMap[studentId] = {
          user_id: studentId,
          user_name: attempt.user_name || 'Unknown Student',
          user_email: attempt.user_email || '',
          attempts: []
        };
      }
      studentsMap[studentId].attempts.push(attempt);
    });

    // Convert to array and calculate stats for each student
    return Object.values(studentsMap).map(student => {
      const studentAttempts = student.attempts;
      const scores = studentAttempts.map(a => a.score);
      const totalCorrect = studentAttempts.reduce((sum, a) => sum + (a.correct || 0), 0);
      const totalQuestions = studentAttempts.reduce((sum, a) => sum + (a.total || 0), 0);

      return {
        ...student,
        total_attempts: studentAttempts.length,
        avg_score: scores.length > 0 ? scores.reduce((sum, s) => sum + s, 0) / scores.length : 0,
        highest_score: scores.length > 0 ? Math.max(...scores) : 0,
        lowest_score: scores.length > 0 ? Math.min(...scores) : 0,
        total_correct: totalCorrect,
        total_questions: totalQuestions,
        overall_accuracy: totalQuestions > 0 ? (totalCorrect / totalQuestions) * 100 : 0
      };
    }).sort((a, b) => {
      // Sort by name, then by most recent attempt
      if (a.user_name !== b.user_name) {
        return a.user_name.localeCompare(b.user_name);
      }
      const aLatest = new Date(Math.max(...a.attempts.map(at => new Date(at.attempted_at))));
      const bLatest = new Date(Math.max(...b.attempts.map(at => new Date(at.attempted_at))));
      return bLatest - aLatest;
    });
  };

  const students = attempts && attempts.length > 0 ? groupAttemptsByStudent(attempts) : [];

  const toggleStudentExpanded = (studentId) => {
    setExpandedStudents(prev => ({
      ...prev,
      [studentId]: !prev[studentId]
    }));
  };

  if (loading) {
    return (
      <div className="attempt-details-page">
        <div className="attempt-details-header">
          <button className="back-button" onClick={onBack}>
            ← Back to Dashboard
          </button>
          <h1>{courseTitle || 'Attempt Details'}</h1>
        </div>
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading attempt details...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="attempt-details-page">
        <div className="attempt-details-header">
          <button className="back-button" onClick={onBack}>
            ← Back to Dashboard
          </button>
          <h1>{courseTitle || 'Attempt Details'}</h1>
        </div>
        <div className="error-container">
          <p>⚠️ {error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="attempt-details-page">
      <div className="attempt-details-header">
        <button className="back-button" onClick={onBack}>
          ← Back to Dashboard
        </button>
        <h1>{courseTitle || 'Attempt Details'} - Attempt Details</h1>
      </div>

      <div className="attempt-details-content">
        {selectedAttemptDetails ? (
          <div className="student-stats-view">
            <button 
              className="back-to-attempts-btn"
              onClick={() => setSelectedAttemptDetails(null)}
            >
              ← Back to All Attempts
            </button>
            
            <div className="student-stats-header">
              <h2>📊 {selectedAttemptDetails.student_name}'s Statistics</h2>
              {selectedAttemptDetails.student_email && (
                <p className="student-email">{selectedAttemptDetails.student_email}</p>
              )}
            </div>
            
            <div className="student-stats-grid">
              <div className="stat-card">
                <div className="stat-value-large">{selectedAttemptDetails.total_attempts}</div>
                <div className="stat-label-large">Total Attempts</div>
              </div>
              <div className="stat-card">
                <div className="stat-value-large">{Math.round(selectedAttemptDetails.avg_score)}%</div>
                <div className="stat-label-large">Average Score</div>
              </div>
              <div className="stat-card">
                <div className="stat-value-large">{selectedAttemptDetails.highest_score}%</div>
                <div className="stat-label-large">Highest Score</div>
              </div>
              <div className="stat-card">
                <div className="stat-value-large">{selectedAttemptDetails.lowest_score}%</div>
                <div className="stat-label-large">Lowest Score</div>
              </div>
              <div className="stat-card">
                <div className="stat-value-large">
                  {selectedAttemptDetails.total_correct}/{selectedAttemptDetails.total_questions}
                </div>
                <div className="stat-label-large">Total Correct/Questions</div>
              </div>
              <div className="stat-card">
                <div className="stat-value-large">
                  {selectedAttemptDetails.total_questions > 0 
                    ? Math.round((selectedAttemptDetails.total_correct / selectedAttemptDetails.total_questions) * 100)
                    : 0}%
                </div>
                <div className="stat-label-large">Overall Accuracy</div>
              </div>
            </div>
            
            <div className="student-attempts-list">
              <h3>All Attempts by {selectedAttemptDetails.student_name}</h3>
              {selectedAttemptDetails.attempts.map((attempt, idx) => (
                <div key={attempt.attempt_id || idx} className="student-attempt-item">
                  <div className="student-attempt-header">
                    <div className="student-attempt-title">{attempt.assessment_title}</div>
                  </div>
                  <div className="student-attempt-details">
                    <div className="student-attempt-stat">
                      <span className="stat-label">Score:</span>
                      <span className="stat-value">{attempt.correct}/{attempt.total}</span>
                    </div>
                    <div className="student-attempt-stat">
                      <span className="stat-label">Date:</span>
                      <span className="stat-value">{formatDate(attempt.attempted_at)}</span>
                    </div>
                  </div>
                  <div className="student-attempt-performance">
                    <span className="performance-label" style={{ color: getScoreColor(attempt.score) }}>
                      {getPerformanceLabel(attempt.score)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : students && students.length > 0 ? (
          <div className="students-list-container">
            <div className="students-list-header">
              <h2>Enrolled Students ({students.length})</h2>
              <p className="subtitle">Click to expand and view all attempts for each student</p>
            </div>
            <div className="students-list">
              {students.map((student) => {
                const isExpanded = expandedStudents[student.user_id];
                const sortedAttempts = student.attempts.sort((a, b) => new Date(b.attempted_at) - new Date(a.attempted_at));
                
                return (
                  <div 
                    key={student.user_id} 
                    className={`student-card ${isExpanded ? 'expanded' : ''}`}
                  >
                    <div 
                      className="student-card-header clickable"
                      onClick={() => toggleStudentExpanded(student.user_id)}
                    >
                      <div className="student-info">
                        <div className="student-name-wrapper">
                          <button 
                            className="expand-toggle-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleStudentExpanded(student.user_id);
                            }}
                          >
                            {isExpanded ? '▼' : '▶'}
                          </button>
                          <div>
                            <h3 className="student-name">{student.user_name}</h3>
                            {student.user_email && (
                              <p className="student-email-small">{student.user_email}</p>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="student-quick-stats">
                        <div className="quick-stat">
                          <span className="quick-stat-value">{student.total_attempts}</span>
                          <span className="quick-stat-label">Attempts</span>
                        </div>
                        <div className="quick-stat">
                          <span 
                            className="quick-stat-value" 
                            style={{ color: getScoreColor(student.avg_score) }}
                          >
                            {Math.round(student.avg_score)}%
                          </span>
                          <span className="quick-stat-label">Avg Score</span>
                        </div>
                      </div>
                    </div>

                    <div className="student-stats-summary">
                      <div className="summary-stat">
                        <span className="summary-label">Highest:</span>
                        <span className="summary-value" style={{ color: getScoreColor(student.highest_score) }}>
                          {Math.round(student.highest_score)}%
                        </span>
                      </div>
                      <div className="summary-stat">
                        <span className="summary-label">Lowest:</span>
                        <span className="summary-value" style={{ color: getScoreColor(student.lowest_score) }}>
                          {Math.round(student.lowest_score)}%
                        </span>
                      </div>
                      <div className="summary-stat">
                        <span className="summary-label">Accuracy:</span>
                        <span className="summary-value" style={{ color: getScoreColor(student.overall_accuracy) }}>
                          {Math.round(student.overall_accuracy)}%
                        </span>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="student-all-attempts">
                        <h4 className="attempts-preview-title">All Attempts:</h4>
                        <div className="attempts-preview-list">
                          {sortedAttempts.map((attempt, idx) => (
                            <div 
                              key={attempt.attempt_id || idx} 
                              className="attempt-preview-item clickable"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAttemptItemClick(attempt, attempts);
                              }}
                            >
                              <div className="attempt-preview-assessment">{attempt.assessment_title}</div>
                              <div className="attempt-preview-details">
                                <span className="attempt-preview-score" style={{ color: getScoreColor(attempt.score) }}>
                                  {attempt.correct}/{attempt.total}
                                </span>
                                <span className="attempt-preview-date">{formatDate(attempt.attempted_at)}</span>
                              </div>
                              <div className="attempt-preview-performance">
                                <span 
                                  className="performance-label-small" 
                                  style={{ color: getScoreColor(attempt.score) }}
                                >
                                  {getPerformanceLabel(attempt.score)}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="no-attempts-container">
            <p>No attempt details available for this course.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default AttemptDetailsPage;
