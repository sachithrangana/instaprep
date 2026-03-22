import React from 'react';
import './AssessmentList.css';

function AssessmentList({ assessments, onAssessmentClick, onDelete }) {
  if (assessments.length === 0) {
    return (
      <div className="no-assessments">
        <p>No assessments created yet. Create one from a book, course, or section!</p>
      </div>
    );
  }

  const getAssessmentIcon = (type) => {
    switch (type) {
      case 'test': return '📝';
      case 'homework': return '📚';
      case 'exam': return '🎓';
      default: return '📄';
    }
  };

  const getAssessmentColor = (type) => {
    switch (type) {
      case 'test': return '#667eea';
      case 'homework': return '#48bb78';
      case 'exam': return '#f56565';
      default: return '#718096';
    }
  };

  return (
    <div className="assessments-grid">
      {assessments.map((assessment) => (
        <div
          key={assessment.id}
          className="assessment-card"
          style={{ borderTopColor: getAssessmentColor(assessment.type) }}
        >
          <div className="assessment-header">
            <div className="assessment-icon">{getAssessmentIcon(assessment.type)}</div>
            <div className="assessment-info">
              <h3>{assessment.title}</h3>
              <div className="assessment-meta">
                <span className="assessment-type">{assessment.type}</span>
                <span>•</span>
                <span>{assessment.numQuestions || assessment.questions?.length || 0} questions</span>
                <span>•</span>
                <span>{assessment.difficulty}</span>
              </div>
            </div>
            <button
              className="delete-btn"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(assessment.id);
              }}
              title="Delete assessment"
            >
              ×
            </button>
          </div>
          
          <div className="assessment-source">
            <strong>Source:</strong> {assessment.source.title}
            {assessment.sourceType === 'course' && ' (Course)'}
            {assessment.sourceType === 'section' && ' (Section)'}
          </div>

          {assessment.objectives && assessment.objectives.length > 0 && (
            <div className="assessment-objectives">
              <strong>Objectives:</strong>
              <ul>
                {assessment.objectives.slice(0, 3).map((obj, idx) => (
                  <li key={idx}>{obj}</li>
                ))}
                {assessment.objectives.length > 3 && (
                  <li className="more-objectives">+{assessment.objectives.length - 3} more</li>
                )}
              </ul>
            </div>
          )}

          <div className="assessment-footer">
            <button
              className="view-btn"
              onClick={() => onAssessmentClick(assessment)}
            >
              View Assessment
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default AssessmentList;

