#!/bin/bash
# PhillyPath Quick Start Script

echo "🦅 Starting PhillyPath..."
echo ""

# Check for API key
if [ -z "$ANTHROPIC_API_KEY" ]; then
  if [ -f "backend/.env" ]; then
    export $(cat backend/.env | xargs)
  else
    echo "⚠️  No ANTHROPIC_API_KEY found."
    echo "   Copy backend/.env.example to backend/.env and add your key."
    echo "   The frontend will still work with demo fallback responses."
    echo ""
  fi
fi

# Install dependencies if needed
echo "📦 Installing Python dependencies..."
cd backend
pip install -r requirements.txt -q --break-system-packages 2>/dev/null || pip install -r requirements.txt -q
cd ..

# Start backend
echo "🚀 Starting backend at http://localhost:8000"
cd backend && python main.py &
BACKEND_PID=$!
cd ..

echo ""
echo "✅ PhillyPath is running!"
echo ""
echo "   🌐 Open frontend/index.html in your browser"
echo "   📡 Backend API: http://localhost:8000"
echo "   📚 API Docs: http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop the backend."

wait $BACKEND_PID
