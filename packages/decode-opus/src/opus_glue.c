#include <stdlib.h>
#include <opus.h>
#include <opus_multistream.h>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define EXPORT
#endif

typedef struct {
	OpusMSDecoder *decoder;
	float *interleaved;
	float *planar;
	int channels;
	int frame_size;
	int pre_skip;
} AudioOpusDecoder;

static int last_error = OPUS_OK;

EXPORT AudioOpusDecoder *audio_opus_create(
	int sample_rate,
	int channels,
	int streams,
	int coupled_streams,
	const unsigned char *mapping,
	int pre_skip,
	int output_gain
) {
	last_error = OPUS_OK;
	if (channels < 1 || !mapping || pre_skip < 0) {
		last_error = OPUS_BAD_ARG;
		return NULL;
	}

	AudioOpusDecoder *state = calloc(1, sizeof(*state));
	if (!state) {
		last_error = OPUS_ALLOC_FAIL;
		return NULL;
	}

	state->channels = channels;
	state->frame_size = sample_rate * 120 / 1000;
	state->pre_skip = pre_skip;
	state->decoder = opus_multistream_decoder_create(
		sample_rate,
		channels,
		streams,
		coupled_streams,
		mapping,
		&last_error
	);
	if (!state->decoder || last_error != OPUS_OK) goto fail;

	last_error = opus_multistream_decoder_ctl(state->decoder, OPUS_SET_GAIN(output_gain));
	if (last_error != OPUS_OK) goto fail;

	size_t samples = (size_t)state->frame_size * channels;
	state->interleaved = malloc(samples * sizeof(float));
	state->planar = malloc(samples * sizeof(float));
	if (!state->interleaved || !state->planar) {
		last_error = OPUS_ALLOC_FAIL;
		goto fail;
	}

	return state;

fail:
	if (state->decoder) opus_multistream_decoder_destroy(state->decoder);
	free(state->interleaved);
	free(state->planar);
	free(state);
	return NULL;
}

EXPORT int audio_opus_decode(AudioOpusDecoder *state, const unsigned char *packet, int length) {
	if (!state || length < 0) return OPUS_BAD_ARG;
	/* A packet is at least one byte (RFC 6716); NULL input would trigger loss concealment. */
	if (!length) return OPUS_INVALID_PACKET;
	if (!packet) return OPUS_BAD_ARG;

	int decoded = opus_multistream_decode_float(
		state->decoder,
		packet,
		length,
		state->interleaved,
		state->frame_size,
		0
	);
	if (decoded <= 0) return decoded;

	int skip = state->pre_skip < decoded ? state->pre_skip : decoded;
	state->pre_skip -= skip;
	int samples = decoded - skip;

	for (int channel = 0; channel < state->channels; channel++) {
		float *output = state->planar + channel * samples;
		for (int sample = 0; sample < samples; sample++)
			output[sample] = state->interleaved[(sample + skip) * state->channels + channel];
	}

	return samples;
}

EXPORT float *audio_opus_output(AudioOpusDecoder *state) {
	return state ? state->planar : NULL;
}

EXPORT int audio_opus_last_error(void) {
	return last_error;
}

EXPORT void audio_opus_destroy(AudioOpusDecoder *state) {
	if (!state) return;
	opus_multistream_decoder_destroy(state->decoder);
	free(state->interleaved);
	free(state->planar);
	free(state);
}
