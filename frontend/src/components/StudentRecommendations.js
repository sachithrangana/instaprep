import React, { useState, useEffect } from 'react';
import './StudentRecommendations.css';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

function StudentRecommendations({ user, authToken, onBack }) {
  const [userRecommendations, setUserRecommendations] = useState(null);
  const [courseRecommendations, setCourseRecommendations] = useState({});
  const [enrolledCourses, setEnrolledCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedCourses, setExpandedCourses] = useState({});

  useEffect(() => {
    if (user && user.id) {
      // Set loading to false immediately and show dummy data
      // Real data will be fetched in the background
      setLoading(false);
      fetchUserRecommendations();
      fetchEnrolledCourses();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const fetchUserRecommendations = async () => {
    if (!user?.id) return;

    // Set dummy data immediately so user sees recommendations right away
    const dummyRecommendations = {
      videos: [
        { id: 1, title: "Study Strategies for Better Performance", url: "https://example.com/video1", duration: "12:30", type: "video" },
        { id: 2, title: "Time Management Tips", url: "https://example.com/video2", duration: "15:00", type: "video" },
        { id: 3, title: "Effective Note-Taking Techniques", url: "https://example.com/video3", duration: "18:45", type: "video" },
        { id: 4, title: "Memory Improvement Methods", url: "https://example.com/video4", duration: "14:20", type: "video" }
      ],
      blogs: [
        { id: 1, title: "How to Improve Your Study Habits", url: "https://example.com/blog1", readTime: "5 min", type: "blog" },
        { id: 2, title: "10 Tips for Academic Success", url: "https://example.com/blog2", readTime: "8 min", type: "blog" },
        { id: 3, title: "Building Effective Learning Routines", url: "https://example.com/blog3", readTime: "6 min", type: "blog" }
      ],
      courseMaterials: [
        { id: 1, title: "General Study Guide", url: "https://example.com/material1", format: "PDF", type: "material" },
        { id: 2, title: "Exam Preparation Checklist", url: "https://example.com/material2", format: "PDF", type: "material" },
        { id: 3, title: "Learning Resources Library", url: "https://example.com/material3", format: "DOC", type: "material" }
      ]
    };
    setUserRecommendations(dummyRecommendations);

    // Then try to fetch real data from API (will replace dummy data if successful)
    try {
      const headers = {
        'Content-Type': 'application/json',
      };

      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const response = await fetch(`${API_BASE}/recommendations/user/${user.id}`, {
        method: 'GET',
        headers: headers,
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.recommendations) {
          setUserRecommendations(data.recommendations);
        }
      }
    } catch (err) {
      console.error('Error fetching user recommendations:', err);
      // Keep dummy data if API call fails
    }
  };

  const fetchEnrolledCourses = async () => {
    if (!user?.id) return;

    try {
      const headers = {
        'Content-Type': 'application/json',
      };

      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      // Fetch enrolled courses for the user
      const enrollmentsResponse = await fetch(`${API_BASE}/enrollments/${user.id}`, {
        method: 'GET',
        headers: headers,
      });

      if (enrollmentsResponse.ok) {
        const enrollmentsData = await enrollmentsResponse.json();
        if (enrollmentsData.success && enrollmentsData.enrollments) {
          const enrollments = enrollmentsData.enrollments || [];
          
          if (enrollments.length > 0) {
            // Create course objects from enrollment data
            // This ensures we show courses even if they're not found in the courses collection
            const enrolledCoursesList = enrollments.map(enrollment => ({
              id: enrollment.course_id,
              title: enrollment.course_title || 'Course'
            }));
            
            setEnrolledCourses(enrolledCoursesList);
            
            // Try to fetch course details to enrich the data
            const courseIds = enrollments.map(e => e.course_id);
            const coursesResponse = await fetch(`${API_BASE}/courses`, {
              method: 'GET',
              headers: headers,
            });

            if (coursesResponse.ok) {
              const coursesData = await coursesResponse.json();
              if (coursesData.success && coursesData.courses) {
                // Merge course details if available
                const courseMap = {};
                coursesData.courses.forEach(course => {
                  if (courseIds.includes(course.id)) {
                    courseMap[course.id] = course;
                  }
                });
                
                // Update with full course data where available
                setEnrolledCourses(prev => prev.map(course => 
                  courseMap[course.id] ? courseMap[course.id] : course
                ));
              }
            }
            
            // Fetch recommendations for each enrolled course (with dummy data immediately)
            enrolledCoursesList.forEach(course => {
              fetchCourseRecommendations(course.id, course.title);
            });
          } else {
            // No enrollments, set empty array
            setEnrolledCourses([]);
          }
        }
      }
    } catch (err) {
      console.error('Error fetching courses:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCourseRecommendations = async (courseId, courseTitle = 'Course') => {
    if (!user?.id || !courseId) return;

    // Set dummy data immediately so user sees recommendations right away
    const dummyRecommendations = {
      videos: [
        { id: 1, title: `${courseTitle} - Review Session`, url: "https://example.com/video1", duration: "20:00", type: "video" },
        { id: 2, title: `${courseTitle} - Practice Problems`, url: "https://example.com/video2", duration: "18:30", type: "video" },
        { id: 3, title: `${courseTitle} - Advanced Topics`, url: "https://example.com/video3", duration: "25:00", type: "video" }
      ],
      blogs: [
        { id: 1, title: `${courseTitle} Study Tips`, url: "https://example.com/blog1", readTime: "7 min", type: "blog" },
        { id: 2, title: `${courseTitle} Best Practices`, url: "https://example.com/blog2", readTime: "5 min", type: "blog" }
      ],
      courseMaterials: [
        { id: 1, title: `${courseTitle} - Chapter Notes`, url: "https://example.com/material1", format: "PDF", type: "material" },
        { id: 2, title: `${courseTitle} - Practice Questions`, url: "https://example.com/material2", format: "PDF", type: "material" },
        { id: 3, title: `${courseTitle} - Study Guide`, url: "https://example.com/material3", format: "DOC", type: "material" }
      ]
    };

    setCourseRecommendations(prev => ({
      ...prev,
      [courseId]: {
        course_title: courseTitle,
        recommendations: dummyRecommendations
      }
    }));

    // Then try to fetch real data from API (will replace dummy data if successful)
    try {
      const headers = {
        'Content-Type': 'application/json',
      };

      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const response = await fetch(`${API_BASE}/recommendations/course/${courseId}/user/${user.id}`, {
        method: 'GET',
        headers: headers,
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.recommendations) {
          setCourseRecommendations(prev => ({
            ...prev,
            [courseId]: {
              course_title: data.course_title || courseTitle,
              recommendations: data.recommendations
            }
          }));
        }
      }
    } catch (err) {
      console.error(`Error fetching recommendations for course ${courseId}:`, err);
      // Keep dummy data if API call fails
    }
  };

  const toggleCourseExpanded = (courseId) => {
    const willBeExpanded = !expandedCourses[courseId];
    
    setExpandedCourses(prev => ({
      ...prev,
      [courseId]: !prev[courseId]
    }));
    
    // If expanding and recommendations haven't been loaded yet, fetch them
    if (willBeExpanded && !courseRecommendations[courseId]) {
      const course = enrolledCourses.find(c => c.id === courseId);
      if (course) {
        fetchCourseRecommendations(courseId, course.title || 'Course');
      }
    }
  };

  if (loading) {
    return (
      <div className="student-recommendations-page">
        <div className="loading-container">
          <p>Loading recommendations...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="student-recommendations-page">
      <div className="recommendations-header">
        <button className="back-button" onClick={onBack}>
          ← Back to Main
        </button>
        <h1>📚 My Recommendations</h1>
        <p className="recommendations-subtitle">Personalized learning materials for you</p>
      </div>

      <div className="recommendations-content">
        {/* User-Level Recommendations */}
        <div className="recommendations-section user-recommendations">
          <h2 className="section-title">👤 Personal Recommendations</h2>
          <p className="section-description">Recommended materials based on your overall performance</p>
          
          {userRecommendations ? (
            <div className="recommendations-grid">
              {/* Videos */}
              {userRecommendations.videos && userRecommendations.videos.length > 0 && (
                <div className="recommendations-category-card">
                  <h3 className="category-title">🎥 Videos</h3>
                  <div className="recommendations-list">
                    {userRecommendations.videos.map((video) => (
                      <a
                        key={video.id}
                        href={video.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="recommendation-item video-item"
                      >
                        <span className="recommendation-title">{video.title}</span>
                        <span className="recommendation-meta">{video.duration}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Blogs */}
              {userRecommendations.blogs && userRecommendations.blogs.length > 0 && (
                <div className="recommendations-category-card">
                  <h3 className="category-title">📝 Blogs</h3>
                  <div className="recommendations-list">
                    {userRecommendations.blogs.map((blog) => (
                      <a
                        key={blog.id}
                        href={blog.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="recommendation-item blog-item"
                      >
                        <span className="recommendation-title">{blog.title}</span>
                        <span className="recommendation-meta">{blog.readTime}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Course Materials */}
              {userRecommendations.courseMaterials && userRecommendations.courseMaterials.length > 0 && (
                <div className="recommendations-category-card">
                  <h3 className="category-title">📄 Course Materials</h3>
                  <div className="recommendations-list">
                    {userRecommendations.courseMaterials.map((material) => (
                      <a
                        key={material.id}
                        href={material.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="recommendation-item material-item"
                      >
                        <span className="recommendation-title">{material.title}</span>
                        <span className="recommendation-meta">{material.format}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {(!userRecommendations.videos || userRecommendations.videos.length === 0) &&
               (!userRecommendations.blogs || userRecommendations.blogs.length === 0) &&
               (!userRecommendations.courseMaterials || userRecommendations.courseMaterials.length === 0) && (
                <div className="no-recommendations">
                  <p>No personal recommendations available at this time.</p>
                  <p className="help-text">Complete some assessments to receive personalized recommendations!</p>
                </div>
              )}
            </div>
          ) : (
            <div className="no-recommendations">
              <p>Loading personal recommendations...</p>
            </div>
          )}
        </div>

        {/* Course-Level Recommendations */}
        <div className="recommendations-section course-recommendations">
          <h2 className="section-title">📖 Course-Specific Recommendations</h2>
          <p className="section-description">Recommended materials for each course you're enrolled in</p>

          {enrolledCourses.length > 0 ? (
            <div className="course-recommendations-list">
              {enrolledCourses.map((course) => {
                const courseRec = courseRecommendations[course.id];
                const isExpanded = expandedCourses[course.id];

                return (
                  <div key={course.id} className="course-recommendation-card">
                    <div
                      className="course-recommendation-header"
                      onClick={() => toggleCourseExpanded(course.id)}
                    >
                      <h3 className="course-title">{course.title || courseRec?.course_title || 'Course'}</h3>
                      <button className="expand-button">
                        {isExpanded ? '▼' : '▶'}
                      </button>
                    </div>

                    {isExpanded && courseRec && (
                      <div className="course-recommendations-content">
                        <div className="recommendations-grid">
                          {/* Videos */}
                          {courseRec.recommendations.videos && courseRec.recommendations.videos.length > 0 && (
                            <div className="recommendations-category-card">
                              <h4 className="category-title">🎥 Videos</h4>
                              <div className="recommendations-list">
                                {courseRec.recommendations.videos.map((video) => (
                                  <a
                                    key={video.id}
                                    href={video.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="recommendation-item video-item"
                                  >
                                    <span className="recommendation-title">{video.title}</span>
                                    <span className="recommendation-meta">{video.duration}</span>
                                  </a>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Blogs */}
                          {courseRec.recommendations.blogs && courseRec.recommendations.blogs.length > 0 && (
                            <div className="recommendations-category-card">
                              <h4 className="category-title">📝 Blogs</h4>
                              <div className="recommendations-list">
                                {courseRec.recommendations.blogs.map((blog) => (
                                  <a
                                    key={blog.id}
                                    href={blog.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="recommendation-item blog-item"
                                  >
                                    <span className="recommendation-title">{blog.title}</span>
                                    <span className="recommendation-meta">{blog.readTime}</span>
                                  </a>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Course Materials */}
                          {courseRec.recommendations.courseMaterials && courseRec.recommendations.courseMaterials.length > 0 && (
                            <div className="recommendations-category-card">
                              <h4 className="category-title">📄 Course Materials</h4>
                              <div className="recommendations-list">
                                {courseRec.recommendations.courseMaterials.map((material) => (
                                  <a
                                    key={material.id}
                                    href={material.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="recommendation-item material-item"
                                  >
                                    <span className="recommendation-title">{material.title}</span>
                                    <span className="recommendation-meta">{material.format}</span>
                                  </a>
                                ))}
                              </div>
                            </div>
                          )}

                          {(!courseRec.recommendations.videos || courseRec.recommendations.videos.length === 0) &&
                           (!courseRec.recommendations.blogs || courseRec.recommendations.blogs.length === 0) &&
                           (!courseRec.recommendations.courseMaterials || courseRec.recommendations.courseMaterials.length === 0) && (
                            <div className="no-recommendations">
                              <p>No recommendations available for this course yet.</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {isExpanded && !courseRec && (
                      <div className="course-recommendations-content">
                        <div className="no-recommendations">
                          <p>Loading recommendations for this course...</p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="no-recommendations">
              <p>You're not enrolled in any courses yet.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default StudentRecommendations;
