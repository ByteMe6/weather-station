#pragma once

#include "sensor.h"

// The reading pipeline: samples accumulate into a window, the window closes
// into one signed body, and that body is delivered or dropped. Nothing here
// keeps a queue - see UPLOAD_MAX_ATTEMPTS in uploader.cpp for why.
void uploaderAddSample(const SensorSample &sample);

// Opens the window on first call, closes it when the cadence says so, and
// sends or retries whatever is pending.
void uploaderTick();

// WiFi went away: drop anything in flight and start the next window clean.
void uploaderReset(const char *dropReason);
