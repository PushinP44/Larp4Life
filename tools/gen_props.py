"""
gen_props.py — Programmatic top-down wetland prop sprites for Ecosystem X
Generates 8 transparent PNG props using Pillow drawing primitives.
Cohesive palette, soft drop-shadow, readable at 48-80px.

Usage:  python3 tools/gen_props.py
Output: assets/images/prop_*.png
"""

import math, os
from PIL import Image, ImageDraw, ImageFilter

OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'assets', 'images')
os.makedirs(OUT_DIR, exist_ok=True)

# ── Palette ──────────────────────────────────────────────────────────────────
# Drawn from the existing tileset tokens in renderer.js
P = {
    'dark_green':    (28,  88,  52),
    'mid_green':     (45, 130,  75),
    'light_green':   (88, 175,  95),
    'highlight':    (140, 210, 120),
    'marsh_green':   (55, 110,  65),
    'brown_dark':    (72,  48,  22),
    'brown_mid':    (105,  72,  35),
    'brown_light':  (148, 105,  55),
    'stone_dark':    (68,  72,  62),
    'stone_mid':     (95, 100,  88),
    'stone_light':  (130, 138, 120),
    'moss':          (72, 108,  55),
    'water_dark':    (25,  70, 100),
    'water_mid':     (40, 105, 150),
    'water_light':   (70, 150, 190),
    'lily_green':    (50, 120,  60),
    'flower_blue':   (80, 130, 200),
    'flower_white':  (220, 235, 245),
    'flower_yellow': (230, 195,  50),
    'reed_tan':     (160, 130,  60),
    'reed_brown':   (120,  90,  40),
    'straw':        (195, 170,  80),
    'shadow':        (20,  28,  15, 90),
}

def new_canvas(size):
    """RGBA transparent canvas."""
    return Image.new('RGBA', (size, size), (0, 0, 0, 0))

def bake_shadow(img, radius=4, offset=(2, 3)):
    """Composite a soft drop-shadow under the image."""
    shadow_layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    # Extract alpha, tint it dark, blur it
    alpha = img.split()[3]
    shadow_color = Image.new('RGBA', img.size, (15, 22, 10, 110))
    shadow_color.putalpha(alpha)
    shadow_color = shadow_color.filter(ImageFilter.GaussianBlur(radius))
    # Shift shadow
    shifted = Image.new('RGBA', img.size, (0, 0, 0, 0))
    shifted.paste(shadow_color, offset)
    # Compose: shadow below, then original on top
    out = Image.new('RGBA', img.size, (0, 0, 0, 0))
    out = Image.alpha_composite(out, shifted)
    out = Image.alpha_composite(out, img)
    return out

def circle(draw, cx, cy, r, fill, aa=True):
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)

def lerp_color(c1, c2, t):
    return tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(len(c1)))

# ─────────────────────────────────────────────────────────────────────────────
# 1. prop_tree.png  96×96 — lush wetland tree canopy from above
# ─────────────────────────────────────────────────────────────────────────────
def gen_tree():
    S = 96
    img = new_canvas(S)
    d   = ImageDraw.Draw(img)
    cx, cy = S // 2, S // 2

    # Outer canopy ring (dark green)
    circle(d, cx, cy, 40, (*P['dark_green'], 255))
    # Mid canopy
    circle(d, cx, cy, 32, (*P['mid_green'], 255))
    # Light clusters (simulate leaf clumps)
    for angle, roff, sz in [
        (0,   18, 13), (60,  18, 11), (120, 18, 12),
        (180, 18, 13), (240, 18, 11), (300, 18, 12),
        (30,  10, 9),  (90,  10, 8),  (150, 10, 9),
        (210, 10, 8),  (270, 10, 9),  (330, 10, 8),
    ]:
        a = math.radians(angle)
        lx = cx + math.cos(a) * roff
        ly = cy + math.sin(a) * roff
        circle(d, lx, ly, sz, (*P['light_green'], 220))
    # Highlight cluster top-left (light source top-left)
    circle(d, cx - 10, cy - 10, 9, (*P['highlight'], 190))
    # Trunk glimpse centre
    circle(d, cx, cy, 5, (*P['brown_dark'], 200))
    return bake_shadow(img, radius=5, offset=(3, 4))

# ─────────────────────────────────────────────────────────────────────────────
# 2. prop_bush.png  64×64 — leafy shrub
# ─────────────────────────────────────────────────────────────────────────────
def gen_bush():
    S = 64
    img = new_canvas(S)
    d   = ImageDraw.Draw(img)
    cx, cy = S // 2, S // 2 + 2

    # Base blob
    circle(d, cx, cy, 24, (*P['marsh_green'], 255))
    # Sub-blobs for roundness
    for angle, r in [(0, 17), (72, 16), (144, 17), (216, 16), (288, 17)]:
        a = math.radians(angle)
        circle(d, cx + math.cos(a)*12, cy + math.sin(a)*10, r, (*P['mid_green'], 240))
    # Highlights
    for angle, r in [(320, 8), (340, 7)]:
        a = math.radians(angle)
        circle(d, cx + math.cos(a)*9, cy + math.sin(a)*9, r, (*P['light_green'], 200))
    circle(d, cx - 7, cy - 8, 6, (*P['highlight'], 160))
    return bake_shadow(img, radius=4, offset=(2, 3))

# ─────────────────────────────────────────────────────────────────────────────
# 3. prop_reeds.png  64×64 — marsh reeds / cattails clump
# ─────────────────────────────────────────────────────────────────────────────
def gen_reeds():
    S = 64
    img = new_canvas(S)
    d   = ImageDraw.Draw(img)

    # 5 reed stalks
    stalks = [
        (20, 54, 18, 8,  3),
        (28, 56, 24, 6,  3),
        (36, 58, 30, 5,  4),
        (44, 56, 40, 6,  3),
        (52, 52, 48, 10, 3),
    ]
    for bx, by, tx, ty, w in stalks:
        d.line([(bx, by), (tx, ty)], fill=(*P['reed_tan'], 230), width=w)

    # Cattail heads (dark oval at top of each)
    heads = [(18, 10), (24, 8), (30, 7), (40, 8), (48, 12)]
    for hx, hy in heads:
        d.ellipse([hx - 3, hy - 7, hx + 3, hy + 7], fill=(*P['reed_brown'], 240))

    # Leaf blades — diagonal lines
    blades = [
        [(22, 50), (14, 32)],
        [(30, 52), (38, 28)],
        [(44, 50), (36, 36)],
    ]
    for pts in blades:
        d.line(pts, fill=(*P['straw'], 200), width=2)

    return bake_shadow(img, radius=3, offset=(2, 2))

# ─────────────────────────────────────────────────────────────────────────────
# 4. prop_rock.png  64×64 — mossy boulder
# ─────────────────────────────────────────────────────────────────────────────
def gen_rock():
    S = 64
    img = new_canvas(S)
    d   = ImageDraw.Draw(img)
    cx, cy = S // 2, S // 2 + 3

    # Main boulder (slightly irregular ellipse)
    d.ellipse([cx - 22, cy - 17, cx + 22, cy + 18], fill=(*P['stone_dark'], 255))
    d.ellipse([cx - 20, cy - 15, cx + 20, cy + 15], fill=(*P['stone_mid'],  255))

    # Moss patches
    for mx, my, mr in [(cx - 6, cy - 4, 9), (cx + 8, cy + 2, 7), (cx - 2, cy + 8, 6)]:
        circle(d, mx, my, mr, (*P['moss'], 200))

    # Highlight (top-left sheen)
    d.ellipse([cx - 15, cy - 13, cx - 3, cy - 5], fill=(*P['stone_light'], 160))

    # Small pebbles nearby
    for px, py, pr in [(cx + 18, cy + 8, 4), (cx - 18, cy + 10, 3)]:
        circle(d, px, py, pr, (*P['stone_dark'], 200))
        circle(d, px - 1, py - 1, pr - 1, (*P['stone_mid'], 200))

    return bake_shadow(img, radius=4, offset=(2, 3))

# ─────────────────────────────────────────────────────────────────────────────
# 5. prop_flowers.png  48×48 — wild blue/white wetland flowers
# ─────────────────────────────────────────────────────────────────────────────
def gen_flowers():
    S = 48
    img = new_canvas(S)
    d   = ImageDraw.Draw(img)

    # Stem bases
    stems = [(14, 42, 12, 22), (24, 44, 24, 18), (34, 42, 36, 24)]
    for bx, by, tx, ty in stems:
        d.line([(bx, by), (tx, ty)], fill=(*P['mid_green'], 200), width=2)

    # Flower 1 — blue
    petals_b = [(12, 22), (12, 18), (16, 16), (10, 16), (8, 20), (10, 24), (14, 25)]
    for i in range(5):
        a = math.radians(72 * i)
        px = 12 + math.cos(a) * 5
        py = 20 + math.sin(a) * 5
        circle(d, px, py, 4, (*P['flower_blue'], 230))
    circle(d, 12, 20, 3, (*P['flower_yellow'], 255))

    # Flower 2 — white
    for i in range(5):
        a = math.radians(72 * i + 20)
        px = 24 + math.cos(a) * 5
        py = 16 + math.sin(a) * 5
        circle(d, px, py, 4, (*P['flower_white'], 230))
    circle(d, 24, 16, 3, (*P['flower_yellow'], 255))

    # Flower 3 — blue (smaller)
    for i in range(5):
        a = math.radians(72 * i + 10)
        px = 36 + math.cos(a) * 4
        py = 22 + math.sin(a) * 4
        circle(d, px, py, 3, (*P['flower_blue'], 210))
    circle(d, 36, 22, 2, (*P['flower_yellow'], 255))

    # Tiny leaf
    d.ellipse([20, 30, 28, 36], fill=(*P['light_green'], 200))

    return bake_shadow(img, radius=3, offset=(1, 2))

# ─────────────────────────────────────────────────────────────────────────────
# 6. prop_lilypad.png  64×64 — lily pads on water
# ─────────────────────────────────────────────────────────────────────────────
def gen_lilypad():
    S = 64
    img = new_canvas(S)
    d   = ImageDraw.Draw(img)

    # Large pad (slightly off-centre)
    cx, cy = 30, 32
    # Pad base
    d.ellipse([cx - 22, cy - 20, cx + 22, cy + 20], fill=(*P['lily_green'], 240))
    # Notch cutout (V-shape at top right — characteristic lily pad gap)
    notch = [(cx + 22, cy - 20), (cx, cy), (cx + 16, cy - 28)]
    d.polygon(notch, fill=(0, 0, 0, 0))
    # Darker centre ring
    d.ellipse([cx - 10, cy - 8, cx + 10, cy + 8], fill=(*P['dark_green'], 180))
    # Veins (radial lines)
    for angle in range(0, 360, 45):
        a = math.radians(angle)
        d.line([(cx, cy), (cx + math.cos(a)*20, cy + math.sin(a)*18)],
               fill=(*P['dark_green'], 120), width=1)
    # Highlight rim
    d.arc([cx - 21, cy - 19, cx + 20, cy + 18], start=-40, end=150,
          fill=(*P['light_green'], 150), width=2)

    # Small second pad
    sx, sy = 46, 24
    d.ellipse([sx - 11, sy - 10, sx + 11, sy + 10], fill=(*P['marsh_green'], 220))
    d.ellipse([sx - 5, sy - 4, sx + 5, sy + 4], fill=(*P['dark_green'], 160))

    # White flower
    for i in range(6):
        a = math.radians(60 * i)
        circle(d, cx + math.cos(a)*8, cy + math.sin(a)*8, 4, (*P['flower_white'], 230))
    circle(d, cx, cy, 4, (*P['flower_yellow'], 255))

    return bake_shadow(img, radius=4, offset=(2, 3))

# ─────────────────────────────────────────────────────────────────────────────
# 7. prop_stump.png  64×64 — weathered tree stump / log
# ─────────────────────────────────────────────────────────────────────────────
def gen_stump():
    S = 64
    img = new_canvas(S)
    d   = ImageDraw.Draw(img)
    cx, cy = S // 2, S // 2 + 4

    # Log body (horizontal cylinder top-down = wide oval)
    d.ellipse([cx - 26, cy - 12, cx + 26, cy + 14], fill=(*P['brown_dark'], 255))
    d.ellipse([cx - 24, cy - 10, cx + 24, cy + 11], fill=(*P['brown_mid'],  255))

    # Bark grain lines
    for i in range(-8, 12, 4):
        d.line([(cx - 22, cy + i), (cx + 22, cy + i)],
               fill=(*P['brown_dark'], 80), width=1)

    # Cut face (left end — circle)
    d.ellipse([cx - 26, cy - 11, cx - 10, cy + 11], fill=(*P['brown_light'], 240))
    d.ellipse([cx - 24, cy - 9, cx - 12, cy + 9], fill=(*P['brown_mid'], 200))
    # Growth rings on cut face
    d.ellipse([cx - 22, cy - 7, cx - 14, cy + 7], outline=(*P['brown_dark'], 120), width=1)
    d.ellipse([cx - 20, cy - 4, cx - 16, cy + 4], outline=(*P['brown_dark'], 100), width=1)

    # Moss on top
    for mx, my, mr in [(cx + 4, cy - 4, 7), (cx + 14, cy + 2, 5)]:
        circle(d, mx, my, mr, (*P['moss'], 190))

    return bake_shadow(img, radius=4, offset=(2, 3))

# ─────────────────────────────────────────────────────────────────────────────
# 8. prop_grass.png  48×48 — tuft of tall grass
# ─────────────────────────────────────────────────────────────────────────────
def gen_grass():
    S = 48
    img = new_canvas(S)
    d   = ImageDraw.Draw(img)

    # Base clump — small ellipse
    d.ellipse([14, 36, 34, 44], fill=(*P['dark_green'], 220))

    # Grass blades — pairs of points (base → tip), varied colours
    blades = [
        # (bx, by, tx, ty, width, color_key)
        (18, 40,  8, 10, 2, 'mid_green'),
        (20, 40, 14,  6, 2, 'light_green'),
        (24, 42, 24,  4, 3, 'mid_green'),
        (26, 40, 30,  8, 2, 'light_green'),
        (30, 40, 38, 12, 2, 'mid_green'),
        (22, 40, 18, 14, 2, 'marsh_green'),
        (28, 40, 32, 16, 2, 'marsh_green'),
    ]
    for bx, by, tx, ty, w, ck in blades:
        d.line([(bx, by), (tx, ty)], fill=(*P[ck], 230), width=w)

    # Seed heads at blade tips
    tips = [(8, 10), (14, 6), (24, 4), (30, 8), (38, 12)]
    for tx, ty in tips:
        circle(d, tx, ty, 2, (*P['straw'], 210))

    return bake_shadow(img, radius=3, offset=(1, 2))

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────
PROPS = [
    ('prop_tree.png',    gen_tree),
    ('prop_bush.png',    gen_bush),
    ('prop_reeds.png',   gen_reeds),
    ('prop_rock.png',    gen_rock),
    ('prop_flowers.png', gen_flowers),
    ('prop_lilypad.png', gen_lilypad),
    ('prop_stump.png',   gen_stump),
    ('prop_grass.png',   gen_grass),
]

if __name__ == '__main__':
    for fname, fn in PROPS:
        path = os.path.join(OUT_DIR, fname)
        img  = fn()
        img.save(path)
        print(f'  ✓  {fname}  ({img.size[0]}×{img.size[1]})')
    print(f'\nAll {len(PROPS)} props saved to assets/images/')
