#pragma once
/// @file lights_config.hpp
/// User settings of the welcome light and their byte encoding. One format for
/// the Sero wire (LIGHTS_CONFIG event, SET/GET responses) and for NVS.
///
/// Blob, version 1:
///   u8 version (= 1)
///   u8 flags            bit0 = welcome enabled (automatic play at boot)
///   u8 front_id
///   u8 rear_id
///   u8 ambient          0..255, scales the welcome layer only
///   u8 nc               then nc × [u8 layer (0 front, 1 rear), u8 id, u8 r, u8 g, u8 b]
///                       one entry per animation with a user colour
///   — catalog section, wire only (NVS leaves it out) —
///   u8 nf               then nf × u8 front id the firmware has
///   u8 nr               then nr × u8 rear id the firmware has
///
/// Decoders reject other versions and ignore trailing bytes, so fields can be
/// appended. Unknown animation ids decode to the defaults.
/// Mirrored in infotainment/headunit/src/main/adapters/lights-config-codec.ts — keep in sync.

#include <cstddef>
#include <cstdint>
#include <animations/registry.hpp>

enum class AnimLayer : uint8_t { FRONT = 0, REAR = 1 };

struct LightsConfig {
    static constexpr uint8_t VERSION = 1;

    bool    welcome_enabled = true;
    uint8_t front_id        = anim::DEFAULT_FRONT_ID;
    uint8_t rear_id         = anim::DEFAULT_REAR_ID;
    uint8_t ambient         = 255;
    Rgb8    front_colors[anim::FRONT_COUNT];  ///< indexed like anim::FRONT
    Rgb8    rear_colors[anim::REAR_COUNT];    ///< indexed like anim::REAR

    LightsConfig() {
        for (std::size_t i = 0; i < anim::FRONT_COUNT; ++i) front_colors[i] = anim::FRONT[i]->default_color;
        for (std::size_t i = 0; i < anim::REAR_COUNT; ++i) rear_colors[i] = anim::REAR[i]->default_color;
    }

    /// Colour the selected front animation plays in (its fixed colour if it has none).
    Rgb8 front_color() const {
        const int i = anim::front_index(front_id);
        if (i < 0) return RGB_OFF;
        return anim::FRONT[i]->custom_color ? front_colors[i] : anim::FRONT[i]->default_color;
    }
    Rgb8 rear_color() const {
        const int i = anim::rear_index(rear_id);
        if (i < 0) return RGB_OFF;
        return anim::REAR[i]->custom_color ? rear_colors[i] : anim::REAR[i]->default_color;
    }

    /// Sets an animation's colour. False for an unknown id or a fixed-colour animation.
    bool set_color(AnimLayer layer, uint8_t id, Rgb8 c) {
        if (layer == AnimLayer::FRONT) {
            const int i = anim::front_index(id);
            if (i < 0 || !anim::FRONT[i]->custom_color) return false;
            front_colors[i] = c;
            return true;
        }
        const int i = anim::rear_index(id);
        if (i < 0 || !anim::REAR[i]->custom_color) return false;
        rear_colors[i] = c;
        return true;
    }
};

/// Largest blob encode_config can produce.
inline constexpr std::size_t LIGHTS_CONFIG_MAX_SIZE =
    6 + 5 * (anim::FRONT_COUNT + anim::REAR_COUNT) + 2 + anim::FRONT_COUNT + anim::REAR_COUNT;

/// Writes the blob; returns its length, or 0 when `cap` is too small.
inline std::size_t encode_config(const LightsConfig& c, uint8_t* buf, std::size_t cap, bool with_catalog) {
    if (cap < LIGHTS_CONFIG_MAX_SIZE) return 0;
    std::size_t n = 0;
    buf[n++] = LightsConfig::VERSION;
    buf[n++] = c.welcome_enabled ? 0x01 : 0x00;
    buf[n++] = c.front_id;
    buf[n++] = c.rear_id;
    buf[n++] = c.ambient;

    const std::size_t count_at = n++;
    uint8_t count = 0;
    const auto put = [&](AnimLayer layer, uint8_t id, Rgb8 col) {
        buf[n++] = static_cast<uint8_t>(layer);
        buf[n++] = id;
        buf[n++] = col.r;
        buf[n++] = col.g;
        buf[n++] = col.b;
        ++count;
    };
    for (std::size_t i = 0; i < anim::FRONT_COUNT; ++i)
        if (anim::FRONT[i]->custom_color) put(AnimLayer::FRONT, anim::FRONT[i]->id, c.front_colors[i]);
    for (std::size_t i = 0; i < anim::REAR_COUNT; ++i)
        if (anim::REAR[i]->custom_color) put(AnimLayer::REAR, anim::REAR[i]->id, c.rear_colors[i]);
    buf[count_at] = count;

    if (with_catalog) {
        buf[n++] = static_cast<uint8_t>(anim::FRONT_COUNT);
        for (std::size_t i = 0; i < anim::FRONT_COUNT; ++i) buf[n++] = anim::FRONT[i]->id;
        buf[n++] = static_cast<uint8_t>(anim::REAR_COUNT);
        for (std::size_t i = 0; i < anim::REAR_COUNT; ++i) buf[n++] = anim::REAR[i]->id;
    }
    return n;
}

/// Reads a blob into `out`, starting from defaults. False (and `out` = defaults)
/// for a wrong version or a truncated blob. Unknown ids keep their default.
inline bool decode_config(const uint8_t* p, std::size_t len, LightsConfig& out) {
    out = LightsConfig{};
    if (!p || len < 6 || p[0] != LightsConfig::VERSION) return false;

    const std::size_t nc = p[5];
    if (len < 6 + 5 * nc) return false;

    out.welcome_enabled = (p[1] & 0x01) != 0;
    if (anim::find_front(p[2])) out.front_id = p[2];
    if (anim::find_rear(p[3])) out.rear_id = p[3];
    out.ambient = p[4];
    for (std::size_t k = 0; k < nc; ++k) {
        const uint8_t* e = p + 6 + 5 * k;
        if (e[0] > 1) continue;
        out.set_color(static_cast<AnimLayer>(e[0]), e[1], Rgb8{e[2], e[3], e[4]});
    }
    return true;
}
