import React from 'react';
import './ConfirmationDialog.css';

function ConfirmationDialog({ 
  isOpen, 
  title, 
  message, 
  confirmText = 'Confirm', 
  cancelText = 'Cancel',
  onConfirm, 
  onCancel,
  type = 'archive' // 'archive', 'unarchive', or 'logout'
}) {
  if (!isOpen) return null;

  const getIcon = () => {
    switch(type) {
      case 'archive':
        return '📦';
      case 'unarchive':
        return '📤';
      case 'logout':
        return '🚪';
      case 'delete':
        return '🗑️';
      default:
        return '❓';
    }
  };

  return (
    <div className="confirmation-dialog-overlay" onClick={onCancel}>
      <div className="confirmation-dialog-content" onClick={(e) => e.stopPropagation()}>
        <div className="confirmation-dialog-header">
          <h3>{title}</h3>
          <button className="confirmation-dialog-close" onClick={onCancel}>×</button>
        </div>
        <div className="confirmation-dialog-body">
          <div className="confirmation-icon">
            {getIcon()}
          </div>
          <p>{message}</p>
        </div>
        <div className="confirmation-dialog-actions">
          <button 
            className="btn-confirm-cancel"
            onClick={onCancel}
          >
            {cancelText}
          </button>
          <button 
            className={`btn-confirm-${type}`}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmationDialog;

