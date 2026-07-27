// Minimal Arduino.h stub for host-native tests only (pio test -e native).
// rweather/Crypto's RNG.cpp includes <Arduino.h> for millis()/micros(); the
// tests exercise Ed25519::verify and never run the RNG, so zero-returning
// stubs are enough to let the library compile on the host.
#pragma once

#include <stdint.h>

static inline unsigned long millis(void) { return 0; }
static inline unsigned long micros(void) { return 0; }
