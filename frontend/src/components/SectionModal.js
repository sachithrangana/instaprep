import React, { useEffect } from 'react';
import './SectionModal.css';

function SectionModal({ section, onClose, onCreateAssessment }) {
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

  if (!section) return null;

  const handleCreateFromSection = () => {
    onCreateAssessment({
      source: { id: section.id, title: `Section ${section.section_number}` },
      sourceType: 'section',
      selectedSections: [section]
    });
    onClose();
  };

  return (
    <div className="section-modal" onClick={onClose}>
      <div className="section-modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="section-modal-close" onClick={onClose}>
          ×
        </button>
        <h3>Section {section.section_number}</h3>
        <div className="section-modal-text">{section.full_text}</div>
        <div className="section-modal-footer">
          <span className="section-tokens">{section.n_tokens} tokens</span>
          {onCreateAssessment && (
            <button 
              className="btn-create-from-section"
              onClick={handleCreateFromSection}
            >
              📝 Create Assessment from This Section
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default SectionModal;

