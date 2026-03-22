import React, { useState, useEffect, useRef } from 'react';
import './Login.css';

function Login({ onLogin }) {
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const googleButtonRef = useRef(null);

  const handleGoogleSignIn = async (response) => {
    setError(null);
    setLoading(true);

    try {
      // Check if credential exists
      if (!response || !response.credential) {
        console.error('No credential in response:', response);
        throw new Error('No credential received from Google. Please try again.');
      }

      console.log('Google sign-in successful, credential received');
      
      // Decode JWT token client-side (without verification for demo)
      // In production, you should verify the token with Google's public keys
      const credential = response.credential;
      
      try {
        // Decode JWT token
        // Format: header.payload.signature
        const parts = credential.split('.');
        if (parts.length !== 3) {
          throw new Error('Invalid credential format');
        }
        
        // Decode payload (add padding if needed)
        let payload = parts[1];
        const padding = payload.length % 4;
        if (padding) {
          payload += '='.repeat(4 - padding);
        }
        
        // Decode base64 URL-safe encoding
        // Replace URL-safe characters with standard base64 characters
        const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
        const decodedPayload = atob(base64);
        const userInfo = JSON.parse(decodedPayload);
        
        // Extract user information
        const email = userInfo.email || '';
        const name = userInfo.name || email.split('@')[0];
        const picture = userInfo.picture || '';
        
        if (!email) {
          throw new Error('Email not found in Google credential');
        }
        
        // Only allow Gmail accounts
        if (!email.endsWith('@gmail.com')) {
          throw new Error('Only Gmail accounts are allowed');
        }
        
        // Generate a session token
        const token = btoa(`${email}-${Date.now()}`).replace(/[^a-zA-Z0-9]/g, '');
        
        const userData = {
          id: `user-${btoa(email).replace(/[^a-zA-Z0-9]/g, '').substring(0, 8)}`,
          email: email,
          name: name,
          picture: picture,
          role: 'student'
        };
        
        console.log('User data decoded:', userData);
        
        // Store auth token and user info
        localStorage.setItem('authToken', token);
        localStorage.setItem('user', JSON.stringify(userData));
        console.log('User data stored in localStorage');
        
        // Call onLogin callback
        if (onLogin) {
          onLogin(userData, token);
        }
      } catch (decodeError) {
        console.error('Failed to decode credential:', decodeError);
        throw new Error(`Failed to decode credential: ${decodeError.message}`);
      }
    } catch (err) {
      console.error('Login error:', err);
      setError(err.message || 'Failed to login with Google. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Check if script already exists
    let script = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    
    if (!script) {
      script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }

    const initializeGoogleSignIn = () => {
      if (window.google && googleButtonRef.current) {
        const clientId = process.env.REACT_APP_GOOGLE_CLIENT_ID;
        
        if (!clientId) {
          console.error('Google Client ID is not set!');
          setError('Google Client ID is not configured. Please check your environment variables.');
          return;
        }

        console.log('Initializing Google Sign-In with Client ID:', clientId);
        
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: handleGoogleSignIn,
          auto_select: false,
          cancel_on_tap_outside: true
        });

        window.google.accounts.id.renderButton(
          googleButtonRef.current,
          {
            theme: 'filled_blue',
            size: 'large',
            text: 'signin_with',
            width: '100%'
          }
        );

        console.log('Google Sign-In button rendered');
      } else {
        console.warn('Google API not loaded or button ref not available');
      }
    };

    // Wait for script to load
    if (window.google) {
      // Script already loaded
      setTimeout(initializeGoogleSignIn, 100);
    } else {
      // Wait for script to load
      script.onload = () => {
        setTimeout(initializeGoogleSignIn, 100);
      };
    }

    return () => {
      // Cleanup is handled by React
    };
  }, []);

  return (
    <div className="login-container">
      <div className="login-content">
        <div className="login-header">
          <h1>📚 InstaPrep</h1>
          <p>Sign in with your Google account to access your courses and books</p>
        </div>

        {error && (
          <div className="login-error">{error}</div>
        )}

        {loading && (
          <div className="login-loading">
            <p>Signing in...</p>
          </div>
        )}

        <div className="google-signin-container">
          <div ref={googleButtonRef} className="google-signin-button"></div>
        </div>

        <div className="login-info">
          <p className="info-note">🔒 Secure login with Gmail</p>
          <p className="info-text">
            Sign in with your Gmail account to access the platform. 
            Only Gmail accounts (@gmail.com) are allowed.
          </p>
        </div>
      </div>
    </div>
  );
}

export default Login;

