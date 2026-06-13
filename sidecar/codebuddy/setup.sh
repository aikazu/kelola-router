#!/bin/bash
# CodeBuddy Sidecar — Setup Script (Linux/macOS/Git Bash)
# Usage: ./setup.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== CodeBuddy Sidecar Setup ==="

# 1. Check Python
PYTHON=""
for cmd in python3.11 python3 python; do
    if command -v "$cmd" &>/dev/null; then
        version=$("$cmd" --version 2>&1 | grep -oP '\d+\.\d+')
        major=$(echo "$version" | cut -d. -f1)
        minor=$(echo "$version" | cut -d. -f2)
        if [ "$major" -ge 3 ] && [ "$minor" -ge 11 ]; then
            PYTHON="$cmd"
            break
        fi
    fi
done

if [ -z "$PYTHON" ]; then
    echo "❌ Python 3.11+ required but not found."
    echo "   Install via: winget install Python.Python.3.11 / brew install python@3.11"
    exit 1
fi

echo "✅ Python: $($PYTHON --version)"

# 2. Create venv
if [ ! -d ".venv" ]; then
    echo "→ Creating virtual environment..."
    "$PYTHON" -m venv .venv
else
    echo "✅ venv already exists"
fi

# 3. Determine pip path
if [ -f ".venv/Scripts/pip.exe" ]; then
    PIP=".venv/Scripts/pip.exe"
    PYTHON_VENV=".venv/Scripts/python.exe"
elif [ -f ".venv/bin/pip" ]; then
    PIP=".venv/bin/pip"
    PYTHON_VENV=".venv/bin/python"
else
    echo "❌ Cannot find pip in venv"
    exit 1
fi

# 4. Install dependencies
echo "→ Installing dependencies..."
"$PIP" install -r requirements.txt --quiet

# 5. Install Playwright Firefox
echo "→ Installing Playwright Firefox browser..."
"$PYTHON_VENV" -m playwright install firefox

# 6. Install Camoufox binary + GeoIP
echo "→ Installing Camoufox binary..."
"$PYTHON_VENV" -m camoufox fetch

# 7. Create cookies directory
mkdir -p cookies

# 8. Verify
echo "→ Verifying sidecar..."
RESULT=$(echo '{"cmd": "shutdown"}' | "$PYTHON_VENV" main.py 2>/dev/null)
if echo "$RESULT" | grep -q "shutdown_ack"; then
    echo "✅ Sidecar verified — ready!"
else
    echo "❌ Verification failed. Output: $RESULT"
    exit 1
fi

echo ""
echo "=== Setup Complete ==="
echo "Sidecar path: $SCRIPT_DIR"
echo "Python venv:  $SCRIPT_DIR/.venv"
echo "Run with:     echo '{\"cmd\": \"shutdown\"}' | $PYTHON_VENV main.py"
