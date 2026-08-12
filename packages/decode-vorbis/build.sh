#!/bin/bash
set -e
cd "$(dirname "$0")"
# The package index references its worker export, so bundlers retain the worker implementation.
npx esbuild src/decode-vorbis.src.js --bundle --format=esm --outfile=decode-vorbis.js --platform=node \
	--alias:@wasm-audio-decoders/ogg-vorbis=../../node_modules/@wasm-audio-decoders/ogg-vorbis/src/OggVorbisDecoder.js
