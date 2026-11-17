#pragma once
/// @file registry.hpp
/// The list of welcome animations. Adding one = one header + one line here
/// (see animations/README.md). Tables live in flash; nothing is allocated.
///
/// IDs are stored in NVS and sent to the headunit — never renumber or reuse one.
/// Mirrored in infotainment/headunit/src/domain/lights.ts — keep in sync.

#include <cstddef>
#include <animations/front/glow.hpp>
#include <animations/front/pods.hpp>
#include <animations/front/sweep.hpp>
#include <animations/front/scan.hpp>
#include <animations/rear/classic.hpp>
#include <animations/rear/wing.hpp>
#include <animations/rear/pulse.hpp>

namespace anim {

inline constexpr const FrontAnimation* FRONT[] = {&kFrontGlow, &kFrontPods, &kFrontSweep, &kFrontScan};
inline constexpr const RearAnimation*  REAR[]  = {&kRearClassic, &kRearWing, &kRearPulse};

inline constexpr std::size_t FRONT_COUNT = sizeof(FRONT) / sizeof(FRONT[0]);
inline constexpr std::size_t REAR_COUNT  = sizeof(REAR) / sizeof(REAR[0]);

inline constexpr uint8_t DEFAULT_FRONT_ID = 0;  // Glow
inline constexpr uint8_t DEFAULT_REAR_ID  = 0;  // Classic sweep

template <typename T, std::size_t N>
constexpr bool ids_unique(const T* const (&table)[N]) {
    for (std::size_t a = 0; a < N; ++a)
        for (std::size_t b = a + 1; b < N; ++b)
            if (table[a]->id == table[b]->id) return false;
    return true;
}
static_assert(ids_unique(FRONT), "front animation ids must be unique");
static_assert(ids_unique(REAR), "rear animation ids must be unique");

/// Table index of an id, or -1 when unknown.
template <typename T, std::size_t N>
constexpr int index_of(const T* const (&table)[N], uint8_t id) {
    for (std::size_t i = 0; i < N; ++i)
        if (table[i]->id == id) return static_cast<int>(i);
    return -1;
}

inline int front_index(uint8_t id) { return index_of(FRONT, id); }
inline int rear_index(uint8_t id) { return index_of(REAR, id); }

inline const FrontAnimation* find_front(uint8_t id) {
    const int i = front_index(id);
    return i < 0 ? nullptr : FRONT[i];
}
inline const RearAnimation* find_rear(uint8_t id) {
    const int i = rear_index(id);
    return i < 0 ? nullptr : REAR[i];
}

}  // namespace anim
