/**
 * libgsm WASM glue, decode half: 33-byte GSM 06.10 frames → 160 samples at 8 kHz, 16-bit
 */

#include "gsm.h"
#include <emscripten/emscripten.h>

EMSCRIPTEN_KEEPALIVE gsm gsmw_create(void) { return gsm_create(); }

EMSCRIPTEN_KEEPALIVE void gsmw_destroy(gsm g) { gsm_destroy(g); }

/* n frames from `in` into `pcm`; the frames decoded, up to the first without the GSM signature */
EMSCRIPTEN_KEEPALIVE int gsmw_decode(gsm g, gsm_byte *in, gsm_signal *pcm, int n) {
	for (int i = 0; i < n; i++) if (gsm_decode(g, in + 33 * i, pcm + 160 * i)) return i;
	return n;
}
