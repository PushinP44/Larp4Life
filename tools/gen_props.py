"""
gen_props.py — Hand-painted 2D pixel-art top-down wetland prop sprites
Southeast-Asian coastal wetland / mangrove estuary.
Warm, slightly melancholic naturalism.

Palette anchors (hex → RGB):
  healthy   #1a9e6b → (26,158,107)
  water     #1a4e6b → (26, 78,107)
  marsh     #2a6b3a → (42,107, 58)
  land      #4a5a3a → (74, 90, 58)
  pollution #6b3a1a → (107, 58, 26)
  toxic     #5c4a1e → (92, 74, 30)
  gold      #f0a500 → (240,165,  0)
  danger    #c0392b → (192, 57, 43)

Usage:  python3 tools/gen_props.py
Output: assets/images/prop_*.png
"""

import math, os
from PIL import Image, ImageDraw, ImageFilter

OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'assets', 'images')
os.makedirs(OUT_DIR, exist_ok=True)

# ── Palette ───────────────────────────────────────────────────────────────────
P = {
    # Primary anchors (exact hex → RGB)
    'healthy':     ( 26, 158, 107),
    'healthy_hi':  ( 72, 210, 148),
    'healthy_sh':  ( 16,  98,  66),
    'water':       ( 26,  78, 107),
    'water_hi':    ( 55, 130, 175),
    'marsh':       ( 42, 107,  58),
    'marsh_hi':    ( 72, 155,  90),
    'marsh_sh':    ( 22,  65,  32),
    'land':        ( 74,  90,  58),
    'land_hi':     (112, 132,  85),
    'land_sh':     ( 45,  56,  34),
    'gold':        (240, 165,   0),
    'gold_hi':     (255, 210,  60),
    'gold_sh':     (180, 115,   0),
    'danger':      (192,  57,  43),
    # Derived
    'wood_dark':   ( 52,  32,  12),
    'wood_mid':    ( 90,  58,  22),
    'wood_light':  (145, 100,  45),
    'wood_hi':     (185, 140,  70),
    'stone_dark':  ( 48,  52,  44),
    'stone_mid':   ( 78,  85,  68),
    'stone_light': (120, 130, 106),
    'stone_hi':    (155, 165, 140),
    'moss':        ( 46,  92,  42),
    'moss_hi':     ( 70, 130,  62),
    'reed_tan':    (155, 128,  52),
    'reed_brown':  ( 98,  72,  28),
    'straw':       (195, 168,  72),
    'straw_hi':    (225, 205, 110),
    'lily_green':  ( 30, 108,  48),
    'lily_hi':     ( 55, 145,  72),
    'flower_blue': ( 72, 122, 195),
    'flower_blue_hi': (108, 162, 230),
    'flower_wht':  (222, 235, 242),
    'flower_yel':  (235, 195,  45),
    'petal_pink':  (210, 155, 160),
}


def new_canvas(w, h=None):
    if h is None:
        h = w
    return Image.new('RGBA', (w, h), (0, 0, 0, 0))


def bake_shadow(img, radius=5, offset=(3, 4), shadow_alpha=100):
    """Soft baked drop-shadow composited under the sprite."""
    alpha = img.split()[3]
    shadow = Image.new('RGBA', img.size, (8, 16, 6, shadow_alpha))
    shadow.putalpha(alpha)
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius))
    shifted = Image.new('RGBA', img.size, (0, 0, 0, 0))
    shifted.paste(shadow, offset)
    out = Image.alpha_composite(shifted, img)
    return out


def circle(draw, cx, cy, r, fill):
    cx, cy, r = float(cx), float(cy), float(r)
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)


def poly_pts(cx, cy, r, n, start_deg=0):
    pts = []
    for i in range(n):
        a = math.radians(start_deg + 360 * i / n)
        pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
    return pts


def blob(draw, cx, cy, base_r, bumps, fill, variation=0.22):
    """Draw an irregular organic blob by radially varying the radius."""
    pts = []
    steps = 64
    for i in range(steps):
        a = 2 * math.pi * i / steps
        noise = 0.0
        for freq, phase, amp in bumps:
            noise += math.sin(freq * a + phase) * amp
        r = base_r * (1 + noise * variation)
        pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
    draw.polygon(pts, fill=fill)


# ─────────────────────────────────────────────────────────────────────────────
# 1. prop_tree.png  96×96 — lush mangrove canopy from above
# ─────────────────────────────────────────────────────────────────────────────
def gen_tree():
    S = 96
    img = new_canvas(S)
    d   = ImageDraw.Draw(img)
    cx, cy = S // 2, S // 2

    # Outermost dark canopy shadow base
    blob(d, cx, cy, 41,
         [(3, 0.5, 1), (5, 1.2, 0.7), (7, 2.1, 0.5)],
         (*P['marsh_sh'], 255), variation=0.18)

    # Main canopy — mid green organic shape
    blob(d, cx, cy, 35,
         [(4, 0.8, 1), (6, 1.5, 0.6), (2, 3.0, 0.8)],
         (*P['marsh'], 255), variation=0.16)

    # Interior lighter zone
    blob(d, cx, cy, 22,
         [(3, 1.0, 1), (5, 2.2, 0.7)],
         (*P['healthy_sh'], 255), variation=0.20)

    # Leaf lobe clusters — top canopy highlights
    lobe_data = [
        (  0, 22, 13, 'healthy'),    ( 45, 22, 12, 'marsh_hi'),
        ( 90, 22, 13, 'healthy'),    (135, 22, 11, 'marsh'),
        (180, 22, 13, 'healthy'),    (225, 22, 12, 'marsh_hi'),
        (270, 22, 13, 'healthy'),    (315, 22, 11, 'marsh'),
        ( 22, 12,  8, 'healthy_hi'), ( 68, 12,  7, 'marsh_hi'),
        (112, 12,  8, 'healthy_hi'), (158, 12,  7, 'marsh_hi'),
        (202, 12,  8, 'healthy_hi'), (248, 12,  7, 'marsh_hi'),
        (292, 12,  8, 'healthy_hi'), (338, 12,  7, 'marsh_hi'),
    ]
    for angle, roff, sz, col in lobe_data:
        a = math.radians(angle)
        lx = cx + math.cos(a) * roff
        ly = cy + math.sin(a) * roff
        circle(d, lx, ly, sz, (*P[col], 210))

    # Canopy rim specular — top-left light source
    circle(d, cx - 14, cy - 14, 11, (*P['healthy_hi'], 140))
    circle(d, cx - 18, cy - 16,  6, (*P['healthy_hi'], 100))

    # Aerial root stubs at centre
    circle(d, cx, cy, 6, (*P['wood_dark'], 220))
    for ang in range(0, 360, 60):
        a = math.radians(ang)
        circle(d, cx + math.cos(a) * 9, cy + math.sin(a) * 9, 2, (*P['wood_mid'], 180))

    # Tiny centre root disk
    circle(d, cx, cy, 3, (*P['wood_mid'], 180))

    return bake_shadow(img, radius=6, offset=(4, 5), shadow_alpha=95)


# ─────────────────────────────────────────────────────────────────────────────
# 2. prop_bush.png  64×64 — leafy shrub
# ─────────────────────────────────────────────────────────────────────────────
def gen_bush():
    S = 64
    img = new_canvas(S)
    d   = ImageDraw.Draw(img)
    cx, cy = S // 2, S // 2 + 3

    # Dark base shadow blob
    blob(d, cx, cy, 25,
         [(3, 0.7, 1), (5, 1.8, 0.6), (7, 3.1, 0.4)],
         (*P['marsh_sh'], 255), variation=0.20)

    # Main bush body
    blob(d, cx, cy, 20,
         [(4, 1.0, 1), (6, 2.5, 0.5), (2, 4.0, 0.7)],
         (*P['marsh'], 255), variation=0.18)

    # Leaf lobe clusters
    for angle, roff, sz, col, alpha in [
        (  0, 13, 10, 'healthy',    230),
        ( 60, 13,  9, 'marsh_hi',   220),
        (120, 13, 10, 'healthy',    230),
        (180, 13,  9, 'marsh_hi',   220),
        (240, 13, 10, 'healthy',    230),
        (300, 13,  9, 'marsh_hi',   220),
        ( 30,  7,  7, 'healthy_hi', 200),
        ( 90,  7,  6, 'marsh_hi',   190),
        (150,  7,  7, 'healthy_hi', 200),
        (210,  7,  6, 'marsh_hi',   190),
        (270,  7,  7, 'healthy_hi', 200),
        (330,  7,  6, 'marsh_hi',   190),
    ]:
        a = math.radians(angle)
        circle(d, cx + math.cos(a)*roff, cy + math.sin(a)*roff, sz, (*P[col], alpha))

    # Top-left specular glint
    circle(d, cx - 9, cy - 10, 7, (*P['healthy_hi'], 130))
    circle(d, cx - 12, cy - 12, 3, (*P['healthy_hi'], 90))

    return bake_shadow(img, radius=4, offset=(3, 3), shadow_alpha=90)


# ─────────────────────────────────────────────────────────────────────────────
# 3. prop_reeds.png  64×64 — marsh reeds / cattails clump
# ─────────────────────────────────────────────────────────────────────────────
def gen_reeds():
    S = 64
    img = new_canvas(S)
    d   = ImageDraw.Draw(img)

    # Base clump of stems
    d.ellipse([18, 48, 46, 58], fill=(*P['reed_brown'], 200))

    # Individual stalks — slightly varied angles
    stalks = [
        # (base_x, base_y, tip_x, tip_y, width, color_key)
        (22, 54, 12,  8, 3, 'reed_tan'),
        (27, 55, 20,  5, 3, 'reed_tan'),
        (32, 56, 32,  3, 4, 'straw'),
        (37, 55, 44,  6, 3, 'reed_tan'),
        (43, 52, 52, 10, 3, 'reed_tan'),
        (30, 54, 25, 15, 2, 'straw'),
        (35, 53, 42, 18, 2, 'straw'),
    ]
    for bx, by, tx, ty, w, ck in stalks:
        d.line([(bx, by), (tx, ty)], fill=(*P[ck], 230), width=w)

    # Cattail seed heads — dark brown oval, gold tip highlight
    heads = [
        (12,  8, 3, 8),
        (20,  5, 3, 8),
        (32,  3, 4, 9),
        (44,  6, 3, 8),
        (52, 10, 3, 7),
    ]
    for hx, hy, rw, rh in heads:
        d.ellipse([hx - rw, hy - rh, hx + rw, hy + rh],
                  fill=(*P['reed_brown'], 250))
        d.ellipse([hx - rw + 1, hy - rh, hx + rw - 1, hy - rh // 2],
                  fill=(*P['straw_hi'], 160))

    # Arching leaf blades — marsh green
    blade_paths = [
        [(24, 50), (16, 32), (10, 22)],
        [(32, 53), (28, 38), (38, 25)],
        [(40, 52), (44, 36), (35, 28)],
    ]
    for pts in blade_paths:
        d.line(pts, fill=(*P['straw'], 190), width=2)

    return bake_shadow(img, radius=3, offset=(2, 3), shadow_alpha=85)


# ─────────────────────────────────────────────────────────────────────────────
# 4. prop_rock.png  64×64 — mossy tidal boulder
# ─────────────────────────────────────────────────────────────────────────────
def gen_rock():
    S = 64
    img = new_canvas(S)
    d   = ImageDraw.Draw(img)
    cx, cy = S // 2, S // 2 + 2

    # Outer dark silhouette — irregular polygon
    blob(d, cx, cy, 24,
         [(2, 0.4, 1), (3, 1.6, 0.8), (5, 2.8, 0.5), (7, 4.2, 0.3)],
         (*P['stone_dark'], 255), variation=0.22)

    # Main stone body
    blob(d, cx, cy, 20,
         [(2, 0.8, 1), (4, 2.0, 0.7), (6, 3.5, 0.4)],
         (*P['stone_mid'], 255), variation=0.18)

    # Stone texture — lighter facet
    blob(d, cx - 4, cy - 5, 12,
         [(3, 1.2, 1), (5, 2.5, 0.6)],
         (*P['stone_light'], 200), variation=0.15)

    # Algae / moss patches
    for mx, my, mr, col, al in [
        (cx - 5, cy - 2, 10, 'moss',    210),
        (cx + 8, cy + 4,  7, 'moss_hi', 170),
        (cx - 1, cy + 9,  6, 'marsh',   160),
        (cx + 3, cy - 1,  4, 'moss_hi', 130),
    ]:
        circle(d, mx, my, mr, (*P[col], al))

    # Top-left specular sheen
    d.ellipse([cx - 17, cy - 15, cx - 4, cy - 6], fill=(*P['stone_hi'], 140))

    # Small satellite pebble
    circle(d, cx + 22, cy + 10, 5, (*P['stone_dark'], 210))
    circle(d, cx + 22, cy + 9,  3, (*P['stone_mid'],  200))
    circle(d, cx - 22, cy + 12, 4, (*P['stone_dark'], 190))
    circle(d, cx - 22, cy + 11, 2, (*P['stone_mid'],  185))

    return bake_shadow(img, radius=5, offset=(3, 4), shadow_alpha=95)


# ─────────────────────────────────────────────────────────────────────────────
# 5. prop_flowers.png  48×48 — blue/white wetland flower cluster
# ─────────────────────────────────────────────────────────────────────────────
def gen_flowers():
    S = 48
    img = new_canvas(S)
    d   = ImageDraw.Draw(img)

    # Background leaf cluster
    for lx, ly, lrx, lry, ang in [
        (14, 36, 10, 5, -20),
        (24, 38,  9, 5,  10),
        (34, 35,  8, 4,  30),
    ]:
        pts = []
        for i in range(32):
            a = 2 * math.pi * i / 32
            px = lx + math.cos(a + math.radians(ang)) * lrx
            py = ly + math.sin(a + math.radians(ang)) * lry
            pts.append((px, py))
        d.polygon(pts, fill=(*P['healthy'], 200))
        # leaf midrib
        d.line([(lx - lrx + 2, ly), (lx + lrx - 2, ly)],
               fill=(*P['healthy_sh'], 130), width=1)

    # Stems
    for bx, by, tx, ty in [(14, 40, 13, 26), (24, 40, 24, 22), (34, 40, 35, 26)]:
        d.line([(bx, by), (tx, ty)], fill=(*P['marsh'], 210), width=2)

    def draw_flower(fcx, fcy, petal_r, petal_off, petal_col, petal_hi, centre_col,
                    n_petals=5, angle_offset=0):
        for i in range(n_petals):
            a  = math.radians(360 * i / n_petals + angle_offset)
            px = fcx + math.cos(a) * petal_off
            py = fcy + math.sin(a) * petal_off
            circle(d, px, py, petal_r, (*P[petal_col], 235))
            # petal highlight
            circle(d, px - 0.8, py - 0.8, max(1, petal_r - 2), (*P[petal_hi], 120))
        circle(d, fcx, fcy, max(2, petal_r - 1), (*P[centre_col], 255))

    # Flower 1 — large blue, gold centre
    draw_flower(13, 24, 5, 5.5, 'flower_blue', 'flower_blue_hi', 'gold', 5, 0)

    # Flower 2 — white, gold centre
    draw_flower(24, 20, 5, 5.5, 'flower_wht', 'flower_wht', 'gold', 5, 15)

    # Flower 3 — small blue
    draw_flower(35, 24, 4, 4.5, 'flower_blue', 'flower_blue_hi', 'gold_hi', 5, 5)

    # Small bud
    d.ellipse([21, 10, 28, 16], fill=(*P['flower_wht'], 180))
    d.ellipse([23, 11, 26, 15], fill=(*P['gold'], 200))

    return bake_shadow(img, radius=3, offset=(2, 2), shadow_alpha=80)


# ─────────────────────────────────────────────────────────────────────────────
# 6. prop_lilypad.png  64×64 — lily pads + white lotus blossom
# ─────────────────────────────────────────────────────────────────────────────
def gen_lilypad():
    S = 64
    img = new_canvas(S)
    d   = ImageDraw.Draw(img)

    def draw_pad(cx, cy, rx, ry, notch_angle=30, alpha_base=240):
        # Main pad body as polygon with notch
        pts = []
        steps = 80
        notch_rad = math.radians(notch_angle)
        for i in range(steps):
            a = 2 * math.pi * i / steps
            # notch cutout near notch_angle direction
            dist = abs(((a - notch_rad + math.pi) % (2*math.pi)) - math.pi)
            notch_depth = max(0, 1 - dist / 0.35)
            r_scale = 1 - notch_depth * 0.45
            px = cx + math.cos(a) * rx * r_scale
            py = cy + math.sin(a) * ry * r_scale
            pts.append((px, py))
        d.polygon(pts, fill=(*P['lily_green'], alpha_base))

        # Darker centre
        d.ellipse([cx - rx*0.45, cy - ry*0.45, cx + rx*0.45, cy + ry*0.45],
                  fill=(*P['marsh_sh'], 160))

        # Radial veins
        for ang in range(0, 360, 36):
            a = math.radians(ang)
            dist = abs(((a - notch_rad + math.pi) % (2*math.pi)) - math.pi)
            notch_d = max(0, 1 - dist / 0.4)
            vlen = (rx * 0.9) * (1 - notch_d * 0.5)
            d.line([(cx, cy), (cx + math.cos(a)*vlen, cy + math.sin(a)*ry/rx*vlen)],
                   fill=(*P['marsh_sh'], 90), width=1)

        # Rim highlight top-left arc
        d.arc([cx - rx, cy - ry, cx + rx, cy + ry],
              start=-130, end=0, fill=(*P['lily_hi'], 160), width=2)

    # Large main pad
    draw_pad(30, 34, 22, 19, notch_angle=25, alpha_base=245)

    # Smaller second pad — offset
    draw_pad(48, 22, 12, 10, notch_angle=200, alpha_base=210)

    # White lotus flower with gold centre — layered petals
    fx, fy = 30, 34
    # Outer petals — slightly off-white / blush
    for i in range(8):
        a = math.radians(45 * i)
        circle(d, fx + math.cos(a)*9, fy + math.sin(a)*9, 5,
               (*P['flower_wht'], 210))
    # Inner petals — white
    for i in range(6):
        a = math.radians(60 * i + 15)
        circle(d, fx + math.cos(a)*5, fy + math.sin(a)*5, 4,
               (*P['flower_wht'], 230))
    # Stamens ring
    for i in range(8):
        a = math.radians(45 * i)
        circle(d, fx + math.cos(a)*3, fy + math.sin(a)*3, 1,
               (*P['gold_hi'], 220))
    # Gold centre
    circle(d, fx, fy, 3, (*P['gold'], 255))
    circle(d, fx, fy, 1, (*P['gold_hi'], 255))

    return bake_shadow(img, radius=4, offset=(3, 4), shadow_alpha=80)


# ─────────────────────────────────────────────────────────────────────────────
# 7. prop_stump.png  64×64 — weathered fallen log / tree stump
# ─────────────────────────────────────────────────────────────────────────────
def gen_stump():
    S = 64
    img = new_canvas(S)
    d   = ImageDraw.Draw(img)
    cx, cy = S // 2, S // 2 + 4

    # Log body — dark silhouette
    blob(d, cx, cy + 2, 26,
         [(2, 0.3, 0.5), (1, 1.5, 1.2)],
         (*P['wood_dark'], 255), variation=0.08)

    # Log body — elongated oval (top-down fallen log)
    log_pts = []
    for i in range(64):
        a = 2 * math.pi * i / 64
        rx = 25 + math.sin(7*a + 0.5) * 1.5
        ry = 12 + math.sin(3*a + 1.0) * 1.0
        log_pts.append((cx + math.cos(a)*rx, cy + math.sin(a)*ry))
    d.polygon(log_pts, fill=(*P['wood_mid'], 255))

    # Bark grain lines — parallel with slight curve
    for yi in range(-8, 12, 3):
        xa = cx - 22 + abs(yi) * 0.3
        xb = cx + 22 - abs(yi) * 0.3
        d.line([(xa, cy + yi), (xb, cy + yi)], fill=(*P['wood_dark'], 60), width=1)

    # Lighter top-face (suggests 3D)
    blob(d, cx + 1, cy - 1, 22,
         [(2, 0.5, 0.5), (4, 2.0, 0.4)],
         (*P['wood_light'], 160), variation=0.10)

    # Cut face — left end, shows growth rings
    cut_cx, cut_cy = cx - 21, cy
    d.ellipse([cut_cx - 11, cut_cy - 9, cut_cx + 11, cut_cy + 9],
              fill=(*P['wood_light'], 240))
    d.ellipse([cut_cx -  9, cut_cy - 7, cut_cx +  9, cut_cy + 7],
              fill=(*P['wood_mid'],   210))
    for ring_r in [7, 5, 3, 1]:
        d.ellipse([cut_cx - ring_r, cut_cy - ring_r * 0.85,
                   cut_cx + ring_r, cut_cy + ring_r * 0.85],
                  outline=(*P['wood_dark'], 90), width=1)
    # Heartwood
    circle(d, cut_cx, cut_cy, 1.5, (*P['wood_dark'], 180))

    # Moss patches on bark
    for mx, my, mr, col, al in [
        (cx + 5,  cy - 3, 7, 'moss',    200),
        (cx + 14, cy + 2, 5, 'moss_hi', 170),
        (cx - 5,  cy + 5, 6, 'marsh',   155),
    ]:
        blob(d, mx, my, mr,
             [(4, 1.0, 1), (6, 2.5, 0.5)],
             (*P[col], al), variation=0.25)

    return bake_shadow(img, radius=5, offset=(3, 4), shadow_alpha=90)


# ─────────────────────────────────────────────────────────────────────────────
# 8. prop_grass.png  48×48 — tuft of tall wetland marsh grass
# ─────────────────────────────────────────────────────────────────────────────
def gen_grass():
    S = 48
    img = new_canvas(S)
    d   = ImageDraw.Draw(img)

    # Base clump soil mound
    blob(d, 24, 42, 11,
         [(3, 0.5, 1), (5, 2.0, 0.6)],
         (*P['land_sh'], 220), variation=0.18)

    # Blade definitions: (base_x, base_y, tip_x, tip_y, width, color_key)
    blades = [
        (18, 42,  6,  8, 3, 'marsh_sh'),
        (20, 42, 10,  4, 2, 'marsh'),
        (22, 42, 16,  3, 3, 'healthy'),
        (24, 42, 24,  2, 3, 'marsh'),
        (26, 42, 32,  3, 3, 'healthy'),
        (28, 42, 36,  5, 2, 'marsh'),
        (30, 42, 40,  8, 3, 'marsh_sh'),
        (21, 42, 14, 12, 2, 'marsh_hi'),
        (27, 42, 34, 14, 2, 'marsh_hi'),
        (23, 42, 20, 16, 2, 'healthy'),
        (25, 42, 28, 16, 2, 'healthy'),
    ]
    for bx, by, tx, ty, w, ck in blades:
        d.line([(bx, by), (tx, ty)], fill=(*P[ck], 230), width=w)

    # Seed head tips — straw-gold oval
    tips = [(6, 8), (10, 4), (16, 3), (24, 2), (32, 3), (36, 5), (40, 8)]
    for tx, ty in tips:
        d.ellipse([tx - 2, ty - 3, tx + 2, ty + 3], fill=(*P['straw'], 215))
        d.ellipse([tx - 1, ty - 3, tx + 1, ty - 1], fill=(*P['straw_hi'], 140))

    return bake_shadow(img, radius=3, offset=(2, 2), shadow_alpha=80)


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
