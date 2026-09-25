#pragma once

#include <Arduino.h>

// Everything that lives in NVS and is read by more than one module: device
// identity, the backend URL and the upload cadence. Split out of main.cpp so
// these reach their callers through accessors rather than as file-scope
// globals every part of the firmware could reach into.

// Identity is provisioned into NVS rather than compiled in, so one firmware
// image is valid for the whole fleet. With it in the binary, the single
// image OTA publishes would hand every device the same device_id and secret.
void loadDeviceIdentity();
bool checkIdentity();
const String &configDeviceId();
const String &configDeviceSecret();

void loadApiUrl();
bool saveApiUrl(const String &url);
// Pure predicate over a candidate URL, so the portal can vet what an operator
// typed without installing it first. checkApiUrlScheme() applies it to the URL
// currently in effect and warns once.
bool apiUrlSchemeAllowed(const String &url);
bool checkApiUrlScheme();
const String &configApiUrl();

void loadUploadInterval();
void applyManifestInterval(uint32_t offered);
uint32_t configUploadIntervalMs();
