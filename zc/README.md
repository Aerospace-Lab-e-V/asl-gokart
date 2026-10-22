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
