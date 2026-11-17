// Config blob round trip and tolerance. Run: pio test -e native
#include <unity.h>
#include <core/lights_config.hpp>

void setUp() {}
void tearDown() {}

static uint8_t buf[LIGHTS_CONFIG_MAX_SIZE];

static void test_round_trip() {
    LightsConfig c;
    c.welcome_enabled = false;
    c.front_id = 1;
    c.rear_id = 2;
    c.ambient = 77;
    TEST_ASSERT_TRUE(c.set_color(AnimLayer::FRONT, 1, {1, 2, 3}));
    TEST_ASSERT_TRUE(c.set_color(AnimLayer::REAR, 2, {4, 5, 6}));

    const std::size_t n = encode_config(c, buf, sizeof buf, true);
    TEST_ASSERT_GREATER_THAN(6, n);
    LightsConfig d;
    TEST_ASSERT_TRUE(decode_config(buf, n, d));
    TEST_ASSERT_FALSE(d.welcome_enabled);
    TEST_ASSERT_EQUAL_UINT8(1, d.front_id);
    TEST_ASSERT_EQUAL_UINT8(2, d.rear_id);
    TEST_ASSERT_EQUAL_UINT8(77, d.ambient);
    TEST_ASSERT_TRUE(d.front_color() == (Rgb8{1, 2, 3}));
    TEST_ASSERT_TRUE(d.rear_color() == (Rgb8{4, 5, 6}));
}

static void test_layout_matches_spec() {
    LightsConfig c;
    const std::size_t n = encode_config(c, buf, sizeof buf, true);
    // 4 front + 2 rear custom-colour animations (wing is fixed) → 6 colour entries.
    TEST_ASSERT_EQUAL_UINT8(1, buf[0]);
    TEST_ASSERT_EQUAL_UINT8(6, buf[5]);
    const std::size_t cat = 6 + 5 * 6;
    TEST_ASSERT_EQUAL_UINT8(4, buf[cat]);
    TEST_ASSERT_EQUAL_UINT8(3, buf[cat + 5]);
    TEST_ASSERT_EQUAL(cat + 1 + 4 + 1 + 3, n);
    TEST_ASSERT_EQUAL(cat, encode_config(c, buf, sizeof buf, false));  // NVS form: no catalog
}

static void test_fixed_colour_rejected() {
    LightsConfig c;
    TEST_ASSERT_FALSE(c.set_color(AnimLayer::REAR, 1, {0, 0, 255}));  // CCGT wing is always red
    TEST_ASSERT_FALSE(c.set_color(AnimLayer::FRONT, 99, {0, 0, 255}));
    c.rear_id = 1;
    TEST_ASSERT_TRUE(c.rear_color() == (Rgb8{255, 0, 0}));
}

static void test_bad_blobs_fall_back_to_defaults() {
    LightsConfig d;
    const uint8_t wrong_version[] = {2, 0, 1, 1, 10, 0};
    TEST_ASSERT_FALSE(decode_config(wrong_version, sizeof wrong_version, d));
    TEST_ASSERT_TRUE(d.welcome_enabled);
    TEST_ASSERT_EQUAL_UINT8(255, d.ambient);

    const uint8_t truncated[] = {1, 0, 1, 1, 10, 3, 0, 0};
    TEST_ASSERT_FALSE(decode_config(truncated, sizeof truncated, d));

    const uint8_t unknown_ids[] = {1, 1, 42, 42, 10, 0};
    TEST_ASSERT_TRUE(decode_config(unknown_ids, sizeof unknown_ids, d));
    TEST_ASSERT_EQUAL_UINT8(anim::DEFAULT_FRONT_ID, d.front_id);
    TEST_ASSERT_EQUAL_UINT8(anim::DEFAULT_REAR_ID, d.rear_id);
    TEST_ASSERT_EQUAL_UINT8(10, d.ambient);
}

static void test_trailing_bytes_ignored() {
    LightsConfig c;
    c.ambient = 5;
    const std::size_t n = encode_config(c, buf, sizeof buf, true);
    LightsConfig d;
    TEST_ASSERT_TRUE(decode_config(buf, n, d));  // the catalog is trailing data for the decoder
    TEST_ASSERT_EQUAL_UINT8(5, d.ambient);
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_round_trip);
    RUN_TEST(test_layout_matches_spec);
    RUN_TEST(test_fixed_colour_rejected);
    RUN_TEST(test_bad_blobs_fall_back_to_defaults);
    RUN_TEST(test_trailing_bytes_ignored);
    return UNITY_END();
}
