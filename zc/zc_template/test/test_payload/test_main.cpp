// Example host-side test. Run: pio test -e native
#include <unity.h>
#include <initializer_list>
#include <core/payload.hpp>

void setUp() {}
void tearDown() {}

static void test_put_is_big_endian() {
    uint8_t p[4];
    put_u32_be(p, 0x01020304);
    TEST_ASSERT_EQUAL_UINT8(0x01, p[0]);
    TEST_ASSERT_EQUAL_UINT8(0x02, p[1]);
    TEST_ASSERT_EQUAL_UINT8(0x03, p[2]);
    TEST_ASSERT_EQUAL_UINT8(0x04, p[3]);
}

static void test_round_trip() {
    uint8_t p[4];
    for (uint32_t v : {0u, 1u, 0xFFu, 0x100u, 0xDEADBEEFu, 0xFFFFFFFFu}) {
        put_u32_be(p, v);
        TEST_ASSERT_EQUAL_UINT32(v, get_u32_be(p));
    }
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_put_is_big_endian);
    RUN_TEST(test_round_trip);
    return UNITY_END();
}
