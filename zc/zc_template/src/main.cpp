#include <Arduino.h>
#include <ETH.h>
#include <sero.hpp>
#include "udp_transport_esp32.hpp"
#include "template_service.hpp"

const char* FIRMWARE_VERSION = "0.1.0";

// ── Type Aliases ─────────────────────────────────────────────────────────────

using Runtime = sero::Runtime<esp32_app::UdpTransportEsp32, Esp32Config>;
using Addr    = sero::Address<Esp32Config>;

// ── Global Objects ────────────────────────────────────────────────────────────

static esp32_app::UdpTransportEsp32 transport;
static Runtime*                     runtime_ptr = nullptr;
static TemplateService              template_svc;

// ── Forward Declarations ──────────────────────────────────────────────────────

void WiFiEvent(WiFiEvent_t event);
void connect_ethernet();

// ── Ethernet Event Handler ────────────────────────────────────────────────────

void WiFiEvent(WiFiEvent_t event) {
    switch (event) {
        case ARDUINO_EVENT_ETH_START:
            Serial.println("[eth] Started");
            // TODO: Set hostname matching the ZC name (e.g. "zc-throttle").
            ETH.setHostname("zc-template");
            break;
        case ARDUINO_EVENT_ETH_CONNECTED:
            Serial.println("[eth] Connected");
            break;
        case ARDUINO_EVENT_ETH_GOT_IP:
            Serial.print("[eth] IP: ");
            Serial.println(ETH.localIP());
            break;
        case ARDUINO_EVENT_ETH_DISCONNECTED:
            Serial.println("[eth] Disconnected");
            break;
        case ARDUINO_EVENT_ETH_STOP:
            Serial.println("[eth] Stopped");
            break;
        default:
            break;
    }
}

// ── Network Initialisation ────────────────────────────────────────────────────

void connect_ethernet() {
    // Hold Ethernet PHY in reset during initial startup delay
    pinMode(12, OUTPUT);
    digitalWrite(12, LOW);

    Serial.begin(115200);
    delay(1000);
    Serial.println("####################################");
    Serial.println("ZC_TEMPLATE Fw. v." + String(FIRMWARE_VERSION));
    Serial.println("");
    Serial.println("Authors: AEROSPACE-LAB Team Gokart");
    Serial.println("####################################");

    // Power up Ethernet PHY
    digitalWrite(12, HIGH);
    delay(200);

    WiFi.onEvent(WiFiEvent);
    ETH.begin();

    // TODO: Assign a free address from the car network table in zc/README.md and
    //       add it there. The car network has no router, hence no gateway.
    ETH.config(
        IPAddress(10, 77, 0, 0),     // TODO: replace with real address
        IPAddress(0, 0, 0, 0),
        IPAddress(255, 255, 255, 0)
    );

    Serial.print("[eth] Waiting for link");
    while (!ETH.linkUp()) {
        delay(500);
        Serial.print(".");
    }
    Serial.println();
    Serial.print("[eth] IP: ");      Serial.println(ETH.localIP());
    Serial.print("[eth] Gateway: "); Serial.println(ETH.gatewayIP());
    Serial.print("[eth] Subnet: ");  Serial.println(ETH.subnetMask());
}

// ── setup ─────────────────────────────────────────────────────────────────────

void setup() {
    connect_ethernet();

    // ── Transport ────────────────────────────────────────────────────────────
    if (!transport.init(Esp32ServiceConfig::ESP32_UNICAST_PORT)) {
        Serial.println("[ERROR] Transport init failed!");
        while (true) delay(1000);
    }

    // ── Runtime ──────────────────────────────────────────────────────────────
    static Runtime rt(transport, Esp32ServiceConfig::ESP32_UNICAST_PORT);
    runtime_ptr = &rt;
    rt.set_local_address(transport.local_addr());

    uint32_t now = millis();

    // Register the event this service will emit to subscribers.
    if (!rt.register_event(
            Esp32ServiceConfig::ZC_TEMPLATE_ID,
            Esp32ServiceConfig::ZC_TEMPLATE_EVENT_EXAMPLE_ID)) {
        Serial.println("[ERROR] register_event failed!");
    }

    // Register the service implementation (handles incoming method calls).
    if (!rt.register_service(
            Esp32ServiceConfig::ZC_TEMPLATE_ID,
            template_svc,
            /*major=*/1, /*minor=*/0,
            /*auth_required=*/false)) {
        Serial.println("[ERROR] register_service failed!");
    }

    // Announce service to the network.
    if (!rt.offer_service(Esp32ServiceConfig::ZC_TEMPLATE_ID, /*ttl_s=*/30, now)) {
        Serial.println("[ERROR] offer_service failed!");
    }

    Serial.printf("[template] Service 0x%04X offered\n",
                  Esp32ServiceConfig::ZC_TEMPLATE_ID);
}

// ── loop ──────────────────────────────────────────────────────────────────────

// Interval at which the example event is emitted (milliseconds).
static constexpr uint32_t EVENT_INTERVAL_MS = 5000;

void loop() {
    Runtime& rt = *runtime_ptr;
    uint32_t now = millis();

    // Drive the Sero protocol — must be called every iteration.
    rt.process(now);

    // Emit the example event periodically.
    static uint32_t last_event_ms = 0;
    if (now - last_event_ms >= EVENT_INTERVAL_MS) {
        last_event_ms = now;

        // TODO: Replace with real sensor / state payload.
        uint8_t payload[4];
        payload[0] = static_cast<uint8_t>(now >> 24);
        payload[1] = static_cast<uint8_t>(now >> 16);
        payload[2] = static_cast<uint8_t>(now >> 8);
        payload[3] = static_cast<uint8_t>(now);

        if (!rt.notify_event(
                Esp32ServiceConfig::ZC_TEMPLATE_ID,
                Esp32ServiceConfig::ZC_TEMPLATE_EVENT_EXAMPLE_ID,
                payload, sizeof(payload))) {
            Serial.println("[template] notify_event failed (no subscribers?)");
        }

        Serial.printf("[template] event_example emitted (uptime=%lu ms)\n",
                      static_cast<unsigned long>(now));
    }
}
