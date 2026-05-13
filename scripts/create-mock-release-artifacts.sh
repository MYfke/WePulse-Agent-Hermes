#!/usr/bin/env bash

set -euo pipefail

ARTIFACTS_DIR="${1:-build-artifacts}"

rm -rf "$ARTIFACTS_DIR"
mkdir -p "$ARTIFACTS_DIR/windows-build-x64"
mkdir -p "$ARTIFACTS_DIR/macos-build-arm64"

# Windows x64
touch "$ARTIFACTS_DIR/windows-build-x64/WePulse-Agent-Hermes-1.0.0-win-x64.exe"
cat > "$ARTIFACTS_DIR/windows-build-x64/latest.yml" <<'EOF'
version: 1.0.0
files:
  - url: WePulse-Agent-Hermes-1.0.0-win-x64.exe
    sha512: fake-sha512-x64
    size: 100000
path: WePulse-Agent-Hermes-1.0.0-win-x64.exe
sha512: fake-sha512-x64
releaseDate: '2025-01-01'
EOF

# macOS arm64
touch "$ARTIFACTS_DIR/macos-build-arm64/WePulse-Agent-Hermes-1.0.0-mac-arm64.dmg"
touch "$ARTIFACTS_DIR/macos-build-arm64/WePulse-Agent-Hermes-1.0.0-mac-arm64.zip"
cat > "$ARTIFACTS_DIR/macos-build-arm64/latest-mac.yml" <<'EOF'
version: 1.0.0
files:
  - url: WePulse-Agent-Hermes-1.0.0-mac-arm64.zip
    sha512: fake-sha512-mac-arm64
    size: 200000
path: WePulse-Agent-Hermes-1.0.0-mac-arm64.zip
sha512: fake-sha512-mac-arm64
releaseDate: '2025-01-01'
EOF

echo "Mock artifacts created in $ARTIFACTS_DIR:"
find "$ARTIFACTS_DIR" -type f | sort
