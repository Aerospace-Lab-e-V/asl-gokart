#include <Arduino.h>
#include <ETH.h>
#include <array>
#include <sero.hpp>
#include "udp_transport_esp32.hpp"
#include "motor_service.hpp"
#include "kelly_decoder.hpp"

const char* FIRMWARE_VERSION = "0.1.0";

// ── Type Aliases ─────────────────────────────────────────────────────────────

using Runtime = sero::Runtime<esp32_app::UdpTransportEsp32, Esp32Config>;
using Addr    = sero::Address<Esp32Config>;

static_assert(Esp32ServiceConfig::ZC_MOTOR_EVENT_RPM_PAYLOAD_SIZE <= Esp32Config::MaxPayloadSize,
              "motor RPM event payload exceeds MaxPayloadSize");

// ── Global Objects ────────────────────────────────────────────────────────────

static esp32_app::UdpTransportEsp32 transport;
static Runtime*                     runtime_ptr = nullptr;
static MotorService                 motor_svc;
static KellyController              motor_left(Serial1);
static KellyController              motor_right(Serial2);

// ── Forward Declarations ──────────────────────────────────────────────────────

void WiFiEvent(WiFiEvent_t event);
void connect_ethernet();

// ── Ethernet Event Handler ────────────────────────────────────────────────────

void WiFiEvent(WiFiEvent_t event) {
    switch (event) {
        case ARDUINO_EVENT_ETH_START:
            Serial.println("[eth] Started");
            ETH.setHostname("zc-motor");
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
    Serial.println("ZC_MOTOR Fw. v." + String(FIRMWARE_VERSION));
    Serial.println("");
    Serial.println("Authors: AEROSPACE-LAB Team Gokart");
    Serial.println("####################################");

    // Power up Ethernet PHY
    digitalWrite(12, HIGH);
    delay(200);

    WiFi.onEvent(WiFiEvent);
    ETH.begin();

    // Car network, see zc/README.md. It has no router, hence no gateway.
    ETH.config(
        IPAddress(10, 77, 0, 7),
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

    // Initialize motor service (includes relay setup)
    motor_svc.begin();

    // ── Kelly motor controllers ─────────────────────────────────────────────
    motor_left.begin(Esp32HwConfig::KELLY_BAUD_RATE,
                      Esp32HwConfig::KELLY_LEFT_RX_PIN,
                      Esp32HwConfig::KELLY_LEFT_TX_PIN,
                      Esp32HwConfig::KELLY_READ_TIMEOUT_MS,
                      false); // set to true to invert UART
    motor_right.begin(Esp32HwConfig::KELLY_BAUD_RATE,
                       Esp32HwConfig::KELLY_RIGHT_RX_PIN,
                       Esp32HwConfig::KELLY_RIGHT_TX_PIN,
                       Esp32HwConfig::KELLY_READ_TIMEOUT_MS,
                       false); // set to true to invert UART

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
            Esp32ServiceConfig::ZC_MOTOR_ID,
            Esp32ServiceConfig::ZC_MOTOR_EVENT_RPM_ID)) {
        Serial.println("[ERROR] register_event failed!");
    }

    // Register the service implementation (handles incoming method calls).
    if (!rt.register_service(
            Esp32ServiceConfig::ZC_MOTOR_ID,
            motor_svc,
            /*major=*/1, /*minor=*/0,
            /*auth_required=*/false)) {
        Serial.println("[ERROR] register_service failed!");
    }

    // Announce service to the network.
    if (!rt.offer_service(Esp32ServiceConfig::ZC_MOTOR_ID, /*ttl_s=*/30, now)) {
        Serial.println("[ERROR] offer_service failed!");
    }

    Serial.printf("[motor] Service 0x%04X offered\n",
                  Esp32ServiceConfig::ZC_MOTOR_ID);
}

// ── loop ──────────────────────────────────────────────────────────────────────

// Rate limit Kelly controller polling to prevent blocking Sero protocol runtime
static constexpr uint32_t KELLY_POLL_INTERVAL_MS = 100;

void loop() {
    Runtime& rt = *runtime_ptr;
    uint32_t now = millis();

    // Drive the Sero protocol — must be called every iteration.
    rt.process(now);

    static uint32_t last_poll_time = 0;
    if (now - last_poll_time >= KELLY_POLL_INTERVAL_MS) {
        last_poll_time = now;

        // Poll both Kelly controllers (faults tracked via
        // fault_count(), not the per-call bool — see KellyController::poll()).
        motor_left.poll();
        motor_right.poll();

        const kelly::PacketA& left_a  = motor_left.packet_a();
        const kelly::PacketA& right_a = motor_right.packet_a();

        const uint16_t left_rpm   = motor_left.rpm();
        const uint16_t right_rpm  = motor_right.rpm();

        auto pack_switches = [](const kelly::PacketA& a) -> uint8_t {
            return static_cast<uint8_t>(
                (a.brake_switch   ? (1 << 0) : 0) |
                (a.foot_switch    ? (1 << 1) : 0) |
                (a.forward_switch ? (1 << 2) : 0) |
                (a.reverse        ? (1 << 3) : 0) |
                (a.setting_dir    ? (1 << 4) : 0) |
                (a.actual_dir     ? (1 << 5) : 0)
            );
        };

        std::array<uint8_t, Esp32ServiceConfig::ZC_MOTOR_EVENT_RPM_PAYLOAD_SIZE> payload{};
        // Left motor
        payload[0] = static_cast<uint8_t>(left_rpm >> 8);
        payload[1] = static_cast<uint8_t>(left_rpm);
        payload[2] = left_a.throttle;
        payload[3] = left_a.brake_pedal;
        payload[4] = pack_switches(left_a);
        payload[5] = left_a.battery_voltage;
        payload[6] = left_a.motor_temp;
        payload[7] = left_a.controller_temp;

        // Right motor
        payload[8]  = static_cast<uint8_t>(right_rpm >> 8);
        payload[9]  = static_cast<uint8_t>(right_rpm);
        payload[10] = right_a.throttle;
        payload[11] = right_a.brake_pedal;
        payload[12] = pack_switches(right_a);
        payload[13] = right_a.battery_voltage;
        payload[14] = right_a.motor_temp;
        payload[15] = right_a.controller_temp;

        // ponytail: Pack relay states into telemetry event
        payload[16] = motor_svc.get_relay1_state() ? 1 : 0;
        payload[17] = motor_svc.get_relay2_state() ? 1 : 0;
        // ponytail: Pack real reverse state (AND logic)
        payload[18] = (left_a.reverse && right_a.reverse) ? 1 : 0;

        if (!rt.notify_event(
                Esp32ServiceConfig::ZC_MOTOR_ID,
                Esp32ServiceConfig::ZC_MOTOR_EVENT_RPM_ID,
                payload.data(), payload.size())) {
            Serial.println("[motor] notify_event failed (no subscribers?)");
        }

        Serial.printf("[motor] left rpm=%u thr=%u brk=%u rev=%u faults=%lu | right rpm=%u thr=%u brk=%u rev=%u faults=%lu\n",
                      left_rpm, left_a.throttle, left_a.brake_pedal, left_a.reverse ? 1 : 0, static_cast<unsigned long>(motor_left.fault_count()),
                      right_rpm, right_a.throttle, right_a.brake_pedal, right_a.reverse ? 1 : 0, static_cast<unsigned long>(motor_right.fault_count()));
    }
}
