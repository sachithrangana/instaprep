import React, { useState } from 'react';
import './FeedbackForm.css';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

function FeedbackForm({ user, onClose }) {
  const [formData, setFormData] = useState({
    type: 'general',
    rating: 5,
    message: '',
    email: user?.email || '',
    context: window.location.pathname
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError('');

    if (!formData.message.trim()) {
      setSubmitError('Please enter your feedback message.');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...formData,
          user_id: user?.id || null,
          user_name: user?.name || user?.email || null
        })
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to submit feedback');
      }

      setSubmitSuccess(true);
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (error) {
      setSubmitError(error.message || 'Failed to submit feedback. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="feedback-modal" onClick={onClose}>
      <div className="feedback-content" onClick={(e) => e.stopPropagation()}>
        <button className="feedback-close" onClick={onClose}>x</button>
        <h2>Share Feedback</h2>
        <p className="feedback-subtitle">Tell us what is working and what we can improve.</p>

        <form onSubmit={handleSubmit} className="feedback-form">
          <label>
            Feedback Type
            <select
              value={formData.type}
              onChange={(e) => handleChange('type', e.target.value)}
            >
              <option value="general">General</option>
              <option value="bug">Bug Report</option>
              <option value="feature">Feature Request</option>
              <option value="ui">UI/UX</option>
            </select>
          </label>

          <label>
            Rating (1-5)
            <input
              type="number"
              min="1"
              max="5"
              value={formData.rating}
              onChange={(e) => handleChange('rating', e.target.value)}
            />
          </label>

          <label>
            Message
            <textarea
              rows={5}
              value={formData.message}
              onChange={(e) => handleChange('message', e.target.value)}
              placeholder="Write your feedback..."
              required
            />
          </label>

          <label>
            Email (optional)
            <input
              type="email"
              value={formData.email}
              onChange={(e) => handleChange('email', e.target.value)}
              placeholder="you@example.com"
            />
          </label>

          {submitError && <div className="feedback-error">{submitError}</div>}
          {submitSuccess && <div className="feedback-success">Thanks! Feedback submitted.</div>}

          <div className="feedback-actions">
            <button type="button" onClick={onClose} className="feedback-btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={isSubmitting} className="feedback-btn-primary">
              {isSubmitting ? 'Submitting...' : 'Submit Feedback'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default FeedbackForm;
