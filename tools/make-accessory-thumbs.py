#!/usr/bin/env python3
"""
Normalize accessory product photos into uniform square thumbnails.

Why this exists
---------------
The source photos for the Accessories page come from a dozen different
suppliers and their aspect ratios range from 0.62 (farm jack, tall and
narrow) to 1.85 (tow hitch, short and wide). The .product-card-img tile
in styles.css is already a 1/1 square with object-fit:contain, so the
TILES were always the same size -- but the PRODUCTS inside them were not.
A wide product filled the frame edge to edge while a tall one occupied a
thin ribbon down the middle.

The fix is to normalize the images themselves: trim each one to its true
alpha bounding box, scale it so its LONGEST side is exactly TARGET px,
and centre it on a square transparent canvas. Every product then occupies
an identical square regardless of its native shape.

Usage
-----
    python3 tools/make-accessory-thumbs.py

Reads originals from images/Accessories/_originals/ and writes thumbs to
images/Accessories/thumbs/. Run from the repo root. Requires Pillow.

Adding a new accessory
----------------------
1. Drop the full-resolution PNG (transparent background) into
   images/Accessories/ AND images/Accessories/_originals/.
2. Add a "original.png": "slug-thumb.png" entry to MAP below.
3. Re-run this script.
4. In accessories.html point the card's <img src> at the new thumb and
   its data-full at the original.

Do not hand-crop replacements. The uniformity depends entirely on every
subject's longest side landing on exactly the same pixel count.
"""

import os
import sys

from PIL import Image

CANVAS = 700          # square thumb canvas, px
FILL = 0.92           # fraction of the canvas the subject's long side spans
TARGET = int(CANVAS * FILL)
ALPHA_THRESHOLD = 8   # alpha below this counts as empty when finding the bbox

SRC_DIR = os.path.join("images", "Accessories", "_originals")
OUT_DIR = os.path.join("images", "Accessories", "thumbs")

MAP = {
    "driver-seat.png":        "driver-seat-thumb.png",
    "split-windshield.png":   "split-windshield-thumb.png",
    "west-coast-mirrors.png": "west-coast-mirrors-thumb.png",
    "utility-trailer.png":    "utility-trailer-thumb.png",
    "Basket.png":             "cargo-basket-thumb.png",
    "Tow Hitch.png":          "tow-hitch-thumb.png",
    "Superwinch.png":         "superwinch-thumb.png",
    "Farm jack.png":          "farm-jack-thumb.png",
    "Light Bar.png":          "light-bar-thumb.png",
    "LED Light Pods.png":     "led-light-pods-thumb.png",
}


def tight_bbox(im):
    """Bounding box of the actual subject, ignoring near-transparent fringes."""
    mask = im.getchannel("A").point(lambda v: 255 if v > ALPHA_THRESHOLD else 0)
    return mask.getbbox() or (0, 0, im.width, im.height)


def build(src_name, out_name):
    src = os.path.join(SRC_DIR, src_name)
    im = Image.open(src).convert("RGBA")
    im = im.crop(tight_bbox(im))

    scale = TARGET / max(im.size)
    new_size = (max(1, round(im.width * scale)), max(1, round(im.height * scale)))
    im = im.resize(new_size, Image.LANCZOS)

    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.paste(im, ((CANVAS - im.width) // 2, (CANVAS - im.height) // 2), im)
    canvas.save(os.path.join(OUT_DIR, out_name), optimize=True)

    flag = "  <- UPSCALED, source is low-res" if scale > 1 else ""
    return f"{out_name:<32} subject {im.width}x{im.height}  scale x{scale:.2f}{flag}"


def main():
    if not os.path.isdir(SRC_DIR):
        sys.exit(f"Run this from the repo root; {SRC_DIR} not found.")
    os.makedirs(OUT_DIR, exist_ok=True)

    missing = [s for s in MAP if not os.path.exists(os.path.join(SRC_DIR, s))]
    if missing:
        sys.exit("Missing originals: " + ", ".join(missing))

    for src_name, out_name in MAP.items():
        print(build(src_name, out_name))

    print(f"\n{len(MAP)} thumbs written to {OUT_DIR}/ "
          f"({CANVAS}x{CANVAS}, subject long side {TARGET}px)")


if __name__ == "__main__":
    main()
