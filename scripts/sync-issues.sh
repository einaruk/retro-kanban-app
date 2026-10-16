#!/usr/bin/env bash
# issues.js, retro-kanban deposundaki src/issues.js'in kopyasıdır: kart ↔ issue eşlemesi iki
# tarafta birebir aynı olmalı. retro-kanban'da değişince bunu çalıştırıp commit'leyin.
set -euo pipefail
HERE=$(cd "$(dirname "$0")/.." && pwd)
SRC=${RK_REPO:-$HERE/../retro-kanban}/src/issues.js
if cmp -s "$SRC" "$HERE/issues.js"; then echo "issues.js güncel."; exit 0; fi
cp "$SRC" "$HERE/issues.js"
echo "issues.js güncellendi:"; git -C "$HERE" --no-pager diff --stat -- issues.js
