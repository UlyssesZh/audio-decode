#!/bin/bash
set -e

cp ../decode-opus/src/opus.wasm.js src/opus.wasm.js

npx esbuild src/decode-webm.src.js \
  --bundle \
  --format=esm \
  --outfile=decode-webm.js \
  --platform=node \
  --minify \
  --external:./src/opus.wasm.js \
  --alias:@eshaz/web-worker=../_build/empty-worker.js
