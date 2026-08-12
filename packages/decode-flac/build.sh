#!/bin/bash
set -e
cd "$(dirname "$0")"
# The package index references its worker export, so bundlers retain the worker implementation.
npx esbuild src/decode-flac.src.js --bundle --format=esm --outfile=decode-flac.js --platform=node \
	--alias:@wasm-audio-decoders/flac=../../node_modules/@wasm-audio-decoders/flac/src/FLACDecoder.js \
	--inject:../_build/text-decoder.js
