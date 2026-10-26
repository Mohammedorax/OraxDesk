#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
cargo tauri build --debug --bundles app --config '{"productName":"OraxDesk Boundary Test","identifier":"com.altrosyn.deskvnc.boundarytest"}'
