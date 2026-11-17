// Contract tests for every welcome animation in the registry, plus a few
// animation-specific checks. Run: pio test -e native
#include <unity.h>
#include <cstring>
#include <initializer_list>
#include <animations/registry.hpp>
#include <core/light_layout.hpp>

void setUp() {}
void tearDown() {}

static uint8_t front_a[FrontLayout::NUM_LEDS], front_b[FrontLayout::NUM_LEDS];
static uint8_t rear_a[RearLayout::NUM_LEDS], rear_b[RearLayout::NUM_LEDS];

static Canvas1D front_canvas(uint8_t* px) { return {px, FrontLayout::NUM_LEDS}; }
static Canvas2D rear_canvas(uint8_t* px) { return {px, RearLayout::WIDTH, RearLayout::HEIGHT}; }

/// Renders twice into canvases pre-filled differently: pure + writes every pixel ⇒ equal.
static void test_front_pure_and_complete() {
    for (const FrontAnimation* a : anim::FRONT) {
        for (uint32_t t = 0; t <= a->duration_ms; t += 50) {
            std::memset(front_a, 0x00, sizeof front_a);
            std::memset(front_b, 0xAB, sizeof front_b);
            Canvas1D ca = front_canvas(front_a), cb = front_canvas(front_b);
            a->render(t, ca);
            a->render(t, cb);
            TEST_ASSERT_EQUAL_UINT8_ARRAY_MESSAGE(front_a, front_b, sizeof front_a, a->name);
        }
    }
}

static void test_rear_pure_and_complete() {
    for (const RearAnimation* a : anim::REAR) {
        for (uint32_t t = 0; t <= a->duration_ms; t += 100) {
            std::memset(rear_a, 0x00, sizeof rear_a);
            std::memset(rear_b, 0xAB, sizeof rear_b);
            Canvas2D ca = rear_canvas(rear_a), cb = rear_canvas(rear_b);
            a->render(t, ca);
            a->render(t, cb);
            TEST_ASSERT_EQUAL_UINT8_ARRAY_MESSAGE(rear_a, rear_b, sizeof rear_a, a->name);
        }
    }
}

static void test_front_starts_dark_ends_lit() {
    for (const FrontAnimation* a : anim::FRONT) {
        Canvas1D c = front_canvas(front_a);
        a->render(0, c);
        uint32_t sum = 0;
        for (uint8_t v : front_a) sum += v;
        TEST_ASSERT_LESS_THAN_UINT32_MESSAGE(FrontLayout::NUM_LEDS * 60, sum, a->name);  // mostly dark (scan's head may be lit)
        a->render(a->duration_ms, c);
        for (uint8_t v : front_a) TEST_ASSERT_EQUAL_UINT8_MESSAGE(255, v, a->name);
        TEST_ASSERT_TRUE_MESSAGE(a->cue_ms <= a->duration_ms, a->name);
    }
}

static void test_rear_starts_dark_and_is_symmetric() {
    for (const RearAnimation* a : anim::REAR) {
        Canvas2D c = rear_canvas(rear_a);
        a->render(0, c);
        for (uint16_t col = 0; col < RearLayout::WIDTH; ++col) {
            if (col == 71 || col == 72) continue;  // a centre pixel may start lit
            TEST_ASSERT_EQUAL_UINT8_MESSAGE(0, c.get(col, 1), a->name);
        }
        for (uint32_t t = 0; t <= a->duration_ms; t += 100) {
            a->render(t, c);
            for (uint16_t row = 0; row < RearLayout::HEIGHT; ++row)
                for (uint16_t col = 0; col < RearLayout::WIDTH / 2; ++col)
                    TEST_ASSERT_EQUAL_UINT8_MESSAGE(c.get(col, row), c.get(RearLayout::WIDTH - 1 - col, row), a->name);
        }
    }
}

static void test_classic_and_wing_end_fully_lit() {
    for (const RearAnimation* a : {&anim::kRearClassic, &anim::kRearWing}) {
        Canvas2D c = rear_canvas(rear_a);
        a->render(a->duration_ms, c);
        for (uint8_t v : rear_a) TEST_ASSERT_EQUAL_UINT8_MESSAGE(255, v, a->name);
    }
}

static void test_pods_step_one_after_another() {
    Canvas1D c = front_canvas(front_a);
    anim::kFrontPods.render(100, c);  // first pod fully on, others off
    TEST_ASSERT_EQUAL_UINT8(255, c.get(0));
    TEST_ASSERT_EQUAL_UINT8(255, c.get(4));
    TEST_ASSERT_EQUAL_UINT8(0, c.get(5));
    anim::kFrontPods.render(350, c);  // second pod on
    TEST_ASSERT_EQUAL_UINT8(255, c.get(9));
    TEST_ASSERT_EQUAL_UINT8(0, c.get(10));
}

static void test_sweep_monotonic() {
    Canvas1D c = front_canvas(front_a);
    for (uint32_t t = 0; t <= anim::kFrontSweep.duration_ms; t += 40) {
        anim::kFrontSweep.render(t, c);
        for (uint16_t i = 1; i < c.len; ++i) TEST_ASSERT_TRUE(c.get(i) <= c.get(i - 1));  // fills from the inner end
    }
}

static void test_wing_shows_dots_during_burst() {
    Canvas2D c = rear_canvas(rear_a);
    anim::kRearWing.render(300, c);
    // Within the lit half span there must be both lit dots and dark gaps.
    int lit = 0, dark = 0;
    for (uint16_t col = 72 + 8; col < 72 + 30; ++col) (c.get(col, 0) > 40 ? lit : dark) += 1;
    TEST_ASSERT_GREATER_THAN(0, lit);
    TEST_ASSERT_GREATER_THAN(0, dark);
    // Nothing beyond half span yet.
    TEST_ASSERT_EQUAL_UINT8(0, c.get(143, 0));
    // The core is solid and brightest.
    TEST_ASSERT_TRUE(c.get(72, 0) >= c.get(72 + 25, 0));
}

static void test_registry_lookup() {
    TEST_ASSERT_EQUAL_PTR(&anim::kFrontScan, anim::find_front(3));
    TEST_ASSERT_NULL(anim::find_front(200));
    TEST_ASSERT_EQUAL_PTR(&anim::kRearWing, anim::find_rear(1));
    TEST_ASSERT_FALSE(anim::kRearWing.custom_color);
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_front_pure_and_complete);
    RUN_TEST(test_rear_pure_and_complete);
    RUN_TEST(test_front_starts_dark_ends_lit);
    RUN_TEST(test_rear_starts_dark_and_is_symmetric);
    RUN_TEST(test_classic_and_wing_end_fully_lit);
    RUN_TEST(test_pods_step_one_after_another);
    RUN_TEST(test_sweep_monotonic);
    RUN_TEST(test_wing_shows_dots_during_burst);
    RUN_TEST(test_registry_lookup);
    return UNITY_END();
}
