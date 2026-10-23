"""Tests for gen_pinout_docs.py — run with: python -m unittest discover -s zc/tools/pinout_docs"""

import tempfile
import unittest
from pathlib import Path

import gen_pinout_docs as gen

ZC_ROOT = Path(__file__).resolve().parents[2]


def _pin(name: str, gpio: int, description: str = "") -> gen.Pin:
    return gen.Pin(name, gpio, description, "zc/zc_x/src/config.hpp", 1)


class ScanSourceTest(unittest.TestCase):
    def test_constexpr_gpio_num(self):
        pins = gen.scan_source("    static constexpr int ONEWIRE_BUS_PIN = GPIO_NUM_5;\n", "f")
        self.assertEqual([(p.name, p.gpio, p.line) for p in pins], [("ONEWIRE_BUS_PIN", 5, 1)])

    def test_constexpr_plain_integer(self):
        pins = gen.scan_source("    static constexpr int8_t   RELAY_1_PIN           = 13;\n", "f")
        self.assertEqual([(p.name, p.gpio) for p in pins], [("RELAY_1_PIN", 13)])

    def test_define_with_trailing_comment(self):
        pins = gen.scan_source("#define BUTTON_PIN_1 GPIO_NUM_16    // Green Cable, Top Right Button\n", "f")
        self.assertEqual(pins[0].gpio, 16)
        self.assertEqual(pins[0].description, "Green Cable, Top Right Button")
        self.assertEqual(pins[0].wire_color, "green")

    def test_comment_block_applies_to_following_pins_until_blank_line(self):
        src = (
            "struct Esp32HwConfig {\n"
            "    // High beam relays (binary on/off)\n"
            "    static constexpr int LED_PIN_HIGH_BEAM_LEFT  = GPIO_NUM_32;\n"
            "    static constexpr int LED_PIN_HIGH_BEAM_RIGHT = GPIO_NUM_33;\n"
            "\n"
            "    static constexpr int LED_PIN_ARGB_REAR = GPIO_NUM_4;\n"
            "};\n"
        )
        pins = gen.scan_source(src, "f")
        self.assertEqual([p.description for p in pins], ["High beam relays (binary on/off)"] * 2 + [""])

    def test_comment_above_struct_is_not_a_pin_description(self):
        src = "// ── Hardware pin assignments ──────\n// Left controller notes\nstruct Esp32HwConfig {\n    static constexpr int8_t X_PIN = 4;\n};\n"
        self.assertEqual(gen.scan_source(src, "f")[0].description, "")

    def test_ignores_non_pin_constants_and_runtime_defaults(self):
        src = (
            "static constexpr uint32_t KELLY_BAUD_RATE = 19200;\n"
            "static constexpr int8_t DEFAULT_PIN = -1;\n"
            "int BUTTON_PIN = 5;\n"
        )
        self.assertEqual(gen.scan_source(src, "f"), [])

    def test_wire_color_needs_cable_or_wire(self):
        self.assertIsNone(_pin("X_PIN", 4, "welcome color blue").wire_color)
        self.assertEqual(_pin("X_PIN", 4, "Violet Cable, Bottom Left").wire_color, "violet")


class KindTest(unittest.TestCase):
    def test_kinds(self):
        cases = {
            "BMS_UART_RX_PIN": "uart", "KELLY_LEFT_TX_PIN": "uart", "ONEWIRE_BUS_PIN": "bus",
            "BUTTON_PIN_1": "input", "RELAY_1_PIN": "relay", "LED_PIN_ARGB_REAR": "light",
            "MYSTERY_PIN": "other",
        }
        for name, kind in cases.items():
            with self.subTest(name=name):
                self.assertEqual(_pin(name, 4).kind, kind)


class CheckTest(unittest.TestCase):
    def _errors(self, *pins: gen.Pin) -> list[str]:
        return gen.check_zc(gen.ZoneController("zc_x", "esp32-poe-iso", list(pins)))

    def test_clean(self):
        self.assertEqual(self._errors(_pin("A_TX_PIN", 4), _pin("A_RX_PIN", 36)), [])

    def test_duplicate_gpio(self):
        self.assertIn("GPIO 4 is assigned to more than one signal", self._errors(_pin("A_PIN", 4), _pin("B_PIN", 4))[0])

    def test_board_reserved(self):
        self.assertIn("Ethernet MDC", self._errors(_pin("A_PIN", 23))[0])

    def test_output_on_input_only_pin(self):
        self.assertIn("input only", self._errors(_pin("RELAY_1_PIN", 35))[0])
        self.assertIn("input only", self._errors(_pin("KELLY_LEFT_TX_PIN", 39))[0])
        self.assertEqual(self._errors(_pin("KELLY_LEFT_RX_PIN", 39)), [])

    def test_flash_pin(self):
        self.assertIn("SPI flash", self._errors(_pin("A_PIN", 7))[0])


class RepositoryTest(unittest.TestCase):
    """Runs against the real firmware so a format change that hides pins fails CI."""

    def test_every_zone_controller_has_pins_and_no_conflicts(self):
        zcs = [gen.scan_zc(d, ZC_ROOT.parent) for d in gen.discover(ZC_ROOT)]
        names = {zc.name for zc in zcs}
        self.assertTrue({"zc_battery", "zc_buttons", "zc_lights", "zc_motor"} <= names)
        self.assertNotIn("zc_template", names)
        for zc in zcs:
            with self.subTest(zc=zc.name):
                self.assertTrue(zc.pins, f"{zc.name}: no pins found")
                self.assertEqual(zc.errors, [])

    def test_renders_page(self):
        zcs = [gen.scan_zc(d, ZC_ROOT.parent) for d in gen.discover(ZC_ROOT)]
        build = gen.BuildInfo("https://github.com/o/r", "0123456789abcdef", "main", "2026-01-01 00:00 UTC")
        page = gen.render_page(zcs, build)
        self.assertNotIn("{{", page)
        self.assertIn('id="zc_motor"', page)
        self.assertIn("https://github.com/o/r/blob/0123456789abcdef/zc/zc_motor/src/config.hpp#L", page)

    def test_conflicts_are_shown_on_the_page(self):
        with tempfile.TemporaryDirectory() as tmp:
            zc = Path(tmp) / "zc" / "zc_demo"
            (zc / "src").mkdir(parents=True)
            (zc / "platformio.ini").write_text("[env:x]\nboard = esp32-poe-iso\n")
            (zc / "src" / "config.hpp").write_text("static constexpr int A_PIN = 4;\nstatic constexpr int B_PIN = 4;\n")
            zcs = [gen.scan_zc(d, Path(tmp)) for d in gen.discover(Path(tmp) / "zc")]
            page = gen.render_page(zcs, gen.BuildInfo("https://x", "", "", "now"))
        self.assertIn("Pin conflicts", page)
        self.assertIn('class="used clash"', page)


if __name__ == "__main__":
    unittest.main()
