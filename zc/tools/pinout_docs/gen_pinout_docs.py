#!/usr/bin/env python3
"""
gen_pinout_docs.py — ASL Go-Kart Zone Controller GPIO Pinout Documentation Generator

Scans all zc_* subdirectories under the zc/ root, extracts GPIO pin assignments
from C/C++ and Rust source files, and produces a self-contained HTML page
intended for publication as E/E documentation via GitHub Pages.

Recognised patterns
-------------------
C / C++:
  static constexpr int FOO_PIN = GPIO_NUM_5;
  #define BUTTON_PIN_1 GPIO_NUM_14

Rust (esp-idf-hal):
  let tx_left = pins.gpio4;          — named binding from Peripherals
  gpio35: Gpio35                     — typed function / struct parameter

GPIO values are normalised to GPIO_NUM_X across all languages.

Usage
-----
  python zc/tools/gen_pinout_docs.py [--zc-dir ZC_DIR] [--output-dir OUTPUT_DIR]
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import NamedTuple


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

class PinAssignment(NamedTuple):
    signal_name: str
    gpio_value: str   # always normalised to GPIO_NUM_X
    source_file: str  # relative to the zc/ directory


# ---------------------------------------------------------------------------
# Source patterns
# ---------------------------------------------------------------------------

_CC_EXTENSIONS = frozenset({".c", ".cpp", ".h", ".hpp"})

_CC_PATTERNS: list[re.Pattern[str]] = [
    # static constexpr int ONEWIRE_BUS_PIN = GPIO_NUM_5;
    re.compile(r"static\s+constexpr\s+\w+\s+(\w+)\s*=\s*(GPIO_NUM_\d+)\s*;"),
    # #define BUTTON_PIN_1 GPIO_NUM_14
    re.compile(r"#define\s+(\w+)\s+(GPIO_NUM_\d+)"),
]

_RUST_EXTENSIONS = frozenset({".rs"})

_RUST_PATTERNS: list[re.Pattern[str]] = [
    # let tx_left = pins.gpio4;
    re.compile(r"\blet\s+(\w+)\s*=\s*pins\.gpio(\d+)"),
    # name: Gpio35  (typed parameter or struct field)
    re.compile(r"\b(\w+)\s*:\s*Gpio(\d+)\b"),
]

# Directories to skip during recursive walk (build artifacts, vendored deps)
_SKIP_DIRS = frozenset({"target", ".pio", ".git", "build", ".embuild", "managed_components"})


# ---------------------------------------------------------------------------
# File scanning
# ---------------------------------------------------------------------------

def _scan_cc_file(path: Path, rel: str) -> list[PinAssignment]:
    pins: list[PinAssignment] = []
    text = path.read_text(encoding="utf-8", errors="replace")
    for pattern in _CC_PATTERNS:
        for m in pattern.finditer(text):
            pins.append(PinAssignment(m.group(1), m.group(2), rel))
    return pins


def _scan_rust_file(path: Path, rel: str) -> list[PinAssignment]:
    pins: list[PinAssignment] = []
    text = path.read_text(encoding="utf-8", errors="replace")
    for pattern in _RUST_PATTERNS:
        for m in pattern.finditer(text):
            gpio_value = f"GPIO_NUM_{m.group(2)}"
            pins.append(PinAssignment(m.group(1), gpio_value, rel))
    return pins


def _iter_source_files(zc_dir: Path) -> list[Path]:
    """Return all source files under zc_dir, skipping build artifact directories."""
    result: list[Path] = []
    for path in sorted(zc_dir.rglob("*")):
        # Skip if any ancestor directory is in the skip list
        if any(part in _SKIP_DIRS for part in path.parts):
            continue
        if path.is_file():
            result.append(path)
    return result


def scan_zc(zc_dir: Path) -> list[PinAssignment]:
    """Return deduplicated GPIO pin assignments for a single zc_* ECU directory."""
    pins: list[PinAssignment] = []
    zc_root = zc_dir.parent  # the zc/ directory

    for file in _iter_source_files(zc_dir):
        rel = str(file.relative_to(zc_root))
        suffix = file.suffix.lower()
        if suffix in _CC_EXTENSIONS:
            pins.extend(_scan_cc_file(file, rel))
        elif suffix in _RUST_EXTENSIONS:
            pins.extend(_scan_rust_file(file, rel))

    # Deduplicate: keep the first occurrence per (signal_name, gpio_value)
    seen: set[tuple[str, str]] = set()
    unique: list[PinAssignment] = []
    for pin in pins:
        key = (pin.signal_name, pin.gpio_value)
        if key not in seen:
            seen.add(key)
            unique.append(pin)

    return unique


# ---------------------------------------------------------------------------
# HTML generation
# ---------------------------------------------------------------------------

_HTML_HEAD = """\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Zone Controller Pinout &mdash; ASL Go-Kart</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      background: #f0f4f8;
      color: #1a2332;
    }

    header {
      background: #0d1b2a;
      color: #e8edf2;
      padding: 28px 40px 24px;
      border-bottom: 3px solid #1565c0;
    }

    header h1 {
      font-size: 22px;
      font-weight: 600;
      letter-spacing: 0.01em;
    }

    header p {
      margin-top: 6px;
      font-size: 13px;
      color: #8fa3b8;
    }

    main {
      max-width: 960px;
      margin: 32px auto;
      padding: 0 24px;
    }

    section {
      background: #ffffff;
      border: 1px solid #dae0e8;
      border-radius: 6px;
      margin-bottom: 28px;
      overflow: hidden;
    }

    section h2 {
      background: #1565c0;
      color: #ffffff;
      font-size: 15px;
      font-weight: 600;
      letter-spacing: 0.03em;
      padding: 12px 20px;
      font-family: 'Courier New', Courier, monospace;
    }

    .no-pins {
      padding: 16px 20px;
      color: #6b7d91;
      font-style: italic;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }

    thead tr {
      background: #f5f7fa;
      border-bottom: 2px solid #dae0e8;
    }

    thead th {
      text-align: left;
      padding: 10px 20px;
      font-weight: 600;
      color: #3d5166;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.07em;
    }

    tbody tr {
      border-bottom: 1px solid #edf0f4;
    }

    tbody tr:last-child {
      border-bottom: none;
    }

    tbody tr:nth-child(even) {
      background: #fafbfc;
    }

    tbody td {
      padding: 9px 20px;
      vertical-align: middle;
    }

    .signal {
      font-family: 'Courier New', Courier, monospace;
      font-size: 12.5px;
      font-weight: 600;
      color: #1a2332;
    }

    .gpio {
      font-family: 'Courier New', Courier, monospace;
      font-size: 12px;
      background: #e8f0fe;
      color: #1565c0;
      padding: 2px 8px;
      border-radius: 3px;
      white-space: nowrap;
      display: inline-block;
    }

    .source {
      font-family: 'Courier New', Courier, monospace;
      font-size: 11.5px;
      color: #5a6a7a;
    }

    footer {
      text-align: center;
      padding: 20px 24px 32px;
      font-size: 11px;
      color: #8fa3b8;
    }
  </style>
</head>
<body>
  <header>
    <h1>Zone Controller Pinout Documentation</h1>
    <p>ASL Go-Kart &mdash; Board: Olimex ESP32-POE-ISO &mdash; E/E Reference</p>
  </header>
  <main>
"""

_HTML_FOOT_TEMPLATE = """\
  </main>
  <footer>{footer}</footer>
</body>
</html>
"""


def _escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
    )


def _render_section(zc_name: str, pins: list[PinAssignment]) -> str:
    lines: list[str] = [
        f'    <section id="{_escape(zc_name)}">',
        f'      <h2>{_escape(zc_name)}</h2>',
    ]

    if not pins:
        lines.append('      <p class="no-pins">No GPIO pin assignments found in source files.</p>')
    else:
        lines += [
            "      <table>",
            "        <thead>",
            "          <tr>",
            "            <th>Signal Name</th>",
            "            <th>GPIO</th>",
            "            <th>Source File</th>",
            "          </tr>",
            "        </thead>",
            "        <tbody>",
        ]
        for pin in pins:
            lines.append(
                f'          <tr>'
                f'<td class="signal">{_escape(pin.signal_name)}</td>'
                f'<td><span class="gpio">{_escape(pin.gpio_value)}</span></td>'
                f'<td class="source">{_escape(pin.source_file)}</td>'
                f'</tr>'
            )
        lines += [
            "        </tbody>",
            "      </table>",
        ]

    lines.append("    </section>")
    return "\n".join(lines) + "\n"


def _build_footer() -> str:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    ref = os.environ.get("GITHUB_REF_NAME", "")
    sha = os.environ.get("GITHUB_SHA", "")

    parts = [f"Generated: {ts}"]
    if ref:
        parts.append(f"Tag / Branch: {_escape(ref)}")
    if sha:
        parts.append(f"Commit: {_escape(sha[:7])}")

    return " &middot; ".join(parts)


def generate_html(zc_data: dict[str, list[PinAssignment]]) -> str:
    sections = "".join(
        _render_section(name, pins) for name, pins in zc_data.items()
    )
    footer = _build_footer()
    return _HTML_HEAD + sections + _HTML_FOOT_TEMPLATE.format(footer=footer)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    default_zc = Path(__file__).resolve().parent.parent

    parser = argparse.ArgumentParser(
        description="Generate GPIO pinout documentation for ASL Go-Kart zone controllers.",
    )
    parser.add_argument(
        "--zc-dir",
        type=Path,
        default=default_zc,
        metavar="DIR",
        help=f"Path to the zc/ directory (default: {default_zc})",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("docs"),
        metavar="DIR",
        help="Directory to write index.html into (default: docs/)",
    )
    args = parser.parse_args()

    zc_dir: Path = args.zc_dir.resolve()
    output_dir: Path = args.output_dir.resolve()

    if not zc_dir.is_dir():
        print(f"error: zc directory not found: {zc_dir}", file=sys.stderr)
        sys.exit(1)

    # Discover all zc_* subdirectories, skipping non-hardware projects
    _SKIP_ZC = frozenset({"zc_simulator"})
    zc_dirs = sorted(
        d for d in zc_dir.iterdir()
        if d.is_dir() and d.name.startswith("zc_") and d.name not in _SKIP_ZC
    )

    if not zc_dirs:
        print(f"error: no zc_* directories found in {zc_dir}", file=sys.stderr)
        sys.exit(1)

    print(f"Scanning {len(zc_dirs)} zone controller(s) in {zc_dir}\n")
    zc_data: dict[str, list[PinAssignment]] = {}
    for d in zc_dirs:
        pins = scan_zc(d)
        zc_data[d.name] = pins
        print(f"  {d.name:<20} {len(pins):>3} pin assignment(s)")

    html = generate_html(zc_data)

    output_dir.mkdir(parents=True, exist_ok=True)
    out_file = output_dir / "index.html"
    out_file.write_text(html, encoding="utf-8")
    print(f"\nWritten: {out_file}")


if __name__ == "__main__":
    main()
