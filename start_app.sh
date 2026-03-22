#!/bin/bash
# Startup script for the Book Browser application

cd "$(dirname "$0")"
source venv/bin/activate
echo "Starting Book Browser application..."
echo "Open http://localhost:5000 in your browser"
python app/main.py

