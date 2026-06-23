#!/usr/bin/env python3
"""
gen_player.py — placeholder 4x4 directional walk spritesheet → assets/images/player.png
An adventurer / field-explorer: brimmed hat, olive jacket, backpack, satchel strap, boots.
Layout: 4 cols (walk frames) x 4 rows (down, left, right, up), 64px frames (256x256).
Replace later with a real spritesheet of the same layout (same filename).
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTFILE = os.path.join(ROOT, "assets", "images", "player.png")
F    = 64
SHEET = Image.new("RGBA", (F * 4, F * 4), (0, 0, 0, 0))

HAT    = (202, 164, 114, 255)   # tan brimmed hat
HATSH  = (168, 132, 86, 255)
BAND   = (122, 86, 48, 255)
SKIN   = (232, 184, 144, 255)
SKINSH = (198, 150, 112, 255)
JACK   = (107, 122, 58, 255)    # olive jacket
JACKSH = (82, 94, 44, 255)
PACK   = (122, 82, 48, 255)     # brown backpack
PACKSH = (92, 60, 34, 255)
STRAP  = (74, 52, 30, 255)
PANTS  = (74, 70, 54, 255)
BOOT   = (54, 38, 24, 255)
EYE    = (28, 22, 18, 255)
OUT    = (36, 28, 20, 255)      # outline
SHADOW = (0, 0, 0, 70)

def E(d, box, fill, outline=None, ow=1):
    d.ellipse(box, fill=fill, outline=outline, width=ow)
def R(d, box, fill, outline=None, ow=1, rad=3):
    d.rounded_rectangle(box, radius=rad, fill=fill, outline=outline, width=ow)

def char(d, ox, oy, direction, frame):
    cx = ox + F // 2
    sw = [0, 4, 0, -4][frame]           # leg swing
    d.ellipse([cx - 13, oy + 52, cx + 13, oy + 59], fill=SHADOW)

    if direction in ("down", "up"):
        # legs + boots
        R(d, [cx - 8 + sw, oy + 42, cx - 2 + sw, oy + 54], PANTS, OUT, 1, 2)
        R(d, [cx + 2 - sw, oy + 42, cx + 8 - sw, oy + 54], PANTS, OUT, 1, 2)
        R(d, [cx - 9 + sw, oy + 52, cx - 1 + sw, oy + 56], BOOT, OUT, 1, 1)
        R(d, [cx + 1 - sw, oy + 52, cx + 9 - sw, oy + 56], BOOT, OUT, 1, 1)
        if direction == "up":
            # backpack dominates the back
            R(d, [cx - 11, oy + 28, cx + 11, oy + 47], PACK, OUT, 1, 5)
            R(d, [cx - 7, oy + 32, cx + 7, oy + 43], PACKSH, None, 1, 3)
        else:
            # torso jacket + diagonal satchel strap
            R(d, [cx - 11, oy + 29, cx + 11, oy + 47], JACK, OUT, 1, 5)
            d.line([cx - 9, oy + 31, cx + 7, oy + 45], fill=STRAP, width=3)
            R(d, [cx - 11, oy + 38, cx + 11, oy + 47], JACKSH, None, 1, 3)
            # hands
            E(d, [cx - 14, oy + 38, cx - 9, oy + 44], SKIN, OUT, 1)
            E(d, [cx + 9, oy + 38, cx + 14, oy + 44], SKIN, OUT, 1)
            # backpack straps peek on shoulders
            d.line([cx - 7, oy + 30, cx - 7, oy + 40], fill=STRAP, width=2)
            d.line([cx + 7, oy + 30, cx + 7, oy + 40], fill=STRAP, width=2)
        # head
        E(d, [cx - 9, oy + 16, cx + 9, oy + 32], SKIN, OUT, 1)
        if direction == "down":
            d.ellipse([cx - 5, oy + 24, cx - 2, oy + 28], fill=EYE)
            d.ellipse([cx + 2, oy + 24, cx + 5, oy + 28], fill=EYE)
        # brimmed hat
        E(d, [cx - 13, oy + 17, cx + 13, oy + 25], HAT, OUT, 1)      # brim
        d.pieslice([cx - 9, oy + 9, cx + 9, oy + 25], 180, 360, fill=HAT, outline=OUT)
        d.line([cx - 9, oy + 21, cx + 9, oy + 21], fill=BAND, width=2)  # band

    else:  # left / right profile
        s = -1 if direction == "left" else 1
        R(d, [cx - 4 + sw, oy + 42, cx + 2 + sw, oy + 54], PANTS, OUT, 1, 2)
        R(d, [cx - 2 - sw, oy + 42, cx + 4 - sw, oy + 54], PANTS, OUT, 1, 2)
        R(d, [cx - 5 + sw, oy + 52, cx + 3 + sw, oy + 56], BOOT, OUT, 1, 1)
        R(d, [cx - 3 - sw, oy + 52, cx + 5 - sw, oy + 56], BOOT, OUT, 1, 1)
        # backpack on the BACK (opposite facing) — sort x so x0 <= x1
        _ax, _bx = cx - 11 * s, cx - 3 * s
        R(d, [min(_ax, _bx), oy + 30, max(_ax, _bx), oy + 46], PACK, OUT, 1, 4)
        # torso
        R(d, [cx - 8, oy + 29, cx + 8, oy + 47], JACK, OUT, 1, 5)
        d.line([cx - 6 * s, oy + 30, cx + 6 * s, oy + 45], fill=STRAP, width=3)
        # front hand
        E(d, [cx + 5 * s - 3, oy + 38, cx + 5 * s + 3, oy + 44], SKIN, OUT, 1)
        # head profile
        E(d, [cx - 8, oy + 16, cx + 8, oy + 32], SKIN, OUT, 1)
        d.ellipse([cx + 3 * s - 2, oy + 24, cx + 3 * s + 2, oy + 28], fill=EYE)
        # hat with brim pointing forward
        E(d, [cx - 11, oy + 17, cx + 11, oy + 24], HAT, OUT, 1)
        d.pieslice([cx - 8, oy + 9, cx + 8, oy + 24], 180, 360, fill=HAT, outline=OUT)
        d.ellipse([cx + 6 * s - 4, oy + 18, cx + 6 * s + 6, oy + 23], fill=HATSH)  # brim front

DIRS = ["down", "left", "right", "up"]
dr = ImageDraw.Draw(SHEET)
for row, direction in enumerate(DIRS):
    for col in range(4):
        char(dr, col * F, row * F, direction, col)

SHEET.save(OUTFILE)
print("wrote", OUTFILE, SHEET.size)
