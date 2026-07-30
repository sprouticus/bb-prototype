#!/usr/bin/env python3
"""
Normalize product photos into uniform square thumbnails.

Covers BOTH the Accessories and the Implements grids. Supersedes the
earlier make-accessory-thumbs.py, which handled Accessories only and used
a weaker bounding-box test (see BOUNDING BOX below).

Why this exists
---------------
Product photos arrive from a dozen suppliers at wildly different aspect
ratios -- 0.62 (farm jack, tall and narrow) through 1.94 (Demco sprayer,
short and wide). The .product-card-img tile in styles.css is already a
1/1 square with object-fit:contain, so the TILES were always identical --
but the PRODUCTS inside them were not. A wide product filled its frame
edge to edge while a tall one occupied a thin ribbon down the middle.

The fix is to normalize the images themselves: trim each to its true
subject bounds, scale so the LONGEST side is exactly TARGET px, and
centre it on a square transparent canvas. Every product then occupies an
identical square regardless of its native shape.

BOUNDING BOX -- why it is not just getbbox()
--------------------------------------------
Pillow's getbbox(), and any plain "alpha > 8" test, treats a SINGLE
stray pixel as content. Several of these files carry a handful of
near-invisible pixels in the far corners (leftover matte from whoever cut
them out), which pinned the box to the full canvas and defeated the trim
entirely -- the three Demco sprayers and the utility trailer all did
this. Raising the threshold alone is not safe either, because genuinely
translucent subjects such as the split windshield would get clipped.

So a row or column counts as content only when at least MIN_FRAC of it
clears ALPHA_THRESHOLD. Stray specks never reach that bar; a real
translucent region, being large and contiguous, always does. This also
fixed Light Bar.png, whose broad faint halo was being measured as part
of the product and shrinking the visible bar.

Usage
-----
    python3 tools/make-product-thumbs.py            # both grids
    python3 tools/make-product-thumbs.py implements # one grid

Reads from <group>/_originals/ and writes to <group>/thumbs/. Run from
the repo root. Requires Pillow and NumPy.

Adding a product
----------------
1. Put the full-resolution cut-out PNG in the group folder AND in that
   group's _originals/ folder.
2. Add an "original.png": "slug-thumb.png" entry to the group's MAP.
3. Re-run this script.
4. In the HTML, point the card's <img src> at the new thumb and its
   data-full at the original.

Do not hand-crop replacements. Uniformity depends entirely on every
subject's longest side landing on exactly the same pixel count.
"""

import os
import sys

import numpy as np
from PIL import Image

CANVAS = 700           # square thumb canvas, px
FILL = 0.92            # fraction of the canvas the subject's long side spans
TARGET = int(CANVAS * FILL)
ALPHA_THRESHOLD = 64   # alpha at or below this is background
MIN_FRAC = 0.005       # a row/col needs this fraction of pixels above the
                       # threshold to count as content (min 3 px)

GROUPS = {
    "accessories": {
        "dir": os.path.join("images", "Accessories"),
        "map": {
            "driver-seat.png":        "driver-seat-thumb.png",
            "split-windshield.png":   "split-windshield-thumb.png",
            "west-coast-mirrors.png": "west-coast-mirrors-thumb.png",
            "Basket.png":             "cargo-basket-thumb.png",
            "Tow Hitch.png":          "tow-hitch-thumb.png",
            "Superwinch.png":         "superwinch-thumb.png",
            "Farm jack.png":          "farm-jack-thumb.png",
            "Light Bar.png":          "light-bar-thumb.png",
            "LED Light Pods.png":     "led-light-pods-thumb.png",
        },
    },
    "implements": {
        "dir": os.path.join("images", "Implements"),
        "map": {
            # B.B. Engineering — moved here from Accessories 2026-07-29
            "bb-utility-trailer.png":                  "bb-utility-trailer-thumb.png",
            "demco-pro-series-40-gallon-sprayer.png":  "demco-pro-series-40-gallon-sprayer-thumb.png",
            "demco-pro-series-60-gallon-sprayer.png":  "demco-pro-series-60-gallon-sprayer-thumb.png",
            "demco-pro-series-80-gallon-sprayer.png":  "demco-pro-series-80-gallon-sprayer-thumb.png",
            "kunz-acrease-mr55be-rough-cut-mower.png": "kunz-acrease-mr55be-rough-cut-mower-thumb.png",
            "rammy-brush-cutter-120-atv-pro.png":      "rammy-brush-cutter-120-atv-pro-thumb.png",
            "rammy-flail-mower-120-atv.png":           "rammy-flail-mower-120-atv-thumb.png",
            "rammy-lawn-mower-120-atv-pro.png":        "rammy-lawn-mower-120-atv-pro-thumb.png",
            "rammy-plow-w165-atv-pro.png":             "rammy-plow-w165-atv-pro-thumb.png",
            "rammy-snowblower-155-utv-pro.png":        "rammy-snowblower-155-utv-pro-thumb.png",
        },
    },
}


def subject_bbox(im):
    """Bounds of the real subject, ignoring isolated stray pixels."""
    alpha = np.array(im)[..., 3]
    mask = alpha > ALPHA_THRESHOLD
    row_min = max(3, int(round(mask.shape[1] * MIN_FRAC)))
    col_min = max(3, int(round(mask.shape[0] * MIN_FRAC)))
    rows = np.where(mask.sum(axis=1) >= row_min)[0]
    cols = np.where(mask.sum(axis=0) >= col_min)[0]
    if not len(rows) or not len(cols):
        return (0, 0, im.width, im.height)
    return (int(cols.min()), int(rows.min()), int(cols.max() + 1), int(rows.max() + 1))


def build(src_path, out_path):
    im = Image.open(src_path).convert("RGBA")
    im = im.crop(subject_bbox(im))

    scale = TARGET / max(im.size)
    im = im.resize(
        (max(1, round(im.width * scale)), max(1, round(im.height * scale))),
        Image.LANCZOS,
    )

    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.paste(im, ((CANVAS - im.width) // 2, (CANVAS - im.height) // 2), im)
    canvas.save(out_path, optimize=True)

    flag = "  <- UPSCALED, source is low-res" if scale > 1 else ""
    return f"  {os.path.basename(out_path):<48} {im.width}x{im.height}  x{scale:.2f}{flag}"


def run(name):
    group = GROUPS[name]
    src_dir = os.path.join(group["dir"], "_originals")
    out_dir = os.path.join(group["dir"], "thumbs")
    if not os.path.isdir(src_dir):
        sys.exit(f"Run this from the repo root; {src_dir} not found.")
    os.makedirs(out_dir, exist_ok=True)

    missing = [s for s in group["map"] if not os.path.exists(os.path.join(src_dir, s))]
    if missing:
        sys.exit(f"[{name}] missing originals: " + ", ".join(missing))

    print(f"[{name}]")
    for src_name, out_name in group["map"].items():
        print(build(os.path.join(src_dir, src_name), os.path.join(out_dir, out_name)))
    print(f"  -> {len(group['map'])} thumbs, {CANVAS}x{CANVAS}, subject long side {TARGET}px\n")


def main():
    names = sys.argv[1:] or list(GROUPS)
    for n in names:
        if n not in GROUPS:
            sys.exit(f"Unknown group '{n}'. Choose from: {', '.join(GROUPS)}")
        run(n)


if __name__ == "__main__":
    main()
