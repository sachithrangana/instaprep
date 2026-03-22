import React, { useState } from 'react';
import './BookDetails.css';

function BookDetails({ book, onSectionClick, onCreateAssessment }) {
  const [selectedSections, setSelectedSections] = useState([]);

  const handleSectionToggle = (section, e) => {
    e.stopPropagation();
    setSelectedSections(prev => {
      const sectionId = section.section_id || section.id;
      const exists = prev.find(s => 
        (s.section_id && s.section_id === sectionId) || 
        (s.id && s.id === sectionId) ||
        (s === section)
      );
      if (exists) {
        return prev.filter(s => 
          !((s.section_id && s.section_id === sectionId) || 
            (s.id && s.id === sectionId) ||
            (s === section))
        );
      } else {
        return [...prev, section];
      }
    });
  };

  const handleCreateFromBook = () => {
    onCreateAssessment({
      source: book,
      sourceType: 'book',
      selectedSections: [] // Empty means entire book
    });
  };

  const handleCreateFromSections = () => {
    if (selectedSections.length === 0) {
      alert('Please select at least one section');
      return;
    }
    onCreateAssessment({
      source: book,
      sourceType: 'section',
      selectedSections
    });
  };

  return (
    <div className="book-details">
      <div className="book-details-header">
        <div>
          <h2>{book.title}</h2>
          <div className="project-info">
            Project: {book.project_name} • {book.total_sections} sections
          </div>
        </div>
        <div className="assessment-actions">
          <button 
            className="btn-create-assessment"
            onClick={handleCreateFromBook}
            title="Create assessment from entire book"
          >
            📝 Create Assessment (Full Book)
          </button>
          {selectedSections.length > 0 && (
            <button 
              className="btn-create-assessment-selected"
              onClick={handleCreateFromSections}
            >
              📝 Create from {selectedSections.length} Selected Section{selectedSections.length > 1 ? 's' : ''}
            </button>
          )}
        </div>
      </div>

      {selectedSections.length > 0 && (
        <div className="selection-info">
          {selectedSections.length} section{selectedSections.length > 1 ? 's' : ''} selected
          <button 
            className="btn-clear-selection"
            onClick={() => setSelectedSections([])}
          >
            Clear Selection
          </button>
        </div>
      )}

      {(() => {
        // Get sections from structured format (new) or old format
        let sectionsToDisplay = [];
        
        if (book.sections && Array.isArray(book.sections) && book.sections.length > 0) {
          // New structured format: array of section objects with section_id
          sectionsToDisplay = book.sections;
        } else if (book.chapters && Array.isArray(book.chapters)) {
          // Extract sections from chapters (structured format)
          book.chapters.forEach(chapter => {
            if (chapter.sections && Array.isArray(chapter.sections)) {
              sectionsToDisplay = sectionsToDisplay.concat(chapter.sections);
            }
          });
        }
        
        if (sectionsToDisplay.length > 0) {
          return (
            <div className="sections-list">
              {sectionsToDisplay.map((section, index) => {
                const sectionId = section.section_id || section.id || index;
                const isSelected = selectedSections.find(s => 
                  (s.section_id && s.section_id === sectionId) || 
                  (s.id && s.id === sectionId) ||
                  (s === section)
                );
                return (
                  <div
                    key={sectionId}
                    className={`section-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => onSectionClick(section)}
                  >
                    <div className="section-header">
                      <h4>{section.title || section.name || `Section ${section.section_index !== undefined ? section.section_index + 1 : index + 1}`}</h4>
                      <label className="section-checkbox">
                        <input
                          type="checkbox"
                          checked={!!isSelected}
                          onChange={(e) => handleSectionToggle(section, e)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        Select
                      </label>
                    </div>
                    <div className="section-preview">{section.text || section.description || ''}</div>
                    {section.text_id && (
                      <div className="section-meta">ID: {section.text_id}</div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        } else {
          return <p className="no-sections">No sections available for this book.</p>;
        }
      })()}
    </div>
  );
}

export default BookDetails;

