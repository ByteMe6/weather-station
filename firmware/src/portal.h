#pragma once

#include <WiFiManager.h>

// The WiFiManager-driven config UI: the shared skin, and the portal that stays
// reachable on the LAN once the station is connected. The provisioning portal
// that runs before any credentials exist lives in wifi_link.cpp, with the
// phase machine it drives; both use applyPortalStyle().
void applyPortalStyle(WiFiManager &wm);

void startStationWebPortal();
void stopStationWebPortal();
void processStationWebPortal();
bool stationWebPortalRunning();
