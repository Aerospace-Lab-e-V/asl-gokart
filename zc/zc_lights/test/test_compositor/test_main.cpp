// Layering: safety lights always win, ambient only dims the welcome. Run: pio test -e native
#include <unity.h>
#include <cstring>
#include <core/compositor.hpp>

void setUp() {}
void tearDown() {}

using L = RearLayout;

static uint8_t welcome_px[L::NUM_LEDS];
static Rgb8 out[L::NUM_LEDS];
static const Rgb8 BLUE{0, 100, 255};

static LayerSample playing() { return {LayerPhase::Playing, 0, 1.0f}; }

static void test_brake_overrides_welcome_in_center() {
    std::memset(welcome_px, 255, sizeof welcome_px);
    Canvas2D w{welcome_px, L::WIDTH, L::HEIGHT};
    RearInputs in{/*tail*/ true, /*brake*/ true, /*reverse*/ false, BlinkerState::OFF, 0};
    compose_rear(in, playing(), w, BLUE, 255, 0, out);
    TEST_ASSERT_TRUE(out[1 * L::WIDTH + 70] == L::COLOR_BRAKE);  // centre: brake
    TEST_ASSERT_TRUE(out[1 * L::WIDTH + 10] == BLUE);            // outside centre: welcome
}

static void test_turn_sweep_opaque_in_zone() {
    std::memset(welcome_px, 255, sizeof welcome_px);
    Canvas2D w{welcome_px, L::WIDTH, L::HEIGHT};
    RearInputs in{true, false, false, BlinkerState::LEFT, /*epoch*/ 0};
    compose_rear(in, playing(), w, BLUE, 255, /*now*/ 200, out);  // half way through the sweep
    TEST_ASSERT_TRUE(out[35] == L::COLOR_TURN);   // origin lit
    TEST_ASSERT_TRUE(out[0] == RGB_OFF);          // not reached yet → dark, not welcome
    TEST_ASSERT_TRUE(out[120] == BLUE);           // right side untouched
}

static void test_ambient_dims_welcome_not_safety() {
    std::memset(welcome_px, 255, sizeof welcome_px);
    Canvas2D w{welcome_px, L::WIDTH, L::HEIGHT};
    RearInputs in{true, false, true, BlinkerState::OFF, 0};
    compose_rear(in, playing(), w, BLUE, /*ambient*/ 0, 0, out);
    TEST_ASSERT_TRUE(out[40] == scale(L::COLOR_REVERSE, L::BRIGHTNESS_REVERSE / 255.0f));
    TEST_ASSERT_TRUE(out[10] == RGB_OFF);  // welcome at ambient 0
}

static void test_idle_shows_base() {
    std::memset(welcome_px, 255, sizeof welcome_px);
    Canvas2D w{welcome_px, L::WIDTH, L::HEIGHT};
    RearInputs in{true, false, false, BlinkerState::OFF, 0};
    compose_rear(in, LayerSample{}, w, BLUE, 255, 0, out);
    TEST_ASSERT_TRUE(out[70] == scale(L::COLOR_TAIL, L::BRIGHTNESS_TAIL / 255.0f));
    TEST_ASSERT_TRUE(out[10] == RGB_OFF);
}

static void test_settle_blends_to_base() {
    std::memset(welcome_px, 255, sizeof welcome_px);
    uint8_t front_px[FrontLayout::NUM_LEDS];
    std::memset(front_px, 255, sizeof front_px);
    Canvas1D w{front_px, FrontLayout::NUM_LEDS};
    Rgb8 f[FrontLayout::NUM_LEDS];
    const Rgb8 drl = scale(FrontLayout::COLOR_DRL, FrontLayout::BRIGHTNESS_DRL / 255.0f);
    compose_front({true, false, 0}, {LayerPhase::Settling, 0, 0.0f}, w, BLUE, 255, 0, f, FrontLayout::NUM_LEDS);
    TEST_ASSERT_TRUE(f[0] == drl);
    compose_front({true, false, 0}, {LayerPhase::Settling, 0, 1.0f}, w, BLUE, 255, 0, f, FrontLayout::NUM_LEDS);
    TEST_ASSERT_TRUE(f[0] == BLUE);
}

static void test_front_turn_owns_strip() {
    uint8_t front_px[FrontLayout::NUM_LEDS];
    std::memset(front_px, 255, sizeof front_px);
    Canvas1D w{front_px, FrontLayout::NUM_LEDS};
    Rgb8 f[FrontLayout::NUM_LEDS];
    compose_front({true, true, 0}, playing(), w, BLUE, 255, /*off phase*/ 600, f, FrontLayout::NUM_LEDS);
    for (const Rgb8& p : f) TEST_ASSERT_TRUE(p == RGB_OFF);
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_brake_overrides_welcome_in_center);
    RUN_TEST(test_turn_sweep_opaque_in_zone);
    RUN_TEST(test_ambient_dims_welcome_not_safety);
    RUN_TEST(test_idle_shows_base);
    RUN_TEST(test_settle_blends_to_base);
    RUN_TEST(test_front_turn_owns_strip);
    return UNITY_END();
}
