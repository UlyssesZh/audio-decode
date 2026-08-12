#!/bin/bash
set -e
cd "$(dirname "$0")"
# The package index references its worker export, so bundlers retain the worker implementation.
npx esbuild src/decode-mp3.src.js --bundle --format=esm --outfile=decode-mp3.js --platform=node \
	--alias:mpg123-decoder=../../node_modules/mpg123-decoder/src/MPEGDecoder.js \
	--inject:../_build/text-decoder.js
