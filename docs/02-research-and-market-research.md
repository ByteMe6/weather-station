# Step 2 — Research & Market Research

## Competitors and Alternatives

### Professional Weather Services
**Public weather apps** (Weather.com, AccuWeather, NOAA, Windy)
- Free, globally available, familiar to everyone
- Data sourced from stations 10–50 km away — useless for a backyard, school field, or farm plot where microclimates diverge sharply from the regional average

**Commercial personal weather stations** (Davis Instruments Vantage Pro, Ambient Weather WS-2902, Netatmo)
- Accurate, reliable, feature-rich
- $150–$600 before software subscriptions; setup requires reading manuals; data visualization lives behind logins or proprietary apps; no native Telegram integration

**DIY Arduino/ESP32 kits and open-source projects** (Wemos D1 + DHT22 tutorials, ESPHome, Tasmota)
- Cheap hardware, endless customization
- No turnkey experience: you hand-assemble sensors, write firmware, configure MQTT brokers, and build your own dashboard — hours of work before a single reading appears; zero support for non-technical users

### "Boring" Alternatives People Actually Use
**Spreadsheets + manual logging** — Some enthusiasts and schools read a thermometer daily and enter values by hand. Cost is zero; the discipline required is high; trend analysis is manual and alerts are impossible.

**Doing nothing** — The default for most households and many schools. They glance at a phone weather app or look out the window. It costs nothing and fails silently: wrong data, no alerts, no history.

**WhatsApp / Telegram group chats with a manual poster** — Some school administrators send a daily "weather update" message themselves. Inconsistent, human-dependent, not automated.

---

## Target User

**Primary: The weather enthusiast** — an amateur meteorologist aged 30–55 who owns a garden, small plot, or property. They already follow r/weather, r/homeautomation, or similar communities. They've probably tried a public weather app and found it wrong for their location, or bought a cheap station and hit a wall configuring software. They want accurate local data and historical trends without paying $400 or learning embedded programming. Budget ceiling: roughly $40–80 for hardware.

**Secondary: The school or institution** — a science teacher, groundskeeper, or administrator at a school or small college. They need to know when to cancel outdoor gym class, a sports event, or a field trip. They communicate with parents and students via Telegram (dominant in Eastern Europe, Ukraine, Central Asia) and want automated morning alerts sent at a fixed time without anyone having to remember to do it. IT support is minimal; setup must be near-zero.

---

## Demand Signal

- Reddit threads on r/weather, r/Arduino, and r/HomeAutomation regularly surface requests for "affordable local weather monitoring" with notifications — the top-voted answers consistently point to either expensive commercial gear or DIY builds that discourage non-technical users.
- Telegram bot usage for school notifications is widespread in Ukraine and Eastern Europe: parent groups, school channels, and municipal services all use it. Automating weather-triggered messages is a repeated ask with no clean existing solution.
- Search volume for "DIY weather station", "ESP32 weather station", and "Telegram weather alert" is steady and growing; Amazon reviews for low-end commercial stations frequently complain about poor apps and missing notification features.
- Netatmo's growth and Ambient Weather's recent expansion into budget tiers signal that the market is real and commercial players are chasing it — but both still leave the notification and simplicity gaps open.
- Educational institutions increasingly adopted app-based communication during COVID and haven't reverted; the infrastructure habit is there, the weather automation layer is missing.

---

## Constraints

**Technical**
- Consumer-grade sensors (DHT22, BMP280) carry ±1–2°C and ±3–5% RH tolerances — fine for hobby and institutional use, not for certified meteorology.
- WiFi is required; rural and remote deployments may need LoRa or cellular fallback.
- Deep-sleep power budgets matter for battery installations; mains power simplifies hardware design significantly.

**Legal and Regulatory**
- User location data and environmental readings stored server-side trigger GDPR (EU/Ukraine) and potentially CCPA; must handle consent and data minimisation from day one.
- Telegram Bot API usage is subject to Telegram's ToS; restricted or blocked in some jurisdictions (Russia, Iran) — relevant to the target market's edges.
- WiFi RF emissions must comply with CE (EU), FCC (US), or local equivalents depending on where hardware ships.

**Market**
- Price sensitivity is high in the primary target markets (Ukraine, Eastern Europe); hardware BOM and shipping costs must stay well below $50 to be viable.
- Large players (Apple HomeKit weather, Google Nest) have distribution and ecosystem lock-in; differentiation must come from simplicity, notification integration, and price — not hardware specs.

---

## Bill of Materials & Cost Estimate

The prototype is built around an Arduino UNO with off-the-shelf modules sourced from a Ukrainian retailer (**arduino.ua**). The mechanical parts — enclosure, anemometer cups, wind vane, and rain-gauge funnel — are **3D-printed in-house**, which keeps the mechanical cost down to filament only.

### Electronics to buy

| Component                          | Purpose                                    | Num | Unit (₴) | Subtotal (₴)      | Where to buy                                                                                             |
| ---------------------------------- | ------------------------------------------ | --- | -------- | ----------------- | -------------------------------------------------------------------------------------------------------- |
| Arduino UNO R3 (CH340)             | Main controller board                      | 1   | 299      | 299               | [arduino.ua/prod2610](https://arduino.ua/prod2610-arduino-uno-r3-ch340)                                  |
| BME280 (I2C)                       | Temperature / humidity / pressure sensor   | 1   | 169      | 169               | [arduino.ua/prod1930](https://arduino.ua/prod1930-bme280-5v-i2c-datchik-temperatyri-vlajnosti-davleniya) |
| SD-card module (SPI)               | Local data logging                         | 1   | 98       | 98                | [arduino.ua/prod589](https://arduino.ua/prod589-modyl-sd-card-dlya-arduino-spi)                          |
| RTC clock module (DS1307 + EEPROM) | Timestamps for logged readings             | 1   | 75       | 75                | [arduino.ua](https://arduino.ua)                                                                         |
| KY-040 rotary encoder              | Wind-vane direction + on-device menu input | 3   | 48       | 144               | [arduino.ua/prod1223](https://arduino.ua/prod1223-modyl-enkoder)                                         |
| Hall sensor A3144 (digital)        | Anemometer + rain-gauge pulse pickup       | 2   | 40       | 80                | [arduino.ua/prod186](https://arduino.ua/prod186-datchik-holla-a3144-cifrovii)                            |
| **Electronics subtotal**           |                                            |     |          | **865 ₴ (≈ $21)** |                                                                                                          |

### Other costs

| Item                                                                  | Cost |
| --------------------------------------------------------------------- | ---- |
| 3D-printed mechanical parts (filament + print time)                   |      |
| Assembly / manufacturing labour                                       |      |
| Software & ongoing support (firmware, backend, Telegram bot, hosting) |      |

---

## Why Build This, and Why Now?

There is a specific and unserved gap between the two existing options: expensive commercial stations with proprietary software, and DIY builds that require embedded engineering skills most users don't have. No affordable, turnkey solution combines accurate local sensor data, a clean setup experience, and automated Telegram notifications in a single package — and that last piece matters more than it sounds, because Telegram is not just a nice-to-have in Eastern European, Ukrainian, and Central Asian markets, it is the communication platform for schools, parent groups, and local institutions. The timing is right because sensor hardware has commoditised to the point where a capable station can be built at a low parts cost (see the BOM above), Telegram's Bot API is stable and well-documented, and a post-COVID generation of school administrators now expects app-based communication and is actively looking for tools to automate it. The gap is real, the moment is practical, and no one has closed it yet.