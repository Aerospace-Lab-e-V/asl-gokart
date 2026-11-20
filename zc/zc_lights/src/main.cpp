#include <Arduino.h>
#include "esp_log.h"
#include <ETH.h>
#include <sero.hpp>
#include <udp_transport_esp32.hpp>
#include <config.hpp>
#include <high_beam_controller.hpp>
#include <hw/event_outbox.hpp>
#include <hw/front_lights_controller.hpp>
#include <hw/lights_model.hpp>
#include <hw/rear_light_bar_controller.hpp>
#include <hw/settings_store.hpp>
#include <lights_service.hpp>

const char* FIRMWARE_VERSION = "0.3.0";

// --- Type Aliases -----------------------------------------------

using Runtime = sero::Runtime<esp32_app::UdpTransportEsp32, Esp32Config>;

// Each front strip on its own RMT channel (the rear bar uses channel 0).
using FrontLights = FrontLightsController<NeoEsp32Rmt1Ws2812xMethod, NeoEsp32Rmt2Ws2812xMethod>;

// --- Global Objects ---------------------------------------------

static esp32_app::UdpTransportEsp32 transport;
static Runtime* runtime_ptr = nullptr;

static EventOutbox outbox;
static LightsModel model(outbox);
static SettingsStore settings;
static FrontLights front_lights(model, Esp32HwConfig::LED_PIN_ARGB_FRONT_LEFT, Esp32HwConfig::LED_PIN_ARGB_FRONT_RIGHT);
static RearLightBarController rear_light_bar(model, Esp32HwConfig::LED_PIN_ARGB_REAR);
static HighBeamController high_beams;

// --- zc_motor telemetry -----------------------------------------
// Reverse lights follow the Kelly controllers, and the welcome is cancelled /
// refused while the kart moves. Only changes are applied, so the headunit's
// reverse switch still works in between. Without telemetry (zc_motor silent or
// lost) the reverse lights go off and the kart no longer counts as moving.

class MotorTelemetryHandler : public sero::IEventHandler<MotorTelemetryHandler> {
public:
    void impl_on_event(uint16_t /*service_id*/, uint16_t event_id, const uint8_t* payload, std::size_t len) {
        using C = Esp32ServiceConfig;
        if (event_id != C::ZC_MOTOR_EVENT_RPM_ID || len < C::ZC_MOTOR_EVENT_RPM_PAYLOAD_SIZE) return;
        last_event_ms_ = millis();
        apply_reverse(payload[C::ZC_MOTOR_EVENT_REVERSE_INDEX] != 0);

        const uint16_t left  = rpm_at(payload, C::ZC_MOTOR_EVENT_LEFT_RPM_INDEX);
        const uint16_t right = rpm_at(payload, C::ZC_MOTOR_EVENT_RIGHT_RPM_INDEX);
        model.set_moving(left > C::ZC_MOTOR_MOVING_RPM || right > C::ZC_MOTOR_MOVING_RPM, last_event_ms_);
    }

    /// Call every loop; forgets the motor state once zc_motor has been silent too long.
    void check_timeout(uint32_t now) {
        if (known_ && now - last_event_ms_ >= Esp32ServiceConfig::ZC_MOTOR_REVERSE_TIMEOUT_MS) {
            Serial.println("[motor] No telemetry, reverse lights off");
            on_lost();
        }
    }

    void on_lost() {
        if (reverse_) model.set_reverse(false);
        model.set_moving(false, millis());
        known_ = false;
        reverse_ = false;
    }

private:
    static uint16_t rpm_at(const uint8_t* p, std::size_t i) { return static_cast<uint16_t>(p[i] << 8 | p[i + 1]); }

    void apply_reverse(bool reverse) {
        if (known_ && reverse == reverse_) return;
        known_   = true;
        reverse_ = reverse;
        model.set_reverse(reverse);
        Serial.printf("[motor] Kelly reverse %s\n", reverse ? "ON" : "OFF");
    }

    bool     known_         = false;
    bool     reverse_       = false;
    uint32_t last_event_ms_ = 0;
};

static MotorTelemetryHandler motor_telemetry;

static void on_service_lost(uint16_t sid, void* /*ctx*/) {
    std::printf("[sd] Service 0x%04X lost\n", sid);
    if (sid == Esp32ServiceConfig::ZC_MOTOR_ID) motor_telemetry.on_lost();
}

// --- Event publishing (loop() only) -------------------------------

static void publish(uint16_t event_id, const uint8_t* payload, std::size_t len) {
    // False only when nobody subscribed or the send failed; the next change sends again.
    (void)runtime_ptr->notify_event(Esp32ServiceConfig::ZC_LIGHTS_ID, event_id, payload, len);
}

static void publish_events(uint32_t bits, const LightsModel::Snapshot& s, bool welcome_playing) {
    using C = Esp32ServiceConfig;
    if (bits & EV_TURN) {
        const uint8_t p[2] = {s.physical_left, s.physical_right};
        publish(C::ZC_LIGHTS_EVENT_TURN_STATE_ID, p, 2);
    }
    if (bits & EV_HIGH_BEAM) {
        const uint8_t on = high_beams.is_on() ? 1 : 0;
        const uint8_t p[2] = {on, on};
        publish(C::ZC_LIGHTS_EVENT_HIGH_BEAM_STATE_ID, p, 2);
    }
    const auto single = [](uint16_t id, bool on) {
        const uint8_t p[1] = {static_cast<uint8_t>(on ? 1 : 0)};
        publish(id, p, 1);
    };
    if (bits & EV_BRAKE) single(C::ZC_LIGHTS_EVENT_BRAKE_STATE_ID, s.brake);
    if (bits & EV_REVERSE) single(C::ZC_LIGHTS_EVENT_REVERSE_STATE_ID, s.reverse);
    if (bits & EV_DRL) single(C::ZC_LIGHTS_EVENT_DRL_STATE_ID, s.drl);
    if (bits & EV_TAIL) single(C::ZC_LIGHTS_EVENT_TAIL_STATE_ID, s.tail);
    if (bits & EV_WELCOME) single(C::ZC_LIGHTS_EVENT_WELCOME_STATE_ID, welcome_playing);
    if (bits & EV_CONFIG) {
        uint8_t blob[LIGHTS_CONFIG_MAX_SIZE];
        const std::size_t n = encode_config(s.cfg, blob, sizeof blob, /*with_catalog=*/true);
        publish(C::ZC_LIGHTS_EVENT_CONFIG_ID, blob, n);
    }
}

// --- Ethernet -----------------------------------------------------

void WiFiEvent(WiFiEvent_t event) {
    switch (event) {
        case ARDUINO_EVENT_ETH_START:
            Serial.println("ETH Started");
            ETH.setHostname("zc-lights");
            break;
        case ARDUINO_EVENT_ETH_CONNECTED:    Serial.println("ETH Connected"); break;
        case ARDUINO_EVENT_ETH_GOT_IP:
            Serial.print("ETH IP Address: ");
            Serial.println(ETH.localIP());
            break;
        case ARDUINO_EVENT_ETH_DISCONNECTED: Serial.println("ETH Disconnected"); break;
        case ARDUINO_EVENT_ETH_STOP:         Serial.println("ETH Stopped"); break;
        default: break;
    }
}

/// Blocks until the link is up. Runs after the lights are on, so the kart has
/// tail, DRL and working render tasks even without a network.
void connect_ethernet() {
    // Hold the Ethernet PHY in reset during the startup delay, then power it up.
    pinMode(12, OUTPUT);
    digitalWrite(12, LOW);
    delay(200);
    digitalWrite(12, HIGH);
    delay(200);

    WiFi.onEvent(WiFiEvent);
    ETH.begin();
    // Car network, see zc/README.md. It has no router, hence no gateway.
    ETH.config(IPAddress(10, 77, 0, 4), IPAddress(0, 0, 0, 0), IPAddress(255, 255, 255, 0));

    Serial.print("Connecting to Ethernet");
    while (!ETH.linkUp()) {
        delay(500);
        Serial.print(".");
    }
    Serial.println();
    Serial.print("IP address: ");
    Serial.println(ETH.localIP());
}

// --- Setup / loop -----------------------------------------------------

void setup() {
    esp_log_level_set("*", ESP_LOG_VERBOSE);
    Serial.begin(115200);
    delay(100);
    Serial.println("####################################");
    Serial.println("ZC_LIGHTS Fw. v." + String(FIRMWARE_VERSION));
    Serial.println("Authors: AEROSPACE-LAB Team Gokart");
    Serial.println("####################################");

    // ── Lights first: they must work without a network ─────────
    model.init(settings.load());
    front_lights.begin();
    rear_light_bar.begin();
    high_beams.begin();
    model.attach_tasks(front_lights.task_handle(), rear_light_bar.task_handle());

    model.set_tail(true);  // dim red tail light always on
    model.set_drl(true);   // white DRL always on
    if (model.config().welcome_enabled) model.play_welcome(millis(), /*at_boot=*/true);  // the only automatic play

    high_beams.set_callback([](uint8_t, uint8_t) { outbox.mark(EV_HIGH_BEAM); });

    // ── Network ─────────────────────────────────────────────────
    connect_ethernet();

    if (!transport.init(Esp32ServiceConfig::ESP32_UNICAST_PORT)) {
        Serial.println("[ERROR] Transport init failed!");
        while (true) delay(1000);  // the render tasks keep the lights running
    }

    static Runtime rt(transport, Esp32ServiceConfig::ESP32_UNICAST_PORT);
    runtime_ptr = &rt;
    rt.set_local_address(transport.local_addr());
    const uint32_t now = millis();

    using C = Esp32ServiceConfig;
    for (uint16_t ev : {C::ZC_LIGHTS_EVENT_TURN_STATE_ID, C::ZC_LIGHTS_EVENT_HIGH_BEAM_STATE_ID,
                        C::ZC_LIGHTS_EVENT_BRAKE_STATE_ID, C::ZC_LIGHTS_EVENT_REVERSE_STATE_ID,
                        C::ZC_LIGHTS_EVENT_DRL_STATE_ID, C::ZC_LIGHTS_EVENT_TAIL_STATE_ID,
                        C::ZC_LIGHTS_EVENT_CONFIG_ID, C::ZC_LIGHTS_EVENT_WELCOME_STATE_ID}) {
        if (!rt.register_event(C::ZC_LIGHTS_ID, ev)) std::printf("[ERROR] register_event(0x%04X) failed\n", ev);
    }

    static LightsService lights_svc(model, high_beams, outbox);
    if (!rt.register_service(C::ZC_LIGHTS_ID, lights_svc, 1, 0, /*auth_required=*/false) ||
        !rt.offer_service(C::ZC_LIGHTS_ID, /*ttl=*/30, now)) {
        Serial.println("[ERROR] LightsService could not be offered");
    }
    std::printf("[server] LightsService 0x%04X offered\n", C::ZC_LIGHTS_ID);

    // ── Consumer: zc_motor telemetry ────────────────────────────
    // Sero sends the subscription once zc_motor is found and renews it after a reboot.
    rt.sd_callbacks().on_service_lost = on_service_lost;
    if (!rt.find_service(C::ZC_MOTOR_ID, 1, now)) Serial.println("[ERROR] find_service(ZC_MOTOR_ID) failed!");
    if (!rt.subscribe_event(C::ZC_MOTOR_ID, C::ZC_MOTOR_EVENT_RPM_ID, motor_telemetry,
                            Esp32Config::SubscriptionTtlSeconds, now)) {
        Serial.println("[ERROR] subscribe_event(ZC_MOTOR_EVENT_RPM_ID) failed!");
    }
}

void loop() {
    Runtime& rt = *runtime_ptr;
    const uint32_t now = millis();

    rt.process(now);
    motor_telemetry.check_timeout(now);

    // Welcome playing state: on while the plan runs, off once it settled or was cancelled.
    static bool welcome_was_playing = false;
    model.finish_welcome_if_done(now);
    const LightsModel::Snapshot s = model.snapshot();
    const bool playing = welcome_active(s.welcome, now);
    if (playing != welcome_was_playing) {
        welcome_was_playing = playing;
        outbox.mark(EV_WELCOME);
    }

    const uint32_t bits = outbox.take();
    if (bits) {
        publish_events(bits, s, playing);
        if (bits & SAVE_CONFIG) settings.request_save(s.cfg, now);
    }
    settings.tick(now);
}
