import React, { useState, useEffect } from 'react';
import './AssessmentViewer.css';
import ConfirmationDialog from './ConfirmationDialog';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

function AssessmentViewer({ assessment, onClose, user, authToken: propAuthToken }) {
  // Get auth token and user info from props or localStorage
  const authToken = propAuthToken || localStorage.getItem('authToken');
  const currentUser = user || JSON.parse(localStorage.getItem('user') || 'null');

  const [showAnswers, setShowAnswers] = useState(false);
  const [userAnswers, setUserAnswers] = useState({});
  const [currentAssessment, setCurrentAssessment] = useState(assessment);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState(null);
  const [activeLanguage, setActiveLanguage] = useState('english'); // 'english', 'sinhala', or 'sinhala_google_translate'
  const [editingQuestionIndex, setEditingQuestionIndex] = useState(null);
  const [editedQuestion, setEditedQuestion] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [showEmptyAnswersModal, setShowEmptyAnswersModal] = useState(false);

  useEffect(() => {
    // Only set current assessment when component mounts or assessment changes
    setCurrentAssessment(assessment);
    
    // Check if questions need to be generated (only after component is mounted/visible)
    if (assessment && (!assessment.questions || assessment.questions.length === 0) && !isGenerating) {
      // Small delay to ensure component is fully mounted before generating
      const timer = setTimeout(() => {
        generateQuestions();
      }, 100);
      
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assessment?.id]); // Only depend on assessment ID to avoid infinite loops

  const generateQuestions = async () => {
    if (!assessment || !assessment.id) return;
    
    // Prevent duplicate calls
    if (isGenerating) {
      console.log('Generation already in progress, skipping duplicate call');
      return;
    }
    
    setIsGenerating(true);
    setGenerationError(null);
    
    try {
      // Prepare request body with course_id if available
      const requestBody = {};
      if (assessment.course_id) {
        requestBody.course_id = assessment.course_id;
      } else if (assessment.sourceType === 'course' && assessment.sourceId) {
        // Fallback: use sourceId if course_id is not available
        requestBody.course_id = assessment.sourceId;
      }
      
      const response = await fetch(`http://127.0.0.1:5000/api/assessments/${assessment.id}/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: Object.keys(requestBody).length > 0 ? JSON.stringify(requestBody) : undefined,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate questions');
      }

      const result = await response.json();
      setCurrentAssessment(result.assessment);
    } catch (error) {
      console.error('Error generating questions:', error);
      setGenerationError(error.message || 'Failed to generate questions. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  if (!assessment) return null;

  const handleAnswerChange = (questionId, answer) => {
    setUserAnswers(prev => ({
      ...prev,
      [questionId]: answer
    }));
  };

  const handleEditQuestion = (index) => {
    setEditingQuestionIndex(index);
    setEditedQuestion({ ...currentAssessment.questions[index] });
  };

  const handleCancelEdit = () => {
    setEditingQuestionIndex(null);
    setEditedQuestion(null);
  };

  const handleSubmitAttempt = async () => {
    if (!currentAssessment?.id || !currentUser) {
      alert('Please log in to submit your attempt.');
      return;
    }

    // Check if questions are available
    if (!currentAssessment?.questions || currentAssessment.questions.length === 0) {
      alert('Assessment questions are not available yet. Please wait for questions to be generated.');
      return;
    }

    // Check if questions are still being generated
    if (isGenerating) {
      alert('Questions are still being generated. Please wait...');
      return;
    }

    // Check if user has answered at least one question
    const answeredCount = Object.keys(userAnswers).filter(key => userAnswers[key] && userAnswers[key].trim()).length;
    if (answeredCount === 0) {
      setShowEmptyAnswersModal(true);
      return;
    }

    await performSubmit();
  };

  const performSubmit = async () => {
    setIsSubmitting(true);
    setSubmitSuccess(false);
    setShowEmptyAnswersModal(false);

    try {
      let assessmentToSubmit = currentAssessment;

      // First, verify that the assessment has questions in the frontend state
      if (!assessmentToSubmit.questions || assessmentToSubmit.questions.length === 0) {
        // Try to fetch the latest assessment data from backend
        const assessmentResponse = await fetch(`${API_BASE}/assessments/${assessmentToSubmit.id}`, {
          headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
        });
        
        if (assessmentResponse.ok) {
          const assessmentData = await assessmentResponse.json();
          if (assessmentData.questions && assessmentData.questions.length > 0) {
            // Update local state with fresh assessment data
            setCurrentAssessment(assessmentData);
            assessmentToSubmit = assessmentData;
          } else {
            throw new Error('Assessment questions are not available. Please wait for questions to be generated and try again.');
          }
        } else {
          throw new Error('Could not load assessment data. Please try again.');
        }
      }
      
      // Double-check questions exist before submitting
      if (!assessmentToSubmit.questions || assessmentToSubmit.questions.length === 0) {
        throw new Error('Assessment questions are not available. Please wait for questions to be generated.');
      }

      const headers = {
        'Content-Type': 'application/json',
      };

      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const response = await fetch(`${API_BASE}/assessments/${assessmentToSubmit.id}/attempts`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          user: currentUser,
          answers: userAnswers
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to submit attempt');
      }

      const result = await response.json();
      if (result.success) {
        setSubmitSuccess(true);
        setShowAnswers(true); // Show answers after submission
        const score = result.attempt.overall_score;
        alert(`Assessment submitted successfully! Score: ${score.correct}/${score.total} (${score.percentage}%)`);
      }
    } catch (error) {
      console.error('Error submitting attempt:', error);
      alert(`Error submitting attempt: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmSubmit = () => {
    performSubmit();
  };

  const handleCancelSubmit = () => {
    setShowEmptyAnswersModal(false);
  };

  const handleSaveQuestion = async (index) => {
    if (!editedQuestion || !currentAssessment?.id) return;
    
    try {
      const headers = {
        'Content-Type': 'application/json',
      };
      
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }
      
      const response = await fetch(`${API_BASE}/assessments/${currentAssessment.id}/questions/${index}`, {
        method: 'PUT',
        headers: headers,
        body: JSON.stringify(editedQuestion),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save question');
      }

      const result = await response.json();
      setCurrentAssessment(result.assessment);
      setEditingQuestionIndex(null);
      setEditedQuestion(null);
    } catch (error) {
      console.error('Error saving question:', error);
      alert(`Error saving question: ${error.message}`);
    }
  };

  const handleQuestionFieldChange = (field, value) => {
    if (!editedQuestion) return;
    setEditedQuestion(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleOptionChange = (optIndex, value) => {
    if (!editedQuestion) return;
    const newOptions = [...(editedQuestion.options || [])];
    newOptions[optIndex] = value;
    setEditedQuestion(prev => ({
      ...prev,
      options: newOptions
    }));
  };

  const calculateScore = () => {
    if (!currentAssessment?.questions || currentAssessment.questions.length === 0) {
      return { correct: 0, total: 0, percentage: 0 };
    }
    
    let correct = 0;
    let total = currentAssessment.questions.length;
    
    currentAssessment.questions.forEach(q => {
      const questionId = q.id || q.number;
      const userAnswer = userAnswers[questionId];
      const correctAnswer = q.correct_answer || q.correctAnswer;
      
      if (userAnswer && correctAnswer) {
        // Normalize both answers for comparison (trim, lowercase)
        const normalizedUserAnswer = userAnswer.trim().toLowerCase();
        const normalizedCorrectAnswer = correctAnswer.trim().toLowerCase();
        
        // For multiple choice, also check if user selected the correct option letter/index
        if (q.type === 'multiple_choice' && q.options) {
          const correctIndex = q.options.findIndex(opt => 
            opt.trim().toLowerCase() === normalizedCorrectAnswer ||
            opt === correctAnswer
          );
          const userIndex = q.options.findIndex(opt => 
            opt.trim().toLowerCase() === normalizedUserAnswer ||
            opt === userAnswer
          );
          if (correctIndex !== -1 && userIndex === correctIndex) {
            correct++;
          } else if (normalizedUserAnswer === normalizedCorrectAnswer) {
            correct++;
          }
        } else {
          // For true/false, short answer, and essay
          if (normalizedUserAnswer === normalizedCorrectAnswer) {
            correct++;
          }
        }
      }
    });
    
    const percentage = total > 0 ? Math.round((correct / total) * 100) : 0;
    return { correct, total, percentage };
  };

  const score = showAnswers ? calculateScore() : null;

  // Check if Sinhala translations are available
  // Enable Sinhala tab if ANY question has ANY Sinhala translation, or if questions exist (they should have translations)
  const hasSinhalaTranslations = currentAssessment?.questions?.some(q => 
    (q.question_sinhala && q.question_sinhala.trim()) || 
    (q.options_sinhala && q.options_sinhala.length > 0 && q.options_sinhala.some(opt => opt && opt.trim())) ||
    (q.correct_answer_sinhala && q.correct_answer_sinhala.trim()) ||
    (q.explanation_sinhala && q.explanation_sinhala.trim())
  ) || (currentAssessment?.questions && currentAssessment.questions.length > 0); // Enable if questions exist (translations should be generated)

  const hasSinhalaGoogleTranslations = currentAssessment?.questions?.some(q =>
    q.question_sinhala_google_translate && q.question_sinhala_google_translate.trim()
  );

  return (
    <div className="assessment-viewer-modal" onClick={onClose}>
      <div className="assessment-viewer-content" onClick={(e) => e.stopPropagation()}>
        <button className="assessment-viewer-close" onClick={onClose}>×</button>
        
        <div className="assessment-viewer-header">
          <h2>{currentAssessment?.title || assessment.title}</h2>
          <div className="assessment-viewer-meta">
            <span className="assessment-type-badge">{currentAssessment?.type || assessment.type}</span>
            <span>•</span>
            <span>{currentAssessment?.numQuestions || currentAssessment?.questions?.length || assessment.numQuestions || 0} questions</span>
            <span>•</span>
            <span>{currentAssessment?.difficulty || assessment.difficulty} difficulty</span>
          </div>
        </div>

        {isGenerating && (
          <div className="generation-status">
            <div className="generation-spinner">⏳</div>
            <p>Generating questions using GraphRAG... This may take a moment.</p>
          </div>
        )}

        {generationError && (
          <div className="generation-error">
            <p>⚠️ {generationError}</p>
            <button onClick={generateQuestions} className="btn-retry">
              Retry Generation
            </button>
          </div>
        )}

        {currentAssessment?.objectives && currentAssessment.objectives.length > 0 && (
          <div className="assessment-objectives-section">
            <h3>Learning Objectives</h3>
            <ul>
              {currentAssessment.objectives.map((obj, idx) => (
                <li key={idx}>{obj}</li>
              ))}
            </ul>
          </div>
        )}

        {!isGenerating && !generationError && currentAssessment?.questions && currentAssessment.questions.length > 0 && (
          <div className="language-tabs">
            <button
              className={`language-tab ${activeLanguage === 'english' ? 'active' : ''}`}
              onClick={() => setActiveLanguage('english')}
            >
              English
            </button>
            <button
              className={`language-tab ${activeLanguage === 'sinhala' ? 'active' : ''}`}
              onClick={() => setActiveLanguage('sinhala')}
              disabled={!hasSinhalaTranslations}
              title={!hasSinhalaTranslations ? 'Sinhala translations not available yet' : 'Switch to Sinhala'}
            >
              සිංහල
            </button>
            <button
              className={`language-tab ${activeLanguage === 'sinhala_google_translate' ? 'active' : ''}`}
              onClick={() => setActiveLanguage('sinhala_google_translate')}
              disabled={!hasSinhalaGoogleTranslations}
              title={!hasSinhalaGoogleTranslations ? 'Sinhala Google translations not available yet' : 'Switch to Sinhala (Google Translate)'}
            >
              සිංහල (with Google)
            </button>
          </div>
        )}

        {!isGenerating && !generationError && (
          <div className="assessment-questions">
            {currentAssessment?.questions && currentAssessment.questions.length > 0 ? (
              currentAssessment.questions.map((question, idx) => (
            <div key={question.id || question.number || idx} className="question-item">
              <div className="question-header">
                <span className="question-number">Question {idx + 1}</span>
                <span className="question-type">
                  {question.type === 'multiple_choice' ? 'Multiple Choice' :
                   question.type === 'true_false' ? 'True/False' :
                   question.type === 'short_answer' ? 'Short Answer' :
                   question.type === 'essay' ? 'Essay' :
                   question.type?.replace('_', ' ') || 'Question'}
                </span>
                <span className="question-points">{question.points || 1} point{(question.points || 1) !== 1 ? 's' : ''}</span>
                <div className="question-actions" style={{ marginLeft: 'auto' }}>
                  {editingQuestionIndex === idx ? (
                    <>
                      <button 
                        className="btn-save-question" 
                        onClick={() => handleSaveQuestion(idx)}
                        title="Save changes"
                      >
                        💾 Save
                      </button>
                      <button 
                        className="btn-cancel-edit" 
                        onClick={handleCancelEdit}
                        title="Cancel editing"
                      >
                        ✖ Cancel
                      </button>
                    </>
                  ) : (
                    <button 
                      className="btn-edit-question" 
                      onClick={() => handleEditQuestion(idx)}
                      title="Edit question"
                    >
                      ✏️ Edit
                    </button>
                  )}
                </div>
              </div>
              
              <div className="question-text">
                {editingQuestionIndex === idx ? (
                  <div className="question-edit-mode">
                    <label>Question (English):</label>
                    <textarea
                      className="question-edit-input"
                      value={editedQuestion?.question || ''}
                      onChange={(e) => handleQuestionFieldChange('question', e.target.value)}
                      rows={3}
                    />
                    <label>Question (Sinhala):</label>
                    <textarea
                      className="question-edit-input"
                      value={editedQuestion?.question_sinhala || ''}
                      onChange={(e) => handleQuestionFieldChange('question_sinhala', e.target.value)}
                      rows={3}
                    />
                    <label>Correct Answer (English):</label>
                    <textarea
                      className="question-edit-input"
                      value={editedQuestion?.correct_answer || editedQuestion?.correctAnswer || ''}
                      onChange={(e) => handleQuestionFieldChange('correct_answer', e.target.value)}
                      rows={2}
                    />
                    <label>Correct Answer (Sinhala):</label>
                    <textarea
                      className="question-edit-input"
                      value={editedQuestion?.correct_answer_sinhala || ''}
                      onChange={(e) => handleQuestionFieldChange('correct_answer_sinhala', e.target.value)}
                      rows={2}
                    />
                    <label>Explanation (English):</label>
                    <textarea
                      className="question-edit-input"
                      value={editedQuestion?.explanation || ''}
                      onChange={(e) => handleQuestionFieldChange('explanation', e.target.value)}
                      rows={3}
                    />
                    <label>Explanation (Sinhala):</label>
                    <textarea
                      className="question-edit-input"
                      value={editedQuestion?.explanation_sinhala || ''}
                      onChange={(e) => handleQuestionFieldChange('explanation_sinhala', e.target.value)}
                      rows={3}
                    />
                  </div>
                ) : (
                  activeLanguage === 'english' ? (
                    <div className="question-english">{question.question || 'No question text available'}</div>
                  ) : activeLanguage === 'sinhala_google_translate' ? (
                    <div className="question-sinhala">
                      {question.question_sinhala_google_translate || question.question_sinhala || question.question || 'No question text available'}
                    </div>
                  ) : (
                    <div className="question-sinhala">
                      {question.question_sinhala || question.question || 'No question text available'}
                    </div>
                  )
                )}
              </div>
              
              {question.type === 'multiple_choice' && question.options && question.options.length > 0 && (
                <div className="question-options">
                  {editingQuestionIndex === idx ? (
                    <>
                      <label>Options (English):</label>
                      {editedQuestion?.options?.map((option, optIdx) => (
                        <input
                          key={optIdx}
                          className="question-edit-input"
                          type="text"
                          value={option}
                          onChange={(e) => handleOptionChange(optIdx, e.target.value)}
                          placeholder={`Option ${optIdx + 1}`}
                        />
                      ))}
                      <label>Options (Sinhala):</label>
                      {(editedQuestion?.options_sinhala || editedQuestion?.options || []).map((_, optIdx) => (
                        <input
                          key={optIdx}
                          className="question-edit-input"
                          type="text"
                          value={editedQuestion?.options_sinhala?.[optIdx] || ''}
                          onChange={(e) => {
                            const newOptionsSinhala = [...(editedQuestion.options_sinhala || [])];
                            newOptionsSinhala[optIdx] = e.target.value;
                            setEditedQuestion(prev => ({ ...prev, options_sinhala: newOptionsSinhala }));
                          }}
                          placeholder={`Option ${optIdx + 1} (Sinhala)`}
                        />
                      ))}
                    </>
                  ) : (
                    question.options.map((option, optIdx) => (
                      <label key={optIdx} className="option-label">
                        <input
                          type="radio"
                          name={question.id || question.number}
                          value={option}
                          onChange={(e) => handleAnswerChange(question.id || question.number, e.target.value)}
                          disabled={showAnswers}
                        />
                        <div className="option-text">
                          {activeLanguage === 'english' ? (
                            <span className="option-english">{option}</span>
                          ) : activeLanguage === 'sinhala_google_translate' ? (
                            <span className="option-sinhala">
                              {question.options_sinhala_google_translate && question.options_sinhala_google_translate[optIdx]
                                ? question.options_sinhala_google_translate[optIdx]
                                : (question.options_sinhala && question.options_sinhala[optIdx]
                                  ? question.options_sinhala[optIdx]
                                  : option)}
                            </span>
                          ) : (
                            <span className="option-sinhala">
                              {question.options_sinhala && question.options_sinhala[optIdx] 
                                ? question.options_sinhala[optIdx] 
                                : option}
                            </span>
                          )}
                        </div>
                      </label>
                    ))
                  )}
                </div>
              )}
              
              {question.type === 'true_false' && (
                <div className="question-options">
                  {(question.options && question.options.length > 0 ? question.options : ['True', 'False']).map((option, optIdx) => {
                    const sinhalaOptions = question.options_sinhala && question.options_sinhala.length > 0 
                      ? question.options_sinhala 
                      : ['සත්‍ය', 'මිත්‍යා'];
                    return (
                      <label key={optIdx} className="option-label">
                        <input
                          type="radio"
                          name={question.id || question.number}
                          value={option}
                          onChange={(e) => handleAnswerChange(question.id || question.number, e.target.value)}
                          disabled={showAnswers}
                        />
                        <div className="option-text">
                          {activeLanguage === 'english' ? (
                            <span className="option-english">{option}</span>
                          ) : (
                            <span className="option-sinhala">{sinhalaOptions[optIdx] || option}</span>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
              
              {(question.type === 'short_answer' || question.type === 'essay') && (
                <div className="text-answer-section">
                  <textarea
                    className="answer-textarea"
                    placeholder={question.type === 'essay' 
                      ? (activeLanguage !== 'english' ? 'ඔබේ පිළිතුර මෙහි ටයිප් කරන්න...' : 'Enter your detailed answer here...')
                      : (activeLanguage !== 'english' ? 'ඔබේ පිළිතුර මෙහි ටයිප් කරන්න...' : 'Enter your answer here...')}
                    value={userAnswers[question.id || question.number] || ''}
                    onChange={(e) => handleAnswerChange(question.id || question.number, e.target.value)}
                    disabled={showAnswers}
                    rows={question.type === 'essay' ? 6 : 3}
                  />
                  {question.type === 'essay' && (
                    <div className="essay-hint">
                      <small>Provide a detailed, well-structured response</small>
                    </div>
                  )}
                </div>
              )}
              
              {/* Fallback: If question type is not recognized, show appropriate input */}
              {question.type && 
               question.type !== 'multiple_choice' && 
               question.type !== 'true_false' && 
               question.type !== 'short_answer' && 
               question.type !== 'essay' && (
                <div className="text-answer-section">
                  <textarea
                    className="answer-textarea"
                    placeholder="Enter your answer here..."
                    value={userAnswers[question.id || question.number] || ''}
                    onChange={(e) => handleAnswerChange(question.id || question.number, e.target.value)}
                    disabled={showAnswers}
                    rows={4}
                  />
                </div>
              )}
              
              {showAnswers && (
                <div className={`answer-reveal ${
                  (() => {
                    const userAns = userAnswers[question.id || question.number];
                    const correctAns = question.correct_answer || question.correctAnswer;
                    if (!userAns || !correctAns) return 'incorrect';
                    // For short answer and essay, show as "review needed" instead of incorrect
                    if (question.type === 'short_answer' || question.type === 'essay') {
                      return 'review';
                    }
                    // For multiple choice and true/false, check exact match
                    const normalizedUser = userAns.trim().toLowerCase();
                    const normalizedCorrect = correctAns.trim().toLowerCase();
                    return normalizedUser === normalizedCorrect ? 'correct' : 'incorrect';
                  })()
                }`}>
                  <div className="correct-answer">
                    <strong>Correct Answer:</strong>
                    {activeLanguage === 'english' ? (
                      <div className="answer-english">{question.correct_answer || question.correctAnswer || 'N/A'}</div>
                    ) : activeLanguage === 'sinhala_google_translate' ? (
                      <div className="answer-sinhala">
                        {question.correct_answer_sinhala_google_translate || question.correct_answer_sinhala || question.correct_answer || question.correctAnswer || 'N/A'}
                      </div>
                    ) : (
                      <div className="answer-sinhala">
                        {question.correct_answer_sinhala || question.correct_answer || question.correctAnswer || 'N/A'}
                      </div>
                    )}
                  </div>
                  {userAnswers[question.id || question.number] && (
                    <div className="user-answer">
                      <strong>Your Answer:</strong> 
                      <div className="user-answer-text">{userAnswers[question.id || question.number]}</div>
                    </div>
                  )}
                  {question.explanation && (
                    <div className="answer-explanation">
                      <strong>Explanation:</strong>
                      {activeLanguage === 'english' ? (
                        <div className="explanation-english">{question.explanation}</div>
                      ) : activeLanguage === 'sinhala_google_translate' ? (
                        <div className="explanation-sinhala">
                          {question.explanation_sinhala_google_translate || question.explanation_sinhala || question.explanation}
                        </div>
                      ) : (
                        <div className="explanation-sinhala">
                          {question.explanation_sinhala || question.explanation}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
              ))
            ) : (
              <div className="no-questions">
                <p>No questions available. Questions will be generated when you launch this assessment.</p>
              </div>
            )}
          </div>
        )}

        <div className="assessment-viewer-footer">
          {!showAnswers && currentUser && (
            <button
              className="btn-submit-attempt"
              onClick={handleSubmitAttempt}
              disabled={isSubmitting}
              style={{
                padding: '10px 20px',
                fontSize: '16px',
                backgroundColor: '#667eea',
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                marginRight: '10px'
              }}
            >
              {isSubmitting ? 'Submitting...' : 'Submit Assessment'}
            </button>
          )}
          
          {showAnswers && score && (
            <div className="score-display" style={{ marginLeft: '10px' }}>
              <strong>Score: {score.correct}/{score.total} ({score.percentage}%)</strong>
            </div>
          )}
          
          {submitSuccess && (
            <div style={{ marginLeft: '10px', color: '#48bb78', fontWeight: 'bold' }}>
              ✓ Submitted successfully!
            </div>
          )}
        </div>
      </div>

      <ConfirmationDialog
        isOpen={showEmptyAnswersModal}
        title="Confirm Submission"
        message="You haven't answered any questions. Are you sure you want to submit?"
        confirmText="Submit Anyway"
        cancelText="Cancel"
        onConfirm={handleConfirmSubmit}
        onCancel={handleCancelSubmit}
        type="archive"
      />
    </div>
  );
}

export default AssessmentViewer;


