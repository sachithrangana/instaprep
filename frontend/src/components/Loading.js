import React from 'react';
import './Loading.css';

function Loading({ message = 'Loading...', submessage = null, overlay = true, size = 'medium' }) {
  const spinnerSizeClass = `spinner-${size}`;
  
  const content = (
    <div className="loading-container">
      <div className={`loading-spinner ${spinnerSizeClass}`}></div>
      <p className="loading-text">{message}</p>
      {submessage && <p className="loading-subtext">{submessage}</p>}
    </div>
  );

  if (overlay) {
    return (
      <div className="loading-overlay">
        {content}
      </div>
    );
  }

  return content;
}

export default Loading;

