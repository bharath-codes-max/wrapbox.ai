#!/bin/sh
# Build the wrapbox-ocr helper with the command-line Swift toolchain — no Xcode
# project, so CI and a developer laptop produce the same binary from one file.
# Output: macos/ocr/build/wrapbox-ocr (the last path runtime/src/extract/ocr.ts
# probes). Run "./build/wrapbox-ocr --selftest" afterwards to prove Vision works
# on this machine before trusting `wrapboxd capabilities`.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/build"
mkdir -p "$OUT"
xcrun swiftc -O \
  -framework Vision -framework CoreGraphics -framework CoreText -framework ImageIO \
  -framework UniformTypeIdentifiers \
  -o "$OUT/wrapbox-ocr" "$HERE/wrapbox-ocr.swift"
echo "built $OUT/wrapbox-ocr"
