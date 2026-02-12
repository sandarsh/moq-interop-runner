#!/bin/bash
# build.sh - Build moq-dev-rs test client Docker image
#
# Usage:
#   ./build.sh

set -euo pipefail

BUILD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[build] Building moq-dev-rs-client:latest"
docker build -t moq-dev-rs-client:latest -f "${BUILD_DIR}/Dockerfile.client" "${BUILD_DIR}"
echo "[build] Done"
