#!/bin/bash
# Development startup script - starts both backend and frontend

cd "$(dirname "$0")"

echo "Starting Book Browser in development mode..."
echo ""
echo "Terminal 1: Starting Flask backend..."
source venv/bin/activate
python app/main.py &
BACKEND_PID=$!

echo "Backend started (PID: $BACKEND_PID)"
echo ""
echo "Terminal 2: Starting React frontend..."
cd frontend
npm start &
FRONTEND_PID=$!

echo "Frontend started (PID: $FRONTEND_PID)"
echo ""
echo "Backend: http://localhost:5000"
echo "Frontend: http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop both servers"

# Wait for user interrupt
trap "kill $BACKEND_PID $FRONTEND_PID; exit" INT
wait

