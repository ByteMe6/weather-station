#include "portal.h"

#include <Arduino.h>
#include <WiFi.h>

#include "device_config.h"
#include "wifi_link.h"

// Skin for the stock WiFiManager pages, used by both portals.
static const char PORTAL_STYLE[] =
    "<style>"
    "body{background:#edeff2;color:#22262b;font-size:14px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;}"
    ".wrap{background:#fff;max-width:360px;margin:20px auto;padding:20px 18px;"
    "border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.12);}"
    "h1{font-size:16px;font-weight:600;margin:0 0 12px;}"
    // stock css gives buttons line-height:2.4rem, which is what makes them huge
    "button{background:#1a73e8;border:0;border-radius:5px;padding:8px 12px;"
    "font-size:14px;line-height:1.4;cursor:pointer;}"
    "button:hover{background:#1765cc;}"
    "button.D{background:#d93025;}"
    "input,select{border:1px solid #cdd2d9;border-radius:5px;padding:8px 10px;font-size:14px;margin:2px 0 10px;}"
    "input:focus{border-color:#1a73e8;outline:none;box-shadow:0 0 0 2px rgba(26,115,232,.25);}"
    "a{color:#1a73e8;text-decoration:none;}"
    "a:hover{text-decoration:underline;}"
    ".wrap>div>a{display:inline-block;padding:4px 0;font-size:14px;color:#22262b;}"
    ".msg{border-left:3px solid #1a73e8;background:#f2f6fd;padding:10px;border-radius:4px;}"
    ".msg.D{border-color:#d93025;background:#fdf3f2;}"
    ".msg.S{border-color:#188038;background:#f0f9f2;}"
    "</style>";

// Same portal, kept reachable on the LAN once we're connected.
static WiFiManager webPortal;
static bool webPortalRunning = false;

static WiFiManagerParameter apiUrlParam("apiurl", "Backend URL", "", 128);
static bool apiUrlParamAdded = false;

void applyPortalStyle(WiFiManager &wm) {
  wm.setTitle("Weather Station");
  wm.setCustomHeadElement(PORTAL_STYLE);
}

static void syncCredentialsFromWebPortal() {
  // Don't overwrite good creds with an empty ssid (same race as the setup portal).
  String ssid = WiFi.SSID();
  String pass = WiFi.psk();
  if (ssid.length() == 0) return;

  if (adoptWifiCredentials(ssid, pass)) {
    Serial.printf("WiFi credentials updated via web portal: %s\n", ssid.c_str());
    // New network, new IP.
    Serial.printf("Web portal: http://%s/\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("Failed to save updated WiFi credentials to NVS");
  }
}

// Portal callback for the Backend URL field. https is required: the ingest
// path carries a signature over the device secret and must never fall back to
// plaintext, so a http:// entry is refused rather than quietly accepted -
// unless this is an ALLOW_INSECURE_API_URL dev build, which accepts both.
// The check is deliberately the same predicate the upload path uses, so the
// portal can never store a URL that closeUploadWindow() would then refuse.
static void syncApiUrlFromPortal() {
  String url = apiUrlParam.getValue();
  url.trim();
  if (url.length() == 0) return;

  if (!apiUrlSchemeAllowed(url)) {
#ifdef ALLOW_INSECURE_API_URL
    Serial.println("Backend URL rejected: must start with https:// or http://");
#else
    Serial.println("Backend URL rejected: must start with https://");
#endif
    // WiFiManager's save-params page always shows "Saved" no matter what this
    // callback does, so an operator who enters http:// sees success with no
    // visible sign it was rejected unless they're watching serial. Put the
    // field back to what's actually in effect so revisiting the page doesn't
    // keep showing the rejected value as if it had taken.
    apiUrlParam.setValue(configApiUrl().c_str(), 128);
    return;
  }
  if (saveApiUrl(url)) {
    Serial.printf("Backend URL updated: %s\n", configApiUrl().c_str());
  } else {
    Serial.println("Failed to save backend URL to NVS");
  }
}

void startStationWebPortal() {
  applyPortalStyle(webPortal);
  webPortal.setSaveConfigCallback(syncCredentialsFromWebPortal);
  // No captive redirect on the LAN, and cap the connect wait inside process()
  // so a wifi change from the portal can't stall the loop for a minute.
  // A failed change knocks wifi out for a few seconds; the drop handler
  // rejoins the old network.
  webPortal.setCaptivePortalEnable(false);
  webPortal.setSaveConnectTimeout(15);
  apiUrlParam.setValue(configApiUrl().c_str(), 128);
  if (!apiUrlParamAdded) {
    webPortal.addParameter(&apiUrlParam);
    apiUrlParamAdded = true;
  }
  webPortal.setSaveParamsCallback(syncApiUrlFromPortal);
  std::vector<const char *> menu = {"wifi", "param", "info", "restart"};
  webPortal.setMenu(menu);
  webPortal.startWebPortal();
  webPortalRunning = true;
  Serial.printf("Web portal: http://%s/\n", WiFi.localIP().toString().c_str());
}

void stopStationWebPortal() {
  if (!webPortalRunning) return;
  webPortal.stopWebPortal();
  webPortalRunning = false;
}

void processStationWebPortal() { webPortal.process(); }

bool stationWebPortalRunning() { return webPortalRunning; }
