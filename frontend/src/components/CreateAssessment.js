import React, { useState } from 'react';
import './CreateAssessment.css';

function CreateAssessment({ 
  source, 
  sourceType, 
  selectedSections = [],
  onClose,
  onCreate 
}) {
  const [assessmentType, setAssessmentType] = useState('test');
  const [title, setTitle] = useState('');
  const [difficulty, setDifficulty] = useState('medium');
  const [numQuestions, setNumQuestions] = useState(10);
  const [questionTypes, setQuestionTypes] = useState({
    multipleChoice: true,
    shortAnswer: true,
    essay: false,
    trueFalse: false
  });
  const [loading, setLoading] = useState(false);

  const handleQuestionTypeChange = (type) => {
    setQuestionTypes(prev => ({
      ...prev,
      [type]: !prev[type]
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    const assessmentData = {
      type: assessmentType,
      title: title || `${assessmentType.charAt(0).toUpperCase() + assessmentType.slice(1)} - ${source.title || source.name}`,
      sourceType,
      source: {
        id: source.id,
        title: source.title || source.name
      },
      selectedSections,
      difficulty,
      numQuestions,
      questionTypes,
      objectives: []  // No longer accepting user input for objectives
    };

    try {
      // Call API to generate assessment
      const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
      const response = await fetch(`${API_BASE}/assessments/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(assessmentData)
      });

      if (!response.ok) {
        throw new Error('Failed to create assessment');
      }

      const result = await response.json();
      
      // Merge API response with our data
      const finalAssessment = {
        ...assessmentData,
        ...result.assessment
      };
      
      onCreate(finalAssessment);
      setLoading(false);
      onClose();
    } catch (error) {
      console.error('Error creating assessment:', error);
      // Fallback to local creation if API fails
      onCreate(assessmentData);
      setLoading(false);
      onClose();
    }
  };

  const getSourceInfo = () => {
    if (sourceType === 'course') {
      return {
        name: source.title,
        itemCount: `${source.books.length} books`,
        totalSections: source.totalSections
      };
    } else if (sourceType === 'book') {
      return {
        name: source.title,
        itemCount: `${source.total_sections || 0} sections`,
        totalSections: source.total_sections || 0
      };
    } else {
      return {
        name: `Section ${selectedSections.length > 0 ? selectedSections[0].section_number : ''}`,
        itemCount: `${selectedSections.length} section(s)`,
        totalSections: selectedSections.length
      };
    }
  };

  const sourceInfo = getSourceInfo();

  return (
    <div className="assessment-modal" onClick={onClose}>
      <div className="assessment-modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="assessment-modal-close" onClick={onClose}>×</button>
        
        <h2>Create Assessment</h2>
        
        <div className="source-info">
          <h3>Source: {sourceInfo.name}</h3>
          <p>{sourceInfo.itemCount} • {sourceInfo.totalSections} total sections</p>
        </div>

        <form onSubmit={handleSubmit} className="assessment-form">
          <div className="form-group">
            <label>Assessment Type</label>
            <div className="assessment-type-buttons">
              <button
                type="button"
                className={assessmentType === 'test' ? 'active' : ''}
                onClick={() => setAssessmentType('test')}
              >
                📝 Test
              </button>
              <button
                type="button"
                className={assessmentType === 'homework' ? 'active' : ''}
                onClick={() => setAssessmentType('homework')}
              >
                📚 Homework
              </button>
              <button
                type="button"
                className={assessmentType === 'exam' ? 'active' : ''}
                onClick={() => setAssessmentType('exam')}
              >
                🎓 Exam
              </button>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="title">Title (optional)</label>
            <input
              type="text"
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`Auto-generated: ${assessmentType} - ${sourceInfo.name}`}
            />
          </div>

          <div className="form-group">
            <label htmlFor="difficulty">Difficulty Level</label>
            <select
              id="difficulty"
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
              <option value="advanced">Advanced</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="numQuestions">Number of Questions</label>
            <input
              type="number"
              id="numQuestions"
              value={numQuestions}
              onChange={(e) => setNumQuestions(parseInt(e.target.value) || 10)}
              min="1"
              max="100"
            />
          </div>

          <div className="form-group">
            <label>Question Types</label>
            <div className="question-types">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={questionTypes.multipleChoice}
                  onChange={() => handleQuestionTypeChange('multipleChoice')}
                />
                Single Choice
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={questionTypes.shortAnswer}
                  onChange={() => handleQuestionTypeChange('shortAnswer')}
                />
                Short Answer
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={questionTypes.essay}
                  onChange={() => handleQuestionTypeChange('essay')}
                />
                Essay
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={questionTypes.trueFalse}
                  onChange={() => handleQuestionTypeChange('trueFalse')}
                />
                True/False
              </label>
            </div>
          </div>

          <div className="form-actions">
            <button type="button" onClick={onClose} className="btn-cancel">
              Cancel
            </button>
            <button type="submit" className="btn-create" disabled={loading}>
              {loading ? 'Creating...' : `Create ${assessmentType.charAt(0).toUpperCase() + assessmentType.slice(1)}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CreateAssessment;

