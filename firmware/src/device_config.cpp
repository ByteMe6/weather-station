#include "device_config.h"

#include <Preferences.h>
#include <upload.h>
#include <ota_state.h>

static Preferences idPrefs;
static String deviceId;
static String deviceSecret;
static bool identityWarned = false;

// Where readings go. NVS wins over the flash-time API_URL so the endpoint can
// be repointed from the portal without a reflash.
static Preferences cfgPrefs;
static String apiUrl;

// Upload cadence. NVS wins over the compiled default so the manifest can
// change it without a reflash; the compiled value is only the fallback for a
// device that has never seen a manifest.
static uint32_t uploadIntervalMs = (uint32_t)SEND_INTERVAL_MS;

void loadDeviceIdentity() {
  idPrefs.begin("id", true);
  deviceId = idPrefs.getString("device_id", "");
  deviceSecret = idPrefs.getString("secret", "");
  idPrefs.end();
}

const String &configDeviceId() { return deviceId; }

const String &configDeviceSecret() { return deviceSecret; }

// Uploads are refused, but WiFi, the portal and the OTA check keep running -
// that is what lets a mis-provisioned device be recovered without physical
// access. Warned once: closeUploadWindow() calls this every window and the
// condition cannot change without a reflash.
bool checkIdentity() {
  if (deviceId.length() > 0 && deviceSecret.length() > 0) return true;
  if (!identityWarned) {
    identityWarned = true;
    Serial.println("No device identity in NVS, uploads disabled - reflash nvs.bin");
  }
  return false;
}

// https is required everywhere the URL can come from, not just the portal
// field: the ingest path carries a signature over the device secret, and a
// plaintext endpoint would put both the signature and the reading on the wire
// in the clear. secrets.ini predates this check, so the flash-time API_URL
// fallback is the realistic way an http:// URL gets in here. Warned once -
// closeUploadWindow() calls this every 5-minute window and a repeat log line
// for a condition that can't change without a reflash or a portal save is
// just noise.
//
// ALLOW_INSECURE_API_URL relaxes this to also accept http://, for developing
// against a server on the LAN where a publicly trusted certificate is not
// practical to stand up. It is set only by the esp32dev-local build env, never
// from secrets.ini: that file is per-device and gets copied between them, so a
// flag living there would eventually reach a device shipping real readings.
// Choosing a different build target is a deliberate act; copying a config file
// is not.
static bool apiUrlWarned = false;

bool apiUrlSchemeAllowed(const String &url) {
  if (url.startsWith("https://")) return true;
#ifdef ALLOW_INSECURE_API_URL
  if (url.startsWith("http://")) return true;
#endif
  return false;
}

bool checkApiUrlScheme() {
  if (apiUrlSchemeAllowed(apiUrl)) return true;
  if (!apiUrlWarned) {
    apiUrlWarned = true;
    Serial.printf("Backend URL is not https, uploads disabled: %s\n", apiUrl.c_str());
  }
  return false;
}

void loadApiUrl() {
  cfgPrefs.begin("cfg", true);
  apiUrl = cfgPrefs.getString("apiurl", "");
  cfgPrefs.end();
  if (apiUrl.length() == 0) apiUrl = API_URL;
#ifdef ALLOW_INSECURE_API_URL
  // Loud on every boot, not warn-once: this build will happily put a signed
  // reading on the wire in plaintext, and the log is the only place that says
  // so. If this line shows up on a device that is meant to be in the field,
  // it was built from the wrong target.
  Serial.println("*** ALLOW_INSECURE_API_URL build - http:// backends accepted, DEV ONLY ***");
#endif
  checkApiUrlScheme();
}

// Adopts the URL in memory only once NVS has taken it, so a failed write
// leaves the running endpoint untouched rather than pointing the uploader at
// something the next boot would not reproduce.
bool saveApiUrl(const String &url) {
  if (!cfgPrefs.begin("cfg", false)) return false;
  size_t written = cfgPrefs.putString("apiurl", url);
  cfgPrefs.end();
  if (written != url.length()) return false;
  apiUrl = url;
  return true;
}

const String &configApiUrl() { return apiUrl; }

void loadUploadInterval() {
  cfgPrefs.begin("cfg", true);
  uint32_t stored = cfgPrefs.getUInt("interval", 0);
  cfgPrefs.end();
  if (isAcceptableInterval(stored)) uploadIntervalMs = stored;
}

// Applied on every valid manifest, not only on a newer version:
// isNewerVersion() gates the image download, and gating config the same way
// would mean a cadence change needed a FW_VERSION bump and a full image
// republish - exactly what carrying it in the manifest is meant to avoid.
void applyManifestInterval(uint32_t offered) {
  if (!isAcceptableInterval(offered)) {
    Serial.printf("OTA: interval %u out of range, keeping %u\n", offered, uploadIntervalMs);
    return;
  }
  if (offered == uploadIntervalMs) return;

  cfgPrefs.begin("cfg", false);
  cfgPrefs.putUInt("interval", offered);
  cfgPrefs.end();
  uploadIntervalMs = offered;
  Serial.printf("Upload interval set to %u ms\n", uploadIntervalMs);
}

uint32_t configUploadIntervalMs() { return uploadIntervalMs; }
