#include <Arduino.h>
#include "esp_log.h"
#include <ETH.h>
#include <sero.hpp>
#include <udp_transport_esp32.hpp>
#include "temp_sensor.hpp"
#include "battery_service.hpp"
#include "daly-bms-uart.h"

const char* FIRMWARE_VERSION = "0.3.0";

// --- Type Aliases -----------------------------------------------

using Runtime = sero::Runtime<esp32_app::UdpTransportEsp32, Esp32Config>;
using Addr    = sero::Address<Esp32Config>;

// --- Global Objects ---------------------------------------------

static esp32_app::UdpTransportEsp32 transport;
static Runtime* runtime_ptr = nullptr;

static TempSensor temp_sensor;

#define BMS_SERIAL Serial1
static Daly_BMS_UART bms(BMS_SERIAL);

// --- Timing -----------------------------------------------------

static constexpr uint32_t BMS_POLL_INTERVAL_MS  = 100;
static constexpr uint32_t TEMP_POLL_INTERVAL_MS = 2000;

static uint32_t last_bms_poll     = 0;
static uint32_t last_temp_request = 0;

// Cached BMS values for change-detection
static float last_voltage = 0.0f;
static float last_current = 0.0f;

// --- Function Declarations --------------------------------------

void WiFiEvent(WiFiEvent_t event);
void connect_ethernet();

// ----------------------------------------------------------------

void WiFiEvent(WiFiEvent_t event) {
    switch (event) {
        case ARDUINO_EVENT_ETH_START:
            Serial.println("ETH Started");
            ETH.setHostname("zc-battery");
            break;
        case ARDUINO_EVENT_ETH_CONNECTED:
            Serial.println("ETH Connected");
            break;
        case ARDUINO_EVENT_ETH_GOT_IP:
            Serial.print("ETH IP Address: ");
            Serial.println(ETH.localIP());
            break;
        case ARDUINO_EVENT_ETH_DISCONNECTED:
            Serial.println("ETH Disconnected");
            break;
        case ARDUINO_EVENT_ETH_STOP:
            Serial.println("ETH Stopped");
            break;
        default:
            break;
    }
}

void connect_ethernet() {
    // Hold Ethernet PHY in reset during initial startup delay
    pinMode(12, OUTPUT);
    digitalWrite(12, LOW);

    esp_log_level_set("*", ESP_LOG_VERBOSE);
    Serial.begin(115200);
    delay(1000);
    Serial.println("####################################");
    Serial.println("ZC_BATTERY Fw. v." + String(FIRMWARE_VERSION));
    Serial.println("");
    Serial.println("Authors: AEROSPACE-LAB Team Gokart");
    Serial.println("####################################");

    // Power up Ethernet PHY
    digitalWrite(12, HIGH);
    delay(200);

    WiFi.onEvent(WiFiEvent);
    ETH.begin();
    // Car network, see zc/README.md. It has no router, hence no gateway.
    ETH.config(IPAddress(10, 77, 0, 6), IPAddress(0, 0, 0, 0), IPAddress(255, 255, 255, 0));

    Serial.print("Connecting to Ethernet");
    while (!ETH.linkUp()) {
        delay(500);
        Serial.print(".");
    }
    Serial.println("\nConnected to Ethernet");
    Serial.print("IP address: ");
    Serial.println(ETH.localIP());
    Serial.print("Gateway: ");
    Serial.println(ETH.gatewayIP());
    Serial.print("Subnet: ");
    Serial.println(ETH.subnetMask());

    delay(50);
    Serial.println("Setup complete");
}

// ================================================================
//  setup
// ================================================================

void setup() {
    connect_ethernet();

    // ── Peripherals ─────────────────────────────────────────────
    bms.Init(Esp32HwConfig::BMS_UART_RX_PIN, Esp32HwConfig::BMS_UART_TX_PIN);
    temp_sensor.begin();

    // ── Transport ───────────────────────────────────────────────
    if (!transport.init(Esp32ServiceConfig::ESP32_UNICAST_PORT)) {
        Serial.println("[ERROR] Transport init failed!");
        while (true) delay(1000);
    }

    // ── Runtime ─────────────────────────────────────────────────
    static Runtime rt(transport, Esp32ServiceConfig::ESP32_UNICAST_PORT);
    runtime_ptr = &rt;
    rt.set_local_address(transport.local_addr());

    uint32_t now = millis();

    // ── Events ──────────────────────────────────────────────────
    rt.register_event(Esp32ServiceConfig::ZC_BATTERY_ID, Esp32ServiceConfig::ZC_BATTERY_EVENT_VOLTAGE_ID);
    rt.register_event(Esp32ServiceConfig::ZC_BATTERY_ID, Esp32ServiceConfig::ZC_BATTERY_EVENT_CURRENT_ID);
    rt.register_event(Esp32ServiceConfig::ZC_BATTERY_ID, Esp32ServiceConfig::ZC_BATTERY_EVENT_TEMP_ID);

    // ── Service ─────────────────────────────────────────────────
    static BatteryService battery_svc;
    rt.register_service(Esp32ServiceConfig::ZC_BATTERY_ID, battery_svc,
                        1, 0,
                        /*auth_required=*/false);
    rt.offer_service(Esp32ServiceConfig::ZC_BATTERY_ID, /*ttl=*/30, now);
    std::printf("[server] BatteryService 0x%04X offered\n", Esp32ServiceConfig::ZC_BATTERY_ID);

    // ── Kick off first temperature conversion ───────────────────
    temp_sensor.requestConversion();
    last_temp_request = now;
}

// ================================================================
//  loop
// ================================================================

void loop() {
    Runtime& rt = *runtime_ptr;
    uint32_t now = millis();

    // ── Process protocol (poll transport, dispatch, housekeeping)
    rt.process(now);

    // ── BMS polling ─────────────────────────────────────────────
    if (now - last_bms_poll >= BMS_POLL_INTERVAL_MS) {
        last_bms_poll = now;

        if (bms.getPackMeasurements()) {
            float v = bms.get.packVoltage;
            float c = bms.get.packCurrent;

            if (v != last_voltage) {
                last_voltage = v;
                Serial.printf("[bms] Voltage changed: %.2f V — firing event\n", v);
                rt.notify_event(Esp32ServiceConfig::ZC_BATTERY_ID,
                                Esp32ServiceConfig::ZC_BATTERY_EVENT_VOLTAGE_ID,
                                reinterpret_cast<const uint8_t*>(&v), sizeof(v));
            }
            if (c != last_current) {
                last_current = c;
                Serial.printf("[bms] Current changed: %.2f A — firing event\n", c);
                rt.notify_event(Esp32ServiceConfig::ZC_BATTERY_ID,
                                Esp32ServiceConfig::ZC_BATTERY_EVENT_CURRENT_ID,
                                reinterpret_cast<const uint8_t*>(&c), sizeof(c));
            }
        } else {
            Serial.println("[bms] getPackMeasurements() failed — BMS not responding");
        }
    }

    // ── Temperature polling (non-blocking) ──────────────────────
    if (temp_sensor.isConversionReady()) {
        auto temps = temp_sensor.readTemperatures();
        if (!temps.empty()) {
            Serial.print("[temp] Firing event with temperatures:");
            for (float t : temps) Serial.printf(" %.2f", t);
            Serial.println();
            rt.notify_event(Esp32ServiceConfig::ZC_BATTERY_ID,
                            Esp32ServiceConfig::ZC_BATTERY_EVENT_TEMP_ID,
                            reinterpret_cast<const uint8_t*>(temps.data()),
                            temps.size() * sizeof(float));
        }
    }
    // Re-arm next conversion after the polling interval
    if (!temp_sensor.isConversionReady() && (now - last_temp_request >= TEMP_POLL_INTERVAL_MS)) {
        temp_sensor.requestConversion();
        last_temp_request = now;
    }
}