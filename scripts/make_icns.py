#!/usr/bin/env python3
"""Assemble a macOS .icns from the brand pack's Light PNGs.

Tauri only needs a valid `icon.icns`; the container is a list of PNG entries,
one per size. The pack ships every size except the 1024 tile the Retina
largest icon wants, so that one is passed separately (any image tool can
resample the 512 tile once). Without it the container still validates and
macOS falls back to the 512 entry.

    python scripts/make_icns.py \
        --pack OraxDesk_Brand_Concept_Pack \
        --big  /tmp/icon-1024.png \
        --out  src-tauri/icons/icon.icns
"""

from __future__ import annotations

import argparse
import pathlib
import struct

# icns entry types and the pack file that fills each. The `icp*` family is
# the classic 16/32/64 set; `ic07`..`ic10` are the 128..1024 sizes modern
# macOS actually looks for.
ENTRIES = [
    ("icp4", "OraxDesk_Icon_Light_16.png"),
    ("icp5", "OraxDesk_Icon_Light_32.png"),
    ("icp6", "OraxDesk_Icon_Light_64.png"),
    ("ic07", "OraxDesk_Icon_Light_128.png"),
    ("ic08", "OraxDesk_Icon_Light_256.png"),
    ("ic09", "OraxDesk_Icon_Light_512.png"),
]


def png_bytes(path: pathlib.Path) -> bytes:
    data = path.read_bytes()
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise SystemExit(f"{path} is not a PNG")
    return data


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pack", default="OraxDesk_Brand_Concept_Pack")
    parser.add_argument("--big", help="1024x1024 PNG for ic10 (optional)")
    parser.add_argument("--out", default="src-tauri/icons/icon.icns")
    args = parser.parse_args()

    pack = pathlib.Path(args.pack)
    body = b""
    for kind, name in ENTRIES:
        png = png_bytes(pack / name)
        body += kind.encode("ascii") + struct.pack(">I", len(png) + 8) + png
    if args.big:
        png = png_bytes(pathlib.Path(args.big))
        body += b"ic10" + struct.pack(">I", len(png) + 8) + png

    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(b"icns" + struct.pack(">I", len(body) + 8) + body)
    print(f"wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
