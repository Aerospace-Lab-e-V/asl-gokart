#include <Arduino.h>
#include "esp_log.h"
#include <ETH.h>
#include <sero.hpp>
#include <udp_transport_esp32.hpp>
#include <rear_light_bar_controller.hpp>
#include <front_drl_controller.hpp>
#include <high_beam_controller.hpp>
#include <lights_service.hpp>

const char* FIRMWARE_VERSION = "0.2.0";

// --- Type Aliases -----------------------------------------------

using Runtime = sero::Runtime<esp32_app::UdpTransportEsp32, Esp32Config>;
using Addr    = sero::Address<Esp32Config>;

// Front DRL strip types (each on a separate RMT channel)
using FrontLeftMethod  = NeoEsp32Rmt1Ws2812xMethod;
using FrontRightMethod = NeoEsp32Rmt2Ws2812xMethod;

// --- Global Objects ---------------------------------------------

// Transport
static esp32_app::UdpTransportEsp32 transport;
static Runtime* runtime_ptr = nullptr;

// Controllers
static RearLightBarController rear_light_bar;
static FrontDrlController<FrontLeftMethod>  front_drl_left(
        Esp32HwConfig::LED_PIN_ARGB_FRONT_LEFT,
        FrontDrlConfig::NUM_LEDS,
        /*sweep_forward=*/true,    // left strip sweeps forward (strips mounted mirrored)
        "drl_left");
static FrontDrlController<FrontRightMethod> front_drl_right(
        Esp32HwConfig::LED_PIN_ARGB_FRONT_RIGHT,
        FrontDrlConfig::NUM_LEDS,
        /*sweep_forward=*/true,    // right strip sweeps forward (strips mounted mirrored)
        "drl_right");
static HighBeamController high_beams;

// --- zc_motor reverse -------------------------------------------
// Subscribes to zc_motor's telemetry and switches the reverse lights when both Kelly
// controllers report reverse. Only changes are applied, so the headunit's reverse toggle
// still works in between. Lights go off when zc_motor falls silent or is lost.

class MotorReverseHandler : public sero::IEventHandler<MotorReverseHandler> {
public:
    void impl_on_event(uint16_t /*service_id*/, uint16_t event_id,
                       const uint8_t* payload, std::size_t payload_length) {
        if (event_id != Esp32ServiceConfig::ZC_MOTOR_EVENT_RPM_ID ||
            payload_length < Esp32ServiceConfig::ZC_MOTOR_EVENT_RPM_PAYLOAD_SIZE) return;
        last_event_ms_ = millis();
        apply(payload[Esp32ServiceConfig::ZC_MOTOR_EVENT_REVERSE_INDEX] != 0);
    }

    /// Call every loop; turns the lights off once zc_motor has been silent too long.
    void check_timeout(uint32_t now) {
        if (reverse_ && now - last_event_ms_ >= Esp32ServiceConfig::ZC_MOTOR_REVERSE_TIMEOUT_MS) {
            Serial.println("[motor] No telemetry, reverse lights off");
            apply(false);
        }
    }

    void on_lost() {
        if (reverse_) apply(false);
        known_ = false;
    }

private:
    void apply(bool reverse) {
        if (known_ && reverse == reverse_) return;
        known_   = true;
        reverse_ = reverse;
        rear_light_bar.set_reverse(reverse);
        Serial.printf("[motor] Kelly reverse %s\n", reverse ? "ON" : "OFF");
    }

    bool     known_         = false;
    bool     reverse_       = false;
    uint32_t last_event_ms_ = 0;
};

static MotorReverseHandler motor_reverse;

static void on_service_lost(uint16_t sid, void* /*ctx*/) {
    std::printf("[sd] Service 0x%04X lost\n", sid);
    if (sid == Esp32ServiceConfig::ZC_MOTOR_ID) motor_reverse.on_lost();
}

// --- Function Declarations ----------------------------------------------
void WiFiEvent(WiFiEvent_t event);
void connect_ethernet();

// ------------------------------------------------------------------------

void WiFiEvent(WiFiEvent_t event) {
  switch (event) {
    case ARDUINO_EVENT_ETH_START:
      Serial.println("ETH Started");
      // Set the hostname for the ESP32
      ETH.setHostname("zc-lights");
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
    Serial.println("ZC_LIGHTS Fw. v." + String(FIRMWARE_VERSION));
    Serial.println("");
    Serial.println("Authors: AEROSPACE-LAB Team Gokart");
    Serial.println("####################################");

    // Power up Ethernet PHY
    digitalWrite(12, HIGH);
    delay(200);

    // Initialize Ethernet
    WiFi.onEvent(WiFiEvent);
    ETH.begin();
    /* -------------------- HIER DIE IP-Adressen vom ESP und Gateway konfigurieren -------------------- */
    // Car network, see zc/README.md. It has no router, hence no gateway.
    ETH.config(IPAddress(10, 77, 0, 4), IPAddress(0, 0, 0, 0), IPAddress(255, 255, 255, 0));
    /* -------------------------------------------------------------------------------------------------*/
    // Wait for Ethernet to connect
    Serial.print("Connecting to Ethernet");
    while (!ETH.linkUp()) {
        delay(500);
        Serial.print(".");
    }
    // Print Ethernet information
    Serial.println("Connected to Ethernet");
    Serial.print("IP address: ");
    Serial.println(ETH.localIP());
    Serial.print("Gateway: ");
    Serial.println(ETH.gatewayIP());
    Serial.print("Subnet: ");
    Serial.println(ETH.subnetMask());

    delay(50);
    Serial.println("Setup complete");
}

void setup() {
    connect_ethernet();

    // ── Initialise hardware controllers ────────────────────────────
    rear_light_bar.begin();
    front_drl_left.begin();
    front_drl_right.begin();
    high_beams.begin();

    // Enable default lighting states
    rear_light_bar.set_tail(true);      // dim red tail light always on
    front_drl_left.set_drl(true);       // white DRL always on
    front_drl_right.set_drl(true);

    // Play welcome animation on boot (rear bar + both DRLs)
    RgbColor welcome_color = WelcomeConfig::COLOR_DEFAULT;
    rear_light_bar.trigger_welcome(welcome_color);
    front_drl_left.trigger_welcome(welcome_color);
    front_drl_right.trigger_welcome(welcome_color);

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

    // ── Register events ─────────────────────────────────────────
    rt.register_event(Esp32ServiceConfig::ZC_LIGHTS_ID, Esp32ServiceConfig::ZC_LIGHTS_EVENT_TURN_STATE_ID);
    rt.register_event(Esp32ServiceConfig::ZC_LIGHTS_ID, Esp32ServiceConfig::ZC_LIGHTS_EVENT_HIGH_BEAM_STATE_ID);
    rt.register_event(Esp32ServiceConfig::ZC_LIGHTS_ID, Esp32ServiceConfig::ZC_LIGHTS_EVENT_BRAKE_STATE_ID);
    rt.register_event(Esp32ServiceConfig::ZC_LIGHTS_ID, Esp32ServiceConfig::ZC_LIGHTS_EVENT_REVERSE_STATE_ID);
    rt.register_event(Esp32ServiceConfig::ZC_LIGHTS_ID, Esp32ServiceConfig::ZC_LIGHTS_EVENT_DRL_STATE_ID);
    rt.register_event(Esp32ServiceConfig::ZC_LIGHTS_ID, Esp32ServiceConfig::ZC_LIGHTS_EVENT_TAIL_STATE_ID);

    // ── Wire up callbacks ───────────────────────────────────────

    // Rear light bar: logical turn state (for front DRL animation)
    rear_light_bar.set_logical_turn_callback([](uint8_t left, uint8_t right) {
        front_drl_left.set_turn_signal(left != 0);
        front_drl_right.set_turn_signal(right != 0);
    });

    // Rear light bar: physical blink state (for headunit UI)
    rear_light_bar.set_turn_callback([](uint8_t left, uint8_t right) {
        if (!runtime_ptr) return;
        uint8_t payload[2] = { left, right };
        runtime_ptr->notify_event(Esp32ServiceConfig::ZC_LIGHTS_ID,
                                  Esp32ServiceConfig::ZC_LIGHTS_EVENT_TURN_STATE_ID,
                                  payload, 2);
    });

    // Rear light bar: brake state
    rear_light_bar.set_brake_callback([](uint8_t on) {
        if (!runtime_ptr) return;
        uint8_t payload[1] = { on };
        runtime_ptr->notify_event(Esp32ServiceConfig::ZC_LIGHTS_ID,
                                  Esp32ServiceConfig::ZC_LIGHTS_EVENT_BRAKE_STATE_ID,
                                  payload, 1);
    });

    // Rear light bar: reverse state
    rear_light_bar.set_reverse_callback([](uint8_t on) {
        if (!runtime_ptr) return;
        uint8_t payload[1] = { on };
        runtime_ptr->notify_event(Esp32ServiceConfig::ZC_LIGHTS_ID,
                                  Esp32ServiceConfig::ZC_LIGHTS_EVENT_REVERSE_STATE_ID,
                                  payload, 1);
    });

    // Rear light bar: tail state
    rear_light_bar.set_tail_callback([](uint8_t on) {
        if (!runtime_ptr) return;
        uint8_t payload[1] = { on };
        runtime_ptr->notify_event(Esp32ServiceConfig::ZC_LIGHTS_ID,
                                  Esp32ServiceConfig::ZC_LIGHTS_EVENT_TAIL_STATE_ID,
                                  payload, 1);
    });

    // High beams
    high_beams.set_callback([](uint8_t left, uint8_t right) {
        if (!runtime_ptr) return;
        uint8_t payload[2] = { left, right };
        runtime_ptr->notify_event(Esp32ServiceConfig::ZC_LIGHTS_ID,
                                  Esp32ServiceConfig::ZC_LIGHTS_EVENT_HIGH_BEAM_STATE_ID,
                                  payload, 2);
    });

    // Front DRL: DRL state
    front_drl_left.set_drl_callback([](uint8_t on) {
        if (!runtime_ptr) return;
        uint8_t payload[1] = { on };
        runtime_ptr->notify_event(Esp32ServiceConfig::ZC_LIGHTS_ID,
                                  Esp32ServiceConfig::ZC_LIGHTS_EVENT_DRL_STATE_ID,
                                  payload, 1);
    });

    // ── Register and offer LightsService ────────────────────────

    static LightsService<FrontLeftMethod, FrontRightMethod> lights_svc(
            rear_light_bar, front_drl_left, front_drl_right, high_beams);

    rt.register_service(Esp32ServiceConfig::ZC_LIGHTS_ID, lights_svc,
                        1, 0,
                        /*auth_required=*/false);
    rt.offer_service(Esp32ServiceConfig::ZC_LIGHTS_ID, /*ttl=*/30, now);
    std::printf("[server] LightsService 0x%04X offered\n", Esp32ServiceConfig::ZC_LIGHTS_ID);

    // ── Consumer: zc_motor telemetry for the reverse lights ─────
    // Sero sends the subscription once zc_motor is found and renews it after a reboot.
    rt.sd_callbacks().on_service_lost = on_service_lost;
    if (!rt.find_service(Esp32ServiceConfig::ZC_MOTOR_ID, 1, now)) {
        Serial.println("[ERROR] find_service(ZC_MOTOR_ID) failed!");
    }
    if (!rt.subscribe_event(Esp32ServiceConfig::ZC_MOTOR_ID, Esp32ServiceConfig::ZC_MOTOR_EVENT_RPM_ID,
                            motor_reverse, Esp32Config::SubscriptionTtlSeconds, now)) {
        Serial.println("[ERROR] subscribe_event(ZC_MOTOR_EVENT_RPM_ID) failed!");
    }
}

void loop() {
    Runtime& rt = *runtime_ptr;
    uint32_t now = millis();

    // ── Process protocol (poll transport, dispatch, housekeeping) ──
    rt.process(now);

    motor_reverse.check_timeout(now);
}
