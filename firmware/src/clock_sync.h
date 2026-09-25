#pragma once

// Wall-clock time, needed for both the payload timestamp and TLS certificate
// validity. Its own module rather than part of ota.cpp because the two users
// want opposite things: ota.cpp pays the blocking sync once at boot, while
// uploader.cpp only ever observes the result.

// Blocking, up to 10 s. Polls the reset button while it waits. Records the
// outcome, so a later ensureClock() sees it.
bool syncClock();

// Non-blocking. True once NTP has answered - at boot or at any point since.
bool ensureClock();
