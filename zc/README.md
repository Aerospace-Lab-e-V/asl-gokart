# Zone Controller (ZC) Source Code

Dieser Ordner enthält den Quellcode für die verschiedenen Zone Controller (ZC)

## Pinout-Übersicht

Die GPIO-Belegung aller Zone Controller wird automatisch aus der Firmware generiert und unter
https://aerospace-lab-e-v.github.io/asl-gokart/ veröffentlicht (bei jedem Merge auf `main`).
Pins werden erkannt, wenn ihr Name `PIN` enthält, z. B. in der `config.hpp`:

```cpp
static constexpr int RELAY_1_PIN = 13; // Kommentar erscheint als Beschreibung
```

Lokal erzeugen: `python zc/tools/pinout_docs/gen_pinout_docs.py --output-dir /tmp/pinout`

## Fahrzeugnetz

Das Fahrzeug-LAN ist `10.77.0.0/24` mit festen Adressen und ohne Router, daher ohne Gateway. Es darf sich nicht mit
dem WLAN der Head Unit überschneiden (im Lab `192.168.1.0/24`), sonst schickt die Head Unit ihren WLAN-Verkehr ins
Fahrzeug.

| Adresse       | Gerät                  |
| ------------- | ---------------------- |
| `10.77.0.4`   | zc_lights              |
| `10.77.0.5`   | zc_buttons             |
| `10.77.0.6`   | zc_battery             |
| `10.77.0.7`   | zc_motor               |
| `10.77.0.100` | Head Unit (Pi, `eth0`) |

Die Adresse eines Zone Controllers steht in `ETH.config` in seiner `src/main.cpp`. Einrichtung der Head Unit:
[`infotainment/headunit/README.md`](../infotainment/headunit/README.md#pi-setup).
