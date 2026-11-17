// Welcome timeline: cue offset, joint settle, cancel. Run: pio test -e native
#include <unity.h>
#include <core/welcome_plan.hpp>

void setUp() {}
void tearDown() {}

using T = WelcomeTiming;

static WelcomePlan plan() {
    WelcomePlan p;
    p.armed = true;
    p.t0_ms = 1000;
    p.front_dur = 1300;  // pods
    p.front_cue = 600;
    p.rear_dur = 1700;   // wing → end = 600 + 1700 = 2300
    return p;
}

static void test_front_first_then_rear_at_cue() {
    const WelcomePlan p = plan();
    TEST_ASSERT_TRUE(LayerPhase::Playing == sample_front(p, 1000 + 100).phase);
    TEST_ASSERT_TRUE(LayerPhase::Waiting == sample_rear(p, 1000 + 100).phase);
    TEST_ASSERT_TRUE(LayerPhase::Waiting == sample_rear(p, 1000 + 599).phase);
    const LayerSample r = sample_rear(p, 1000 + 700);
    TEST_ASSERT_TRUE(LayerPhase::Playing == r.phase);
    TEST_ASSERT_EQUAL_UINT32(100, r.local_t);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 0.5f, r.alpha);  // half way through the fade-in
}

static void test_front_holds_until_joint_settle() {
    const WelcomePlan p = plan();
    const LayerSample f = sample_front(p, 1000 + 2000);
    TEST_ASSERT_TRUE(LayerPhase::Holding == f.phase);
    TEST_ASSERT_EQUAL_UINT32(1300, f.local_t);
    TEST_ASSERT_EQUAL_UINT32(2300, welcome_end_ms(p));

    const uint32_t settle_mid = 1000 + 2300 + T::SETTLE_MS / 2;
    TEST_ASSERT_TRUE(LayerPhase::Settling == sample_front(p, settle_mid).phase);
    TEST_ASSERT_TRUE(LayerPhase::Settling == sample_rear(p, settle_mid).phase);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 0.5f, sample_front(p, settle_mid).alpha);

    const uint32_t done = 1000 + 2300 + T::SETTLE_MS;
    TEST_ASSERT_TRUE(LayerPhase::Idle == sample_front(p, done).phase);
    TEST_ASSERT_FALSE(welcome_active(p, done));
    TEST_ASSERT_TRUE(welcome_active(p, done - 1));
}

static void test_cancel_fades_out_and_never_restarts() {
    WelcomePlan p = plan();
    p.cancelled = true;
    p.cancel_ms = 1000 + 900;  // front playing, rear 300 ms in
    const LayerSample f = sample_front(p, p.cancel_ms + T::CANCEL_FADE_MS / 2);
    TEST_ASSERT_TRUE(LayerPhase::Cancelling == f.phase);
    TEST_ASSERT_EQUAL_UINT32(900, f.local_t);  // frozen at the cancel time
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 0.5f, f.alpha);
    TEST_ASSERT_TRUE(LayerPhase::Idle == sample_front(p, p.cancel_ms + T::CANCEL_FADE_MS).phase);
    TEST_ASSERT_TRUE(LayerPhase::Idle == sample_rear(p, 1000 + 1500).phase);  // later times stay idle
    TEST_ASSERT_FALSE(welcome_active(p, p.cancel_ms + T::CANCEL_FADE_MS));
}

static void test_unarmed_is_idle() {
    WelcomePlan p = plan();
    p.armed = false;
    TEST_ASSERT_TRUE(LayerPhase::Idle == sample_front(p, 1500).phase);
    TEST_ASSERT_FALSE(welcome_active(p, 1500));
}

static void test_survives_millis_wrap() {
    WelcomePlan p = plan();
    p.t0_ms = 0xFFFFFF00u;
    const LayerSample f = sample_front(p, 0x00000100u);  // 512 ms later, across the wrap
    TEST_ASSERT_TRUE(LayerPhase::Playing == f.phase);
    TEST_ASSERT_EQUAL_UINT32(512, f.local_t);
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_front_first_then_rear_at_cue);
    RUN_TEST(test_front_holds_until_joint_settle);
    RUN_TEST(test_cancel_fades_out_and_never_restarts);
    RUN_TEST(test_unarmed_is_idle);
    RUN_TEST(test_survives_millis_wrap);
    return UNITY_END();
}
