#!/bin/bash
set -e

echo "🧪 TitrVis Setup"
echo "================"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "❌ Node.js is not installed. Please install Node.js ≥ 18.17 from https://nodejs.org/"
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "❌ Node.js 18.17+ required. You have $(node -v). Please upgrade from https://nodejs.org/"
  exit 1
fi

echo "✓ Node.js $(node -v)"
echo "✓ npm $(npm -v)"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
npm install --prefer-offline --no-audit

echo ""
echo "✓ Installation complete!"
echo ""
echo "📖 Quick start:"
echo "   npm run dev          # Start development server at http://localhost:5173"
echo "   npm run build        # Build for production"
echo "   npm test             # Run unit tests"
echo "   npm run test:e2e     # Run browser tests"
echo ""
echo "🎮 Controls:"
echo "   Space (hold)  → titrate (drops fall)"
echo "   Shift (hold)  → swirl the flask"
echo "   1/2/3         → lighting modes"
echo "   R             → reset experiment"
echo "   S             → screenshot"
echo "   H             → toggle panels"
echo ""
echo "Ready to go! Run 'npm run dev' to start."
