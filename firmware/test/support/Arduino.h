// Minimal Arduino.h stub for host-native tests only (pio test -e native).
// rweather/Crypto's RNG.cpp includes <Arduino.h> for millis()/micros(); the
// tests exercise Ed25519::verify and never run the RNG, but back the clocks
// with steady_clock anyway so timing code that does sneak in sees real
// elapsed time instead of silently frozen zeros.
#pragma once

#include <stdint.h>
#include <chrono>

static inline unsigned long millis(void) {
  return (unsigned long)(std::chrono::steady_clock::now().time_since_epoch() /
                         std::chrono::milliseconds(1));
}

static inline unsigned long micros(void) {
  return (unsigned long)(std::chrono::steady_clock::now().time_since_epoch() /
                         std::chrono::microseconds(1));
}
