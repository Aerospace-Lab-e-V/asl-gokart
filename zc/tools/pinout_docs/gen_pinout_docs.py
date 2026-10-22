#!/usr/bin/env python3
"""
gen_pinout_docs.py — ASL Go-Kart zone controller pinout page generator

Reads the GPIO assignments straight from the firmware of every PlatformIO zone
controller under zc/ and renders a single self-contained HTML page for the
electrical engineers (published via GitHub Pages).

What counts as a zone controller
--------------------------------
Every zc_* directory that has a platformio.ini, except the template.

Recognised pin declarations (in src/ and include/)
--------------------------------------------------
  static constexpr int ONEWIRE_BUS_PIN = GPIO_NUM_5;   // optional comment
  static constexpr int8_t RELAY_1_PIN = 13;
  #define BUTTON_PIN_1 GPIO_NUM_16    // Green Cable, Top Right Button

The identifier must contain "PIN". The description is the trailing comment, or
otherwise the comment block directly above (shared by consecutive pin lines).

Checks
------
Errors: one GPIO used twice on a ZC, a GPIO reserved by the board (Ethernet),
a flash pin, or an output on an input-only pin. With --strict, any error makes
the script exit with status 1 (the page is still written).

Usage
-----
  python zc/tools/pinout_docs/gen_pinout_docs.py [--zc-dir DIR] [--output-dir DIR] [--strict]
"""

from __future__ import annotations

import argparse
import html
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path


# ---------------------------------------------------------------------------
# Board knowledge
# ---------------------------------------------------------------------------

BOARD_NAMES = {
    "esp32-poe-iso": "Olimex ESP32-POE-ISO",
}

# Pins taken by on-board peripherals, per PlatformIO board id.
# ESP32-POE-ISO: LAN8710A PHY on RMII + PHY power enable.
BOARD_RESERVED: dict[str, dict[int, str]] = {
    "esp32-poe-iso": {
        12: "Ethernet PHY power",
        17: "Ethernet RMII clock out",
        18: "Ethernet MDIO",
        19: "Ethernet TXD0",
        21: "Ethernet TX_EN",
        22: "Ethernet TXD1",
        23: "Ethernet MDC",
        25: "Ethernet RXD0",
        26: "Ethernet RXD1",
        27: "Ethernet CRS_DV",
    },
}

# ESP32 (classic) chip constraints
INPUT_ONLY = frozenset({34, 35, 36, 37, 38, 39})
STRAPPING = frozenset({0, 2, 5, 12, 15})
FLASH = frozenset(range(6, 12))


def pin_caveat(gpio: int) -> str:
    if gpio in FLASH:
        return "Connected to SPI flash, do not use"
    if gpio in INPUT_ONLY:
        return "Input only, no internal pull-up/down"
    if gpio in STRAPPING:
        return "Strapping pin, level at boot matters"
    return ""


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

# (kind id, label, outputs a signal)
KINDS = {
    "uart": ("UART", False),
    "bus": ("Bus", False),
    "input": ("Input", False),
    "relay": ("Relay", True),
    "light": ("Light", True),
    "other": ("Other", False),
}

_WIRE_COLORS = {
    "black": "#1b1b1b", "white": "#f4f4f4", "red": "#d32f2f", "green": "#2e9e4f",
    "blue": "#1e63d6", "yellow": "#f2c40f", "orange": "#f07c12", "violet": "#7e4bc4",
    "purple": "#7e4bc4", "brown": "#7a4a26", "grey": "#8d969e", "gray": "#8d969e",
    "pink": "#ec74b0",
}
_WIRE_RE = re.compile(r"\b(" + "|".join(_WIRE_COLORS) + r")\s+(?:cable|wire)\b", re.IGNORECASE)


@dataclass
class Pin:
    name: str
    gpio: int
    description: str
    file: str  # relative to the repository root
    line: int

    @property
    def kind(self) -> str:
        n = self.name.upper()
        if re.search(r"(^|_)(TX|RX|UART)(_|$)", n):
            return "uart"
        if re.search(r"ONEWIRE|I2C|SDA|SCL|SPI|MOSI|MISO|SCK", n):
            return "bus"
        if "BUTTON" in n or "SWITCH" in n:
            return "input"
        if "RELAY" in n:
            return "relay"
        if "LED" in n or "LIGHT" in n:
            return "light"
        return "other"

    @property
    def is_output(self) -> bool:
        return KINDS[self.kind][1] or bool(re.search(r"(^|_)TX(_|$)", self.name.upper()))

    @property
    def wire_color(self) -> str | None:
        m = _WIRE_RE.search(self.description)
        return m.group(1).lower() if m else None


@dataclass
class ZoneController:
    name: str
    board: str
    pins: list[Pin] = field(default_factory=list)
    hostname: str = ""
    ip: str = ""
    firmware: str = ""
    errors: list[str] = field(default_factory=list)

    @property
    def reserved(self) -> dict[int, str]:
        return BOARD_RESERVED.get(self.board, {})


# ---------------------------------------------------------------------------
# Source scanning
# ---------------------------------------------------------------------------

_SOURCE_DIRS = ("src", "include")
_CC_EXTENSIONS = frozenset({".c", ".cc", ".cpp", ".h", ".hpp"})

_PIN_PATTERNS = [
    # static constexpr int8_t RELAY_1_PIN = 13;   /   const int X_PIN = GPIO_NUM_4;
    re.compile(r"^\s*(?:static\s+)?(?:inline\s+)?(?:constexpr|const)\s+[\w:]+\s+(\w*PIN\w*)\s*=\s*(?:GPIO_NUM_)?(\d+)\s*;(.*)$"),
    # #define BUTTON_PIN_1 GPIO_NUM_16
    re.compile(r"^\s*#define\s+(\w*PIN\w*)\s+\(?(?:GPIO_NUM_)?(\d+)\)?(?=\s|$)(.*)$"),
]
_COMMENT_LINE = re.compile(r"^\s*//+<?\s?(.*)$")
_TRAILING_COMMENT = re.compile(r"//+<?\s*(.*)$")
# Decorative separator comments ("// ── Section ────") carry no description
_DECORATION = re.compile(r"[─━═—-]{3,}")


def scan_source(text: str, rel: str) -> list[Pin]:
    pins: list[Pin] = []
    block: list[str] = []
    prev_was_comment = False

    for lineno, line in enumerate(text.splitlines(), start=1):
        comment = _COMMENT_LINE.match(line)
        if comment:
            if not prev_was_comment:
                block = []
            content = comment.group(1).strip()
            if content and not _DECORATION.search(content):
                block.append(content)
            prev_was_comment = True
            continue
        prev_was_comment = False

        for pattern in _PIN_PATTERNS:
            m = pattern.match(line)
            if m:
                trailing = _TRAILING_COMMENT.search(m.group(3))
                description = trailing.group(1).strip() if trailing else " ".join(block)
                pins.append(Pin(m.group(1), int(m.group(2)), description, rel, lineno))
                break
        else:
            # Any other line ends the comment block's scope
            block = []

    return pins


def _iter_sources(zc_dir: Path) -> list[Path]:
    files: list[Path] = []
    for sub in _SOURCE_DIRS:
        root = zc_dir / sub
        if root.is_dir():
            files += sorted(p for p in root.rglob("*") if p.is_file() and p.suffix.lower() in _CC_EXTENSIONS)
    return files


def _read_board(zc_dir: Path) -> str:
    m = re.search(r"^\s*board\s*=\s*(\S+)", (zc_dir / "platformio.ini").read_text(encoding="utf-8"), re.MULTILINE)
    return m.group(1) if m else "unknown"


def scan_zc(zc_dir: Path, repo_root: Path) -> ZoneController:
    zc = ZoneController(zc_dir.name, _read_board(zc_dir))
    seen: set[tuple[str, int]] = set()

    for file in _iter_sources(zc_dir):
        text = file.read_text(encoding="utf-8", errors="replace")
        rel = file.relative_to(repo_root).as_posix()
        for pin in scan_source(text, rel):
            if (pin.name, pin.gpio) not in seen:
                seen.add((pin.name, pin.gpio))
                zc.pins.append(pin)

        if m := re.search(r'ETH\.setHostname\(\s*"([^"]+)"', text):
            zc.hostname = m.group(1)
        if m := re.search(r"ETH\.config\(\s*IPAddress\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)", text):
            zc.ip = ".".join(m.groups())
        if m := re.search(r'FIRMWARE_VERSION\s*=\s*"([^"]+)"', text):
            zc.firmware = m.group(1)

    zc.pins.sort(key=lambda p: p.gpio)
    zc.errors = check_zc(zc)
    return zc


def check_zc(zc: ZoneController) -> list[str]:
    errors: list[str] = []
    by_gpio: dict[int, list[Pin]] = {}
    for pin in zc.pins:
        by_gpio.setdefault(pin.gpio, []).append(pin)

    for gpio, pins in sorted(by_gpio.items()):
        if len(pins) > 1:
            names = ", ".join(p.name for p in pins)
            errors.append(f"GPIO {gpio} is assigned to more than one signal: {names}")
        for pin in pins:
            if gpio in zc.reserved:
                errors.append(f"{pin.name} uses GPIO {gpio}, which the board reserves for {zc.reserved[gpio]}")
            if gpio in FLASH:
                errors.append(f"{pin.name} uses GPIO {gpio}, which is connected to the SPI flash")
            if gpio in INPUT_ONLY and pin.is_output:
                errors.append(f"{pin.name} drives an output on GPIO {gpio}, which is input only")
    return errors


def discover(zc_root: Path) -> list[Path]:
    return sorted(
        d for d in zc_root.iterdir()
        if d.is_dir() and d.name.startswith("zc_") and d.name != "zc_template"
        and (d / "platformio.ini").is_file()
    )


# ---------------------------------------------------------------------------
# HTML rendering
# ---------------------------------------------------------------------------

_TEMPLATE = Path(__file__).with_name("template.html")


def _e(text: object) -> str:
    return html.escape(str(text), quote=True)


@dataclass
class BuildInfo:
    repo_url: str
    sha: str
    ref: str
    generated: str

    def blob(self, path: str, line: int | None = None) -> str:
        url = f"{self.repo_url}/blob/{self.sha or 'main'}/{path}"
        return f"{url}#L{line}" if line else url


def _swatch(pin: Pin) -> str:
    color = pin.wire_color
    if not color:
        return ""
    return f'<span class="wire" style="--wire:{_WIRE_COLORS[color]}" title="{_e(color)} wire"></span>'


def _signal(pin: Pin) -> str:
    return (
        f'<span class="sig kind-{pin.kind}">{_swatch(pin)}'
        f'<code>{_e(pin.name)}</code></span>'
    )


def _search_text(*parts: str) -> str:
    return _e(" ".join(parts).lower())


def render_matrix(zcs: list[ZoneController]) -> str:
    used: dict[int, dict[str, list[Pin]]] = {}
    for zc in zcs:
        for pin in zc.pins:
            used.setdefault(pin.gpio, {}).setdefault(zc.name, []).append(pin)

    # Pins every ZC loses to the board (and nobody uses), folded into one row at the end
    common_reserved: dict[int, str] = dict(zcs[0].reserved) if zcs else {}
    for zc in zcs[1:]:
        common_reserved = {g: d for g, d in common_reserved.items() if zc.reserved.get(g) == d}
    common_reserved = {g: d for g, d in common_reserved.items() if g not in used}

    head = "".join(
        f'<th scope="col"><a href="#{_e(zc.name)}">{_e(zc.name)}</a>'
        f'<span class="col-meta">{_e(zc.ip or zc.hostname)}</span></th>'
        for zc in zcs
    )

    rows: list[str] = []
    for gpio in sorted(used):
        caveat = pin_caveat(gpio)
        gpio_cell = (
            f'<th scope="row" class="gpio"><span class="num">{gpio}</span>'
            + (f'<span class="caveat">{_e(caveat)}</span>' if caveat else "")
            + "</th>"
        )
        cells: list[str] = []
        words: list[str] = []
        for zc in zcs:
            pins = used.get(gpio, {}).get(zc.name, [])
            if pins:
                clash = " clash" if len(pins) > 1 or gpio in zc.reserved else ""
                cells.append(f'<td class="used{clash}">' + "".join(_signal(p) for p in pins) + "</td>")
                words += [p.name for p in pins] + [p.description for p in pins]
            elif gpio in zc.reserved:
                cells.append(f'<td class="board">{_e(zc.reserved[gpio])}</td>')
            else:
                cells.append('<td class="free"><span>not used</span></td>')
        rows.append(
            f'<tr id="gpio-{gpio}" data-gpio="{gpio}" data-search="{_search_text(*words)}">'
            f'{gpio_cell}{"".join(cells)}</tr>'
        )

    if common_reserved:
        gpios = sorted(common_reserved)
        nums = "".join(f'<span class="num" id="gpio-{g}">{g}</span>' for g in gpios)
        uses = ", ".join(f"{_e(common_reserved[g])} ({g})" for g in gpios)
        rows.append(
            f'<tr class="reserved" data-gpio="{" ".join(map(str, gpios))}" '
            f'data-search="{_search_text(*common_reserved.values())}">'
            f'<th scope="row" class="gpio"><span class="nums">{nums}</span></th>'
            f'<td colspan="{len(zcs)}"><strong>Reserved on every board.</strong> {uses}.</td></tr>'
        )

    return (
        '<table class="matrix">'
        f'<thead><tr><th scope="col" class="corner">GPIO</th>{head}</tr></thead>'
        f'<tbody>{"".join(rows)}</tbody></table>'
    )


def render_zc(zc: ZoneController, build: BuildInfo) -> str:
    facts = [("Board", BOARD_NAMES.get(zc.board, zc.board))]
    if zc.hostname:
        facts.append(("Hostname", zc.hostname))
    if zc.ip:
        facts.append(("IP address", zc.ip))
    if zc.firmware:
        facts.append(("Firmware", zc.firmware))
    facts_html = "".join(f"<div><dt>{_e(k)}</dt><dd>{_e(v)}</dd></div>" for k, v in facts)

    errors = ""
    if zc.errors:
        errors = '<ul class="errors">' + "".join(f"<li>{_e(err)}</li>" for err in zc.errors) + "</ul>"

    if not zc.pins:
        body = '<p class="empty">No pin declarations found in src/ or include/. Declare pins as <code>static constexpr int NAME_PIN = GPIO_NUM_X;</code> so they show up here.</p>'
    else:
        rows = []
        for pin in zc.pins:
            caveat = pin_caveat(pin.gpio)
            desc = _e(pin.description) if pin.description else '<span class="none">No comment in code</span>'
            if caveat:
                desc += f'<span class="caveat">{_e(caveat)}</span>'
            src = f"{pin.file.split('/', 2)[-1]}:{pin.line}"
            rows.append(
                f'<tr data-gpio="{pin.gpio}" data-search="{_search_text(pin.name, pin.description)}">'
                f'<td class="gpio"><a class="num" href="#gpio-{pin.gpio}">{pin.gpio}</a></td>'
                f"<td>{_signal(pin)}</td>"
                f'<td class="kind"><span class="kind-tag kind-{pin.kind}">{KINDS[pin.kind][0]}</span></td>'
                f'<td class="desc">{desc}</td>'
                f'<td class="src"><a href="{_e(build.blob(pin.file, pin.line))}">{_e(src)}</a></td>'
                "</tr>"
            )
        body = (
            '<div class="scroll"><table class="pins"><thead><tr>'
            '<th scope="col">GPIO</th><th scope="col">Signal</th><th scope="col">Kind</th>'
            '<th scope="col">Description</th><th scope="col">Source</th>'
            f'</tr></thead><tbody>{"".join(rows)}</tbody></table></div>'
        )

    return (
        f'<section class="zc" id="{_e(zc.name)}" aria-labelledby="{_e(zc.name)}-title">'
        f'<header><h3 id="{_e(zc.name)}-title">{_e(zc.name)}</h3>'
        f'<dl class="facts">{facts_html}</dl></header>{errors}{body}</section>'
    )


def render_page(zcs: list[ZoneController], build: BuildInfo) -> str:
    all_errors = [f"{zc.name}: {err}" for zc in zcs for err in zc.errors]
    if all_errors:
        issues = (
            '<section class="issues" role="alert"><h2>Pin conflicts</h2><ul>'
            + "".join(f"<li>{_e(e)}</li>" for e in all_errors)
            + "</ul></section>"
        )
    else:
        issues = ""

    pin_count = sum(len(zc.pins) for zc in zcs)
    commit = (
        f'<a href="{_e(build.repo_url)}/commit/{_e(build.sha)}"><code>{_e(build.sha[:7])}</code></a>'
        if build.sha else "a local working copy"
    )
    legend = "".join(
        f'<li><span class="kind-tag kind-{k}">{label}</span></li>' for k, (label, _) in KINDS.items()
    )

    replacements = {
        "{{summary}}": f"{pin_count} signals on {len(zcs)} zone controllers",
        "{{build}}": f"Built from {commit}" + (f" on {_e(build.ref)}" if build.ref else "") + f", {_e(build.generated)}.",
        "{{issues}}": issues,
        "{{legend}}": legend,
        "{{matrix}}": render_matrix(zcs),
        "{{sections}}": "".join(render_zc(zc, build) for zc in zcs),
        "{{repo_url}}": _e(build.repo_url),
        "{{generator_url}}": _e(build.blob("zc/tools/pinout_docs/gen_pinout_docs.py")),
    }
    page = _TEMPLATE.read_text(encoding="utf-8")
    for key, value in replacements.items():
        page = page.replace(key, value)
    return page


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def _git(repo_root: Path, *args: str) -> str:
    try:
        return subprocess.run(
            ["git", *args], cwd=repo_root, capture_output=True, text=True, check=True
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return ""


def build_info(repo_root: Path) -> BuildInfo:
    server = os.environ.get("GITHUB_SERVER_URL", "https://github.com")
    repo = os.environ.get("GITHUB_REPOSITORY", "Aerospace-Lab-e-V/asl-gokart")
    return BuildInfo(
        repo_url=f"{server}/{repo}",
        sha=os.environ.get("GITHUB_SHA") or _git(repo_root, "rev-parse", "HEAD"),
        ref=os.environ.get("GITHUB_REF_NAME") or _git(repo_root, "rev-parse", "--abbrev-ref", "HEAD"),
        generated=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
    )


def main() -> int:
    default_zc = Path(__file__).resolve().parents[2]

    parser = argparse.ArgumentParser(description="Generate the zone controller pinout page.")
    parser.add_argument("--zc-dir", type=Path, default=default_zc, metavar="DIR",
                        help=f"Path to the zc/ directory (default: {default_zc})")
    parser.add_argument("--output-dir", type=Path, default=Path("docs"), metavar="DIR",
                        help="Directory to write index.html into (default: docs/)")
    parser.add_argument("--strict", action="store_true",
                        help="Exit with status 1 if any pin conflict is found")
    args = parser.parse_args()

    zc_root: Path = args.zc_dir.resolve()
    if not zc_root.is_dir():
        print(f"error: zc directory not found: {zc_root}", file=sys.stderr)
        return 1

    zc_dirs = discover(zc_root)
    if not zc_dirs:
        print(f"error: no PlatformIO zc_* directories found in {zc_root}", file=sys.stderr)
        return 1

    repo_root = zc_root.parent
    print(f"Scanning {len(zc_dirs)} zone controller(s) in {zc_root}\n")
    zcs = [scan_zc(d, repo_root) for d in zc_dirs]
    for zc in zcs:
        print(f"  {zc.name:<14} {len(zc.pins):>3} pin(s)")
        for err in zc.errors:
            print(f"    error: {err}", file=sys.stderr)

    out_file = args.output_dir.resolve() / "index.html"
    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_text(render_page(zcs, build_info(repo_root)), encoding="utf-8")
    print(f"\nWritten: {out_file}")

    if args.strict and any(zc.errors for zc in zcs):
        print("\nPin conflicts found (see errors above).", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
