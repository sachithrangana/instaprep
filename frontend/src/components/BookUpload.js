import React, { useState } from 'react';
import Loading from './Loading';
import './BookUpload.css';

function BookUpload({ onClose, onBookUploaded }) {
  const [bookData, setBookData] = useState({
    title: '',
    description: '',
    file: null
  });
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setBookData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setBookData(prev => ({
        ...prev,
        file: file
      }));
      // Auto-fill title if empty
      if (!bookData.title) {
        const fileName = file.name.replace(/\.[^/.]+$/, '');
        setBookData(prev => ({
          ...prev,
          title: fileName
        }));
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!bookData.title || !bookData.file) {
      setError('Please provide a title and select a file');
      return;
    }

    // Prepare form data
    const formData = new FormData();
    formData.append('file', bookData.file);
    formData.append('title', bookData.title);
    formData.append('description', bookData.description || '');

    // Reset form immediately
    setBookData({
      title: '',
      description: '',
      file: null
    });

    // Notify parent that upload is starting
    if (onBookUploaded) {
      onBookUploaded(null, null); // Signal upload start
    }

    // Close modal immediately
    if (onClose) {
      onClose();
    }

    // Start upload asynchronously
    const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
    
    fetch(`${API_BASE}/api/books/upload`, {
      method: 'POST',
      body: formData
    })
    .then(response => {
      if (!response.ok) {
        return response.json().then(errorData => {
          throw new Error(errorData.error || 'Upload failed');
        });
      }
      return response.json();
    })
    .then(result => {
      // Notify parent of success - upload HTTP request completed
      // Handle different response structures: result.book, result, or result.data
      const bookData = result.book || result.data || result;
      if (onBookUploaded) {
        onBookUploaded(bookData, null);
      }
    })
    .catch(err => {
      // Notify parent of error
      if (onBookUploaded) {
        onBookUploaded(null, err.message || 'Failed to upload book');
      }
    });
  };

  return (
    <div className="book-upload-modal">
      <div className="book-upload-content">
        <button className="book-upload-close" onClick={onClose}>×</button>
        
        <h2>Upload New Book</h2>
        
        {error && (
          <div className="upload-error">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="book-upload-form">
          <div className="form-group">
            <label htmlFor="file">Book File *</label>
            <input
              type="file"
              id="file"
              accept=".pdf,.txt,.doc,.docx,.epub"
              onChange={handleFileChange}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="title">Book Title *</label>
            <input
              type="text"
              id="title"
              name="title"
              value={bookData.title}
              onChange={handleInputChange}
              required
              placeholder="Enter book title"
            />
          </div>

          <div className="form-group">
            <label htmlFor="description">Description</label>
            <textarea
              id="description"
              name="description"
              value={bookData.description}
              onChange={handleInputChange}
              placeholder="Enter book description (optional)"
              rows="3"
            />
          </div>

          <div className="form-actions">
            <button
              type="button"
              className="btn-cancel"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-upload"
            >
              Upload Book
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default BookUpload;

