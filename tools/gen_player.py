#!/usr/bin/env python3
"""
gen_player.py — Field Explorer character concept + 4×4 walk spritesheet
Outputs:
  assets/images/player.png     — 4×4 walk spritesheet (256×256, 64px frames)
  assets/images/player_concept.png — single 128×128 concept art (top-down, facing down)

Palette: land #4a5a3a · gold #f0a500 · healthy #1a9e6b
"""
import os, math
from PIL import Image, ImageDraw, ImageFilter

ROOT    = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG_DIR = os.path.join(ROOT, "assets", "images")
os.makedirs(IMG_DIR, exist_ok=True)

# ── Palette ───────────────────────────────────────────────────────────────
HAT     = (145, 128,  78, 255)   # tan brimmed field hat
HAT_D   = (105,  90,  50, 255)   # hat crown darker
HAT_H   = (185, 168, 108, 255)   # hat highlight
HAT_SH  = ( 80,  66,  34, 255)   # hat brim shadow underside
BAND    = ( 70,  52,  20, 255)   # hat band
SKIN    = (220, 175, 128, 255)   # warm skin
SKIN_D  = (178, 135,  90, 255)   # skin shadow
JACK    = ( 74,  90,  58, 255)   # olive field jacket  #4a5a3a
JACK_D  = ( 48,  60,  36, 255)   # jacket shadow
JACK_H  = ( 98, 118,  78, 255)   # jacket highlight
PACK    = (100,  68,  30, 255)   # tan-brown backpack
PACK_D  = ( 62,  42,  16, 255)
PACK_H  = (138,  98,  50, 255)
STRAP   = ( 56,  42,  18, 255)
PANTS   = ( 60,  75,  52, 255)   # marsh-green trousers
PANTS_D = ( 38,  52,  32, 255)
BOOT    = ( 40,  28,  12, 255)   # dark leather boots
BOOT_H  = ( 72,  52,  26, 255)
EYE     = ( 22,  16,  10, 255)
HAIR    = ( 40,  26,  12, 255)
OUT     = ( 22,  18,  10, 255)   # outline
SCANNER = (240, 165,   0, 255)   # gold scanner
SCAN_H  = (255, 210, 100, 255)
BADGE   = ( 26, 158, 107, 255)   # green insignia badge
BADGE_H = ( 60, 200, 140, 255)
SHADOW  = (  0,   0,   0,  55)   # ground shadow


def circle(d, cx, cy, r, fill, outline=None, ow=1):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill,
              outline=outline, width=ow)


def rrect(d, x0, y0, x1, y1, r, fill, outline=None, ow=1):
    d.rounded_rectangle([x0, y0, x1, y1], radius=r,
                        fill=fill, outline=outline, width=ow)


def poly(d, pts, fill, outline=None, ow=1):
    d.polygon(pts, fill=fill, outline=outline)


# ─────────────────────────────────────────────────────────────────────────────
#  CONCEPT ART  128×128  top-down facing down
# ─────────────────────────────────────────────────────────────────────────────
def draw_concept(size=128):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    cx = size // 2
    cy = size // 2

    # ── Ground shadow (soft ellipse) ──────────────────────────────────────
    sh = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    dsh = ImageDraw.Draw(sh)
    dsh.ellipse([cx - 28, cy + 28, cx + 28, cy + 42], fill=(0, 0, 0, 80))
    sh = sh.filter(ImageFilter.GaussianBlur(radius=5))
    img = Image.alpha_composite(img, sh)
    d = ImageDraw.Draw(img)

    # ── Boots (bottom-most layer) ─────────────────────────────────────────
    # Left boot
    rrect(d, cx - 14, cy + 28, cx - 4, cy + 42, 3, BOOT, OUT, 1)
    d.ellipse([cx - 12, cy + 29, cx - 6, cy + 33], fill=BOOT_H)
    # Right boot
    rrect(d, cx + 4, cy + 28, cx + 14, cy + 42, 3, BOOT, OUT, 1)
    d.ellipse([cx + 6,  cy + 29, cx + 12, cy + 33], fill=BOOT_H)

    # ── Pants / lower legs ───────────────────────────────────────────────
    rrect(d, cx - 13, cy + 14, cx - 3,  cy + 32, 3, PANTS, OUT, 1)
    rrect(d, cx + 3,  cy + 14, cx + 13, cy + 32, 3, PANTS, OUT, 1)
    # inner shadow
    d.rectangle([cx - 11, cy + 24, cx - 5, cy + 30], fill=PANTS_D)
    d.rectangle([cx + 5,  cy + 24, cx + 11, cy + 30], fill=PANTS_D)

    # ── Backpack (behind torso, drawn first) ──────────────────────────────
    rrect(d, cx - 14, cy - 14, cx + 14, cy + 10, 6, PACK, OUT, 1)
    # pack texture — horizontal stitching lines
    for py in range(cy - 9, cy + 8, 5):
        d.line([cx - 11, py, cx + 11, py], fill=PACK_D, width=1)
    # pack highlight
    d.ellipse([cx - 10, cy - 11, cx, cy - 4], fill=PACK_H)
    # pack buckle
    rrect(d, cx - 5, cy + 4, cx + 5, cy + 9, 2, STRAP, OUT, 1)
    d.rectangle([cx - 2, cy + 5, cx + 2, cy + 8], fill=PACK_H)
    # shoulder straps (side strips)
    rrect(d, cx - 16, cy - 14, cx - 10, cy + 14, 3, STRAP, OUT, 1)
    rrect(d, cx + 10, cy - 14, cx + 16, cy + 14, 3, STRAP, OUT, 1)
    # strap highlight
    d.line([cx - 14, cy - 12, cx - 12, cy + 10], fill=PACK_H, width=1)
    d.line([cx + 12, cy - 12, cx + 14, cy + 10], fill=PACK_H, width=1)

    # ── Jacket / torso (on top of pack) ───────────────────────────────────
    # Main jacket shape — trapezoid-ish, wider at shoulders
    poly(d, [
        cx - 18, cy - 10,
        cx + 18, cy - 10,
        cx + 14, cy + 16,
        cx - 14, cy + 16,
    ], JACK, OUT, 1)
    # Jacket highlight (left shoulder)
    poly(d, [
        cx - 17, cy - 9,
        cx - 8,  cy - 9,
        cx - 10, cy + 4,
        cx - 16, cy + 4,
    ], JACK_H)
    # Jacket shadow (right side)
    poly(d, [
        cx + 6,  cy - 4,
        cx + 14, cy - 4,
        cx + 13, cy + 14,
        cx + 5,  cy + 14,
    ], JACK_D)

    # Collar / neck
    poly(d, [
        cx - 6, cy - 8,
        cx + 6, cy - 8,
        cx + 4, cy - 14,
        cx - 4, cy - 14,
    ], JACK, OUT, 1)

    # Green badge / insignia patch (left chest)
    rrect(d, cx - 14, cy - 6, cx - 5, cy + 1, 2, BADGE, OUT, 1)
    d.ellipse([cx - 12, cy - 5, cx - 8, cy - 2], fill=BADGE_H)

    # Diagonal satchel strap
    d.line([cx - 16, cy - 8, cx + 12, cy + 12], fill=STRAP, width=3)
    d.line([cx - 15, cy - 8, cx + 11, cy + 12], fill=PACK_H, width=1)

    # ── Scanner device (gold, held in right hand area) ────────────────────
    rrect(d, cx + 12, cy - 4, cx + 22, cy + 8, 3, SCANNER, OUT, 1)
    d.ellipse([cx + 13, cy - 3, cx + 17, cy + 1], fill=SCAN_H)
    # scanner lens dot
    circle(d, cx + 17, cy + 3, 2, SCAN_H)
    circle(d, cx + 17, cy + 3, 1, (255, 250, 200, 255))

    # ── Hands ─────────────────────────────────────────────────────────────
    # Left hand
    circle(d, cx - 20, cy + 4, 5, SKIN, OUT, 1)
    d.ellipse([cx - 22, cy + 3, cx - 18, cy + 5], fill=SKIN_D)
    # Right hand (holding scanner)
    circle(d, cx + 10, cy + 3, 5, SKIN, OUT, 1)

    # ── Neck ──────────────────────────────────────────────────────────────
    rrect(d, cx - 5, cy - 20, cx + 5, cy - 12, 2, SKIN, OUT, 1)
    d.rectangle([cx + 1, cy - 19, cx + 4, cy - 13], fill=SKIN_D)

    # ── Head ──────────────────────────────────────────────────────────────
    circle(d, cx, cy - 28, 13, SKIN, OUT, 1)
    # Ear left
    d.ellipse([cx - 16, cy - 32, cx - 10, cy - 24], fill=SKIN, outline=OUT, width=1)
    # Ear right
    d.ellipse([cx + 10, cy - 32, cx + 16, cy - 24], fill=SKIN, outline=OUT, width=1)
    # Head shadow (far side)
    poly(d, [
        cx + 2,  cy - 40,
        cx + 12, cy - 36,
        cx + 13, cy - 22,
        cx + 4,  cy - 18,
    ], SKIN_D)
    # Eyes
    d.ellipse([cx - 6, cy - 30, cx - 2, cy - 26], fill=EYE)
    d.ellipse([cx + 2, cy - 30, cx + 6, cy - 26], fill=EYE)
    # Eye shine
    d.ellipse([cx - 5, cy - 29, cx - 4, cy - 28], fill=(255, 255, 255, 180))
    d.ellipse([cx + 3, cy - 29, cx + 4, cy - 28], fill=(255, 255, 255, 180))
    # Nose
    d.ellipse([cx - 2, cy - 24, cx + 2, cy - 22], fill=SKIN_D)

    # ── Brimmed hat (topmost layer) ───────────────────────────────────────
    # Brim — wide ellipse
    d.ellipse([cx - 22, cy - 44, cx + 22, cy - 28], fill=HAT, outline=OUT, width=1)
    # Brim front shadow
    d.ellipse([cx - 20, cy - 36, cx + 20, cy - 30], fill=HAT_SH)
    # Crown — domed cap
    d.pieslice([cx - 14, cy - 54, cx + 14, cy - 28], start=180, end=360,
               fill=HAT_D, outline=OUT, width=1)
    # Crown highlight
    d.ellipse([cx - 8, cy - 52, cx + 2, cy - 42], fill=HAT_H)
    # Hat band
    d.arc([cx - 14, cy - 46, cx + 14, cy - 34], start=190, end=350,
          fill=BAND, width=3)

    return img


# ─────────────────────────────────────────────────────────────────────────────
#  SPRITESHEET  4×4  (walk animation, 64px frames)
# ─────────────────────────────────────────────────────────────────────────────
F = 64
SHEET = Image.new("RGBA", (F * 4, F * 4), (0, 0, 0, 0))


def E(d, box, fill, outline=None, ow=1):
    d.ellipse(box, fill=fill, outline=outline, width=ow)


def R(d, box, fill, outline=None, ow=1, rad=3):
    d.rounded_rectangle(box, radius=rad, fill=fill, outline=outline, width=ow)


def char(d, ox, oy, direction, frame):
    cx = ox + F // 2
    sw = [0, 4, 0, -4][frame]
    d.ellipse([cx - 13, oy + 52, cx + 13, oy + 59], fill=SHADOW)

    if direction in ("down", "up"):
        R(d, [cx - 8 + sw, oy + 42, cx - 2 + sw, oy + 54], PANTS, OUT, 1, 2)
        R(d, [cx + 2 - sw, oy + 42, cx + 8 - sw, oy + 54], PANTS, OUT, 1, 2)
        R(d, [cx - 9 + sw, oy + 52, cx - 1 + sw, oy + 56], BOOT,  OUT, 1, 1)
        R(d, [cx + 1 - sw, oy + 52, cx + 9 - sw, oy + 56], BOOT,  OUT, 1, 1)

        if direction == "up":
            R(d, [cx - 11, oy + 28, cx + 11, oy + 47], PACK,  OUT, 1, 5)
            R(d, [cx -  7, oy + 32, cx +  7, oy + 43], PACK_D, None, 1, 3)
            R(d, [cx + 4, oy + 34, cx + 9, oy + 40], SCANNER, OUT, 1, 2)
        else:
            R(d, [cx - 11, oy + 29, cx + 11, oy + 47], JACK,   OUT, 1, 5)
            d.line([cx - 9, oy + 31, cx + 7, oy + 45], fill=STRAP, width=3)
            R(d, [cx - 11, oy + 38, cx + 11, oy + 47], JACK_D, None, 1, 3)
            R(d, [cx - 8, oy + 31, cx - 2, oy + 36], BADGE, OUT, 1, 2)
            E(d, [cx - 14, oy + 38, cx - 9, oy + 44], SKIN, OUT, 1)
            E(d, [cx +  9, oy + 38, cx + 14, oy + 44], SKIN, OUT, 1)
            d.line([cx - 7, oy + 30, cx - 7, oy + 40], fill=STRAP, width=2)
            d.line([cx + 7, oy + 30, cx + 7, oy + 40], fill=STRAP, width=2)

        E(d, [cx - 9, oy + 16, cx + 9, oy + 32], SKIN, OUT, 1)
        if direction == "down":
            d.ellipse([cx - 5, oy + 24, cx - 2, oy + 28], fill=EYE)
            d.ellipse([cx + 2, oy + 24, cx + 5, oy + 28], fill=EYE)
        E(d, [cx - 13, oy + 17, cx + 13, oy + 25], HAT, OUT, 1)
        d.pieslice([cx - 9, oy + 9, cx + 9, oy + 25], 180, 360, fill=HAT_D, outline=OUT)
        d.line([cx - 9, oy + 21, cx + 9, oy + 21], fill=BAND, width=2)

    else:
        s = -1 if direction == "left" else 1
        R(d, [cx - 4 + sw, oy + 42, cx + 2 + sw, oy + 54], PANTS, OUT, 1, 2)
        R(d, [cx - 2 - sw, oy + 42, cx + 4 - sw, oy + 54], PANTS, OUT, 1, 2)
        R(d, [cx - 5 + sw, oy + 52, cx + 3 + sw, oy + 56], BOOT,  OUT, 1, 1)
        R(d, [cx - 3 - sw, oy + 52, cx + 5 - sw, oy + 56], BOOT,  OUT, 1, 1)
        _ax, _bx = cx - 11 * s, cx - 3 * s
        R(d, [min(_ax, _bx), oy + 30, max(_ax, _bx), oy + 46], PACK, OUT, 1, 4)
        _dx = cx - 9 * s
        R(d, [min(_dx, _dx + 4), oy + 34, max(_dx, _dx + 4), oy + 40], SCANNER, OUT, 1, 2)
        R(d, [cx - 8, oy + 29, cx + 8, oy + 47], JACK, OUT, 1, 5)
        d.line([cx - 6 * s, oy + 30, cx + 6 * s, oy + 45], fill=STRAP, width=3)
        R(d, [cx + 2 * s - 3, oy + 31, cx + 2 * s + 3, oy + 36], BADGE, OUT, 1, 2)
        E(d, [cx + 5 * s - 3, oy + 38, cx + 5 * s + 3, oy + 44], SKIN, OUT, 1)
        E(d, [cx - 8, oy + 16, cx + 8, oy + 32], SKIN, OUT, 1)
        d.ellipse([cx + 3 * s - 2, oy + 24, cx + 3 * s + 2, oy + 28], fill=EYE)
        E(d, [cx - 11, oy + 17, cx + 11, oy + 24], HAT, OUT, 1)
        d.pieslice([cx - 8, oy + 9, cx + 8, oy + 24], 180, 360, fill=HAT_D, outline=OUT)
        d.line([cx - 8, oy + 21, cx + 8, oy + 21], fill=BAND, width=2)
        d.ellipse([cx + 6 * s - 4, oy + 18, cx + 6 * s + 6, oy + 23], fill=HAT_SH)


DIRS = ["down", "left", "right", "up"]
dr   = ImageDraw.Draw(SHEET)
for row, direction in enumerate(DIRS):
    for col in range(4):
        char(dr, col * F, row * F, direction, col)


# ── Save outputs ──────────────────────────────────────────────────────────
sheet_path   = os.path.join(IMG_DIR, "player.png")
concept_path = os.path.join(IMG_DIR, "player_concept.png")

SHEET.save(sheet_path)
print("wrote", sheet_path, SHEET.size)

concept = draw_concept(128)
concept.save(concept_path)
print("wrote", concept_path, concept.size)
