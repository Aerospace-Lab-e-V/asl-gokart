#pragma once
/// @file lights_service.hpp
/// Sero service: turns incoming method calls into LightsModel changes.
/// Protocol: see the ID table in config.hpp and the blob in core/lights_config.hpp.

#include <sero.hpp>
#include <config.hpp>
#include <high_beam_controller.hpp>
#include <hw/lights_model.hpp>
#include "ota_handler.hpp"

class LightsService : public sero::IService<LightsService> {
public:
    LightsService(LightsModel& model, HighBeamController& high_beams, EventOutbox& outbox)
        : model_(model), high_beams_(high_beams), outbox_(outbox) {}

    bool impl_is_ready() const { return true; }

    sero::ReturnCode impl_on_request(uint16_t method_id, const uint8_t* payload, std::size_t len,
                                     uint8_t* response, std::size_t& response_length) {
        using C = Esp32ServiceConfig;
        response_length = 0;

        switch (method_id) {
            // ── Turn signals ────────────────────────────────────────────
            case C::ZC_LIGHTS_LEFT_ID:   model_.toggle_left();   return sero::ReturnCode::E_OK;
            case C::ZC_LIGHTS_RIGHT_ID:  model_.toggle_right();  return sero::ReturnCode::E_OK;
            case C::ZC_LIGHTS_HAZARD_ID: model_.toggle_hazard(); return sero::ReturnCode::E_OK;

            // ── Lights: [] toggles, [on] sets ───────────────────────────
            case C::ZC_LIGHTS_HIGH_BEAMS_ID:
                if (len > 0) high_beams_.set(payload[0] != 0, payload[0] != 0);
                else high_beams_.toggle();
                return sero::ReturnCode::E_OK;
            case C::ZC_LIGHTS_BRAKE_ID:
                model_.set_brake(len > 0 ? payload[0] != 0 : !model_.brake());
                return sero::ReturnCode::E_OK;
            case C::ZC_LIGHTS_REVERSE_ID:
                model_.set_reverse(len > 0 ? payload[0] != 0 : !model_.reverse());
                return sero::ReturnCode::E_OK;
            case C::ZC_LIGHTS_DRL_ID:
                model_.set_drl(len > 0 ? payload[0] != 0 : !model_.drl());
                return sero::ReturnCode::E_OK;
            case C::ZC_LIGHTS_TAIL_ID:
                model_.set_tail(len > 0 ? payload[0] != 0 : !model_.tail());
                return sero::ReturnCode::E_OK;

            // ── Welcome ─────────────────────────────────────────────────
            case C::ZC_LIGHTS_WELCOME_ID: {
                const auto r = model_.play_welcome(millis(), /*at_boot=*/false);
                if (r == LightsModel::PlayResult::Started) return sero::ReturnCode::E_OK;
                Serial.printf("[lights] welcome refused (%s)\n",
                              r == LightsModel::PlayResult::RefusedMoving ? "moving" : "safety light on");
                return sero::ReturnCode::E_NOT_READY;
            }

            case C::ZC_LIGHTS_SET_WELCOME_CONFIG_ID:
                if (len < 5) return sero::ReturnCode::E_MALFORMED_MESSAGE;
                if (!model_.apply_welcome_config(payload[0], payload[1] != 0, payload[2], payload[3], payload[4]))
                    return sero::ReturnCode::E_NOT_OK;
                response_length = encode_config(model_.config(), response, Esp32Config::MaxPayloadSize, true);
                return sero::ReturnCode::E_OK;

            case C::ZC_LIGHTS_SET_ANIM_COLOR_ID:
                if (len < 5 || payload[0] > 1) return sero::ReturnCode::E_MALFORMED_MESSAGE;
                if (!model_.set_anim_color(static_cast<AnimLayer>(payload[0]), payload[1],
                                           Rgb8{payload[2], payload[3], payload[4]}))
                    return sero::ReturnCode::E_NOT_OK;
                response_length = encode_config(model_.config(), response, Esp32Config::MaxPayloadSize, true);
                return sero::ReturnCode::E_OK;

            case C::ZC_LIGHTS_GET_CONFIG_ID:
                // A (re)started client has no state yet: send every event once more.
                outbox_.mark(EV_ALL);
                response_length = encode_config(model_.config(), response, Esp32Config::MaxPayloadSize, true);
                return sero::ReturnCode::E_OK;

            // ── OTA trigger ─────────────────────────────────────────────
            case C::ZC_LIGHTS_OTA_METHOD_ID: {
                if (len == 0 || len >= 512) {
                    Serial.println("[ota] Invalid URL length");
                    return sero::ReturnCode::E_NOT_OK;
                }
                char url[512];
                memcpy(url, payload, len);
                url[len] = '\0';
                Serial.printf("[ota] Received URL: %s\n", url);
                // Acknowledge immediately — the OTA task reboots the device on success.
                return start_ota(url) ? sero::ReturnCode::E_OK : sero::ReturnCode::E_NOT_OK;
            }

            default:
                return sero::ReturnCode::E_UNKNOWN_METHOD;
        }
    }

private:
    LightsModel&        model_;
    HighBeamController& high_beams_;
    EventOutbox&        outbox_;
};
