#!/usr/bin/env python3
"""
gen_keyart.py — 1600×1000 cover art for Ecosystem X: The Last Balance
16:9, top-down coastal wetland at a tipping point.
Left half: lush emerald seagrass with Painted Stork.
Right half: murky algal-brown polluted water with runoff outfall.
Lone field-agent at the boundary. Cinematic, hopeful-but-urgent.

Palette anchors:
  healthy #1a9e6b  water #1a4e6b  marsh #2a6b3a
  land #4a5a3a     pollution #6b3a1a  toxic #5c4a1e
  gold #f0a500     danger #c0392b
"""
import os, math, random
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageEnhance

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG  = os.path.join(ROOT, "assets", "images")
W, H = 1600, 1000
SPLIT_X = int(W * 0.52)   # pixel x of the dividing boundary

# ── Palette ───────────────────────────────────────────────────────────────────
HEALTHY    = ( 26, 158, 107)
HEALTHY_HI = ( 72, 210, 148)
HEALTHY_SH = ( 16,  98,  66)
WATER      = ( 26,  78, 107)
WATER_HI   = ( 55, 130, 175)
WATER_SH   = ( 10,  45,  72)
MARSH      = ( 42, 107,  58)
MARSH_HI   = ( 72, 155,  90)
MARSH_SH   = ( 22,  65,  32)
LAND       = ( 74,  90,  58)
LAND_SH    = ( 45,  56,  34)
POLLUTION  = (107,  58,  26)
TOXIC      = ( 92,  74,  30)
TOXIC_HI   = (130, 105,  45)
TOXIC_SH   = ( 55,  40,  12)
ALGAE      = ( 72,  88,  18)
ALGAE_SH   = ( 42,  52,   8)
GOLD       = (240, 165,   0)
GOLD_HI    = (255, 215,  70)
GOLD_SH    = (165, 108,   0)
DANGER     = (192,  57,  43)
BLACK      = (  4,   6,   4)
WHITE      = (240, 248, 245)

rng = random.Random(42)   # deterministic


def lerp(a, b, t):
    return a + (b - a) * t


def lerpc(ca, cb, t):
    return tuple(int(lerp(ca[i], cb[i], t)) for i in range(len(ca)))


def circle(draw, cx, cy, r, fill):
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)


def blob_pts(cx, cy, rx, ry, bumps, variation=0.18, steps=64):
    pts = []
    for i in range(steps):
        a = 2 * math.pi * i / steps
        noise = sum(math.sin(f * a + p) * amp for f, p, amp in bumps)
        r = (rx + ry) / 2 * (1 + noise * variation)
        pts.append((cx + math.cos(a) * rx / ((rx + ry) / 2) * r,
                    cy + math.sin(a) * ry / ((rx + ry) / 2) * r))
    return pts


def font(size):
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Black.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for p in candidates:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            pass
    return ImageFont.load_default()


def font_reg(size):
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for p in candidates:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            pass
    return ImageFont.load_default()


def load_prop(name):
    p = os.path.join(IMG, name)
    return Image.open(p).convert("RGBA") if os.path.exists(p) else None


def paste_prop(base, im, cx, cy, scale=1.0):
    if im is None:
        return
    nw = max(1, int(im.width * scale))
    nh = max(1, int(im.height * scale))
    s  = im.resize((nw, nh), Image.LANCZOS)
    x  = int(cx - nw / 2)
    y  = int(cy - nh / 2)
    base.alpha_composite(s, (x, y))


def sicken(im, amt=0.8):
    """Desaturate + darken + tint toward toxic."""
    if im is None:
        return None
    im = ImageEnhance.Color(im).enhance(1 - 0.85 * amt)
    im = ImageEnhance.Brightness(im).enhance(1 - 0.30 * amt)
    # slight yellow-brown tint
    tint = Image.new("RGBA", im.size, (*TOXIC_HI, int(70 * amt)))
    im = Image.alpha_composite(im, tint)
    return im


# =============================================================================
# LAYER 1: Sky / atmospheric gradient
# =============================================================================
base = Image.new("RGBA", (W, H), (0, 0, 0, 255))
d    = ImageDraw.Draw(base)

SKY_TOP = ( 8, 22, 20)
SKY_BOT = (18, 42, 28)
for y in range(H):
    t = y / H
    c = lerpc(SKY_TOP, SKY_BOT, t)
    d.line([(0, y), (W, y)], fill=(*c, 255))


# =============================================================================
# LAYER 2: Water base — two halves
# =============================================================================
GROUND_Y = int(H * 0.30)   # water/ground starts here

# Left — healthy water, rich estuary blue-green
for y in range(GROUND_Y, H):
    t   = (y - GROUND_Y) / (H - GROUND_Y)
    xsplit_here = SPLIT_X + int(60 * math.sin(y * 0.012))
    # Left water
    col_l = lerpc(WATER, lerpc(HEALTHY_SH, MARSH_SH, 0.4), min(1, t * 0.7))
    d.line([(0, y), (xsplit_here, y)], fill=(*col_l, 255))
    # Right water — murky algae-brown
    col_r = lerpc(
        lerpc(ALGAE_SH, TOXIC_SH, 0.5),
        lerpc(TOXIC_SH, (20, 18, 8), 0.5),
        min(1, t * 0.8)
    )
    d.line([(xsplit_here, y), (W, y)], fill=(*col_r, 255))


# =============================================================================
# LAYER 3: Seagrass beds — left half (scattered elongated patches)
# =============================================================================
grass_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gd = ImageDraw.Draw(grass_layer)

sg_patches = [
    (120, 820, 110, 50), (280, 760, 90, 40), (420, 870, 130, 55),
    (160, 920, 120, 45), (350, 950, 100, 40), (520, 830, 95, 42),
    ( 70, 700, 80, 35),  (200, 650, 75, 30),  (470, 950, 85, 35),
    (620, 900, 70, 30),  (580, 760, 65, 28),  (310, 880, 90, 38),
    (680, 840, 60, 25),  (720, 970, 75, 30),
]
for (px, py, pw, ph) in sg_patches:
    if px > SPLIT_X - 60:
        continue
    for _ in range(30):
        lx = px + rng.randint(-pw // 2, pw // 2)
        ly = py + rng.randint(-ph // 2, ph // 2)
        length = rng.randint(18, 45)
        angle  = rng.uniform(-0.3, 0.3)
        ex     = lx + int(math.sin(angle) * length)
        ey     = ly - int(math.cos(angle) * length)
        col    = rng.choice([HEALTHY, HEALTHY_SH, MARSH, MARSH_HI])
        w      = rng.randint(2, 4)
        gd.line([(lx, ly), (ex, ey)], fill=(*col, rng.randint(160, 220)), width=w)
    # Patch bloom — lighter centre
    gd.ellipse([px - pw // 3, py - ph // 3, px + pw // 3, py + ph // 3],
               fill=(*HEALTHY_HI, 35))

base.alpha_composite(grass_layer)


# =============================================================================
# LAYER 4: Algae bloom / murky scum — right half
# =============================================================================
algae_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
ad = ImageDraw.Draw(algae_layer)

algae_patches = [
    (1050, 700, 150, 70), (1200, 820, 180, 80), (1380, 760, 140, 60),
    (1480, 900, 120, 55), (1100, 940, 160, 65), (1320, 960, 130, 50),
    ( 900, 850, 110, 50), ( 980, 960, 100, 45), (1450, 620, 90, 40),
    (1550, 800, 80, 35),  (1250, 690, 100, 42),
]
for (px, py, pw, ph) in algae_patches:
    if px < SPLIT_X + 30:
        continue
    pts = blob_pts(px, py, pw // 2, ph // 2,
                   [(3, 0.5, 1), (5, 1.8, 0.7), (7, 3.2, 0.4)],
                   variation=0.25)
    ad.polygon(pts, fill=(*ALGAE, rng.randint(80, 140)))
    # inner darker core
    pts2 = blob_pts(px + rng.randint(-10, 10), py + rng.randint(-5, 5),
                    pw // 4, ph // 4,
                    [(4, 1.0, 1), (6, 2.5, 0.5)], variation=0.20)
    ad.polygon(pts2, fill=(*ALGAE_SH, rng.randint(100, 160)))

base.alpha_composite(algae_layer)


# =============================================================================
# LAYER 5: Water ripples / reflections — subtle concentric arcs
# =============================================================================
ripple_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
rd = ImageDraw.Draw(ripple_layer)

# Left — clean water ripples (healthy teal)
for (rx, ry) in [(200, 800), (350, 720), (500, 880), (650, 760), (100, 940),
                  (420, 640), (280, 960)]:
    if rx > SPLIT_X - 80:
        continue
    for rad in range(10, 60, 14):
        alpha = max(0, 55 - rad * 0.6)
        rd.arc([rx - rad, ry - rad // 3, rx + rad, ry + rad // 3],
               start=200, end=340, fill=(*WATER_HI, int(alpha)), width=2)

# Right — stagnant bubbles / disturbed scum
for (rx, ry) in [(1050, 780), (1200, 700), (1380, 850), (1480, 760),
                  (900, 900), (1100, 960), (1350, 700), (1520, 920)]:
    if rx < SPLIT_X + 30:
        continue
    for rad in range(6, 30, 8):
        alpha = max(0, 40 - rad * 0.8)
        rd.ellipse([rx - rad, ry - rad // 2, rx + rad, ry + rad // 2],
                   outline=(*TOXIC_HI, int(alpha)), width=1)

ripple_layer = ripple_layer.filter(ImageFilter.GaussianBlur(1.5))
base.alpha_composite(ripple_layer)


# =============================================================================
# LAYER 6: Props from assets/images/
# =============================================================================
props = {n: load_prop(f"prop_{n}.png")
         for n in ("tree", "bush", "reeds", "rock", "flowers", "lilypad", "stump", "grass")}

# Healthy side — lush scatter
healthy_scatter = [
    ("tree",    160, 760, 2.2), ("tree",    420, 680, 1.9), ("tree",     60, 860, 1.7),
    ("bush",    280, 810, 1.6), ("bush",    540, 760, 1.4), ("bush",    680, 820, 1.3),
    ("reeds",   350, 870, 1.6), ("reeds",   580, 840, 1.4), ("reeds",   220, 940, 1.5),
    ("flowers", 310, 920, 1.5), ("flowers", 480, 890, 1.3), ("flowers", 100, 790, 1.4),
    ("grass",   200, 870, 1.8), ("grass",   460, 940, 1.7), ("grass",    70, 940, 1.6),
    ("lilypad", 620, 880, 1.4), ("lilypad", 140, 940, 1.3), ("lilypad", 380, 960, 1.2),
    ("rock",    500, 830, 1.3), ("rock",    240, 780, 1.2),
]
for n, x, y, s in healthy_scatter:
    if x < SPLIT_X - 40:
        paste_prop(base, props[n], x, y, s)

# Toxic side — sickened, sparse
toxic_scatter = [
    ("stump",  1050, 780, 1.7), ("stump",  1350, 820, 1.5), ("stump",  1500, 760, 1.4),
    ("rock",    980, 860, 1.4), ("rock",   1200, 740, 1.3), ("rock",   1450, 880, 1.3),
    ("reeds",  1150, 870, 1.3), ("reeds",  1400, 760, 1.2), ("reeds",  1550, 830, 1.1),
    ("grass",  1080, 940, 1.4), ("grass",  1300, 900, 1.3), ("grass",  1520, 950, 1.2),
    ("bush",   1250, 810, 1.2), ("lilypad",1100, 940, 1.3),
]
for n, x, y, s in toxic_scatter:
    if x > SPLIT_X + 40:
        paste_prop(base, sicken(props[n], 0.80), x, y, s)


# =============================================================================
# LAYER 7: Painted Stork — wading in the healthy half
# =============================================================================
# Drawn entirely in Pillow: top-down view, white body, black wing tips, red crown, coral beak
def draw_stork(base, cx, cy, scale=1.0):
    s  = scale
    d2 = ImageDraw.Draw(base)

    def sc(v): return v * s

    # Shadow under bird
    shadow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    shd = ImageDraw.Draw(shadow)
    shd.ellipse([cx - sc(38), cy - sc(20), cx + sc(38), cy + sc(20)],
                fill=(4, 8, 4, 70))
    shadow = shadow.filter(ImageFilter.GaussianBlur(6))
    base.alpha_composite(shadow)

    # Body — white, slightly cream, top-down oval
    body_pts = blob_pts(cx, cy, sc(30), sc(18),
                        [(3, 0.8, 0.8), (5, 2.0, 0.5)], variation=0.10)
    d2.polygon(body_pts, fill=(235, 238, 230, 245))

    # Wing tips — dark black-green
    for side in [-1, 1]:
        wing_pts = blob_pts(cx + sc(side * 24), cy + sc(4), sc(14), sc(9),
                            [(4, 1.2, 0.8), (6, 2.8, 0.5)], variation=0.15)
        d2.polygon(wing_pts, fill=( 28,  36,  28, 240))
        # Wing specular
        circle(d2, cx + sc(side * 26), cy + sc(2), sc(4),
               (60, 72, 60, 120))

    # Body highlight (top-left light source)
    circle(d2, cx - sc(8), cy - sc(5), sc(10), (248, 250, 245, 120))

    # Neck — thin white tube going forward-left (bird faces left)
    neck_cx = cx - sc(22)
    neck_cy = cy - sc(8)
    d2.ellipse([neck_cx - sc(8), neck_cy - sc(5),
                neck_cx + sc(8), neck_cy + sc(5)], fill=(232, 235, 228, 240))

    # Head — rounded
    head_cx = cx - sc(34)
    head_cy = cy - sc(10)
    circle(d2, head_cx, head_cy, sc(9), (228, 232, 220, 245))

    # Red-orange crown patch
    circle(d2, head_cx, head_cy - sc(4), sc(5), (198, 60, 38, 220))
    circle(d2, head_cx, head_cy - sc(4), sc(3), (230, 90, 50, 200))

    # Long decurved beak — coral/orange, pointing left
    beak_pts = [
        (head_cx - sc(3),  head_cy - sc(1)),
        (head_cx - sc(28), head_cy + sc(3)),
        (head_cx - sc(26), head_cy + sc(5)),
        (head_cx - sc(3),  head_cy + sc(3)),
    ]
    d2.polygon(beak_pts, fill=(210, 130, 42, 240))
    # beak tip
    circle(d2, head_cx - sc(28), head_cy + sc(3), sc(2), (190, 100, 30, 240))

    # Eye — dark dot
    circle(d2, head_cx - sc(3), head_cy - sc(1), sc(2), ( 20,  18,  14, 240))
    circle(d2, head_cx - sc(3), head_cy - sc(1), sc(1), (240, 240, 220, 180))

    # Legs — two thin sticks going down into water
    for lx_off in [-6, 6]:
        lx = cx + sc(lx_off)
        d2.line([(lx, cy + sc(14)), (lx + sc(lx_off * 0.5), cy + sc(34))],
                fill=(160, 120, 60, 200), width=max(1, int(sc(2))))
        # Foot splays
        for toe_a in [-35, 0, 35]:
            a   = math.radians(90 + toe_a)
            tl  = sc(10)
            tx2 = lx + sc(lx_off * 0.5) + math.cos(a) * tl
            ty2 = cy + sc(34) + math.sin(a) * tl
            d2.line([(lx + sc(lx_off * 0.5), cy + sc(34)), (tx2, ty2)],
                    fill=(155, 112, 48, 190), width=max(1, int(sc(1.5))))


draw_stork(base, cx=320, cy=730, scale=1.6)


# =============================================================================
# LAYER 8: Runoff outfall pipe — right half
# =============================================================================
def draw_outfall(base, cx, cy, scale=1.0):
    s  = scale
    def sc(v): return v * s
    d2 = ImageDraw.Draw(base)

    # Concrete pipe body — rectangular, dark grey
    pw, ph = int(sc(60)), int(sc(28))
    pipe_pts = [
        (cx - pw,     cy - ph // 2),
        (cx + pw // 4, cy - ph // 2),
        (cx + pw // 4, cy + ph // 2),
        (cx - pw,     cy + ph // 2),
    ]
    d2.polygon(pipe_pts, fill=(72, 68, 58, 255))
    # Pipe shading / highlight
    d2.polygon([(cx - pw, cy - ph // 2),
                (cx + pw // 4, cy - ph // 2),
                (cx + pw // 4, cy - ph // 2 + 6),
                (cx - pw, cy - ph // 2 + 6)],
               fill=(100, 96, 82, 200))

    # Pipe mouth — dark opening circle
    d2.ellipse([cx + pw // 4 - ph // 2, cy - ph // 2,
                cx + pw // 4 + ph // 2, cy + ph // 2],
               fill=(36, 30, 18, 255))
    d2.ellipse([cx + pw // 4 - ph // 2 + 4, cy - ph // 2 + 4,
                cx + pw // 4 + ph // 2 - 4, cy + ph // 2 - 4],
               fill=(52, 42, 22, 240))

    # Effluent discharge plume — sickly yellow-brown flowing outward
    plume_cx = cx + pw // 4 + sc(10)
    for r in range(int(sc(80)), 0, -int(sc(10))):
        alpha = max(0, 80 - r * 0.7)
        col   = lerpc(ALGAE, TOXIC, r / sc(80))
        d2.ellipse([plume_cx - r, cy - r // 3, plume_cx + r, cy + r // 3],
                   fill=(*col, int(alpha)))

    # Foam / bubbles at mouth
    for bx, by, br in [
        (plume_cx + sc(5),  cy,          sc(4)),
        (plume_cx + sc(12), cy - sc(6),  sc(3)),
        (plume_cx + sc(18), cy + sc(4),  sc(3.5)),
        (plume_cx + sc(8),  cy + sc(8),  sc(2.5)),
        (plume_cx + sc(22), cy - sc(2),  sc(2)),
    ]:
        circle(d2, bx, by, br, (165, 158, 112, 180))
        circle(d2, bx - sc(0.8), by - sc(0.8), max(1, br - sc(1)), (200, 195, 150, 100))

draw_outfall(base, cx=1340, cy=680, scale=1.4)


# =============================================================================
# LAYER 9: Field agent figure at the boundary
# =============================================================================
def draw_agent(base, cx, cy, scale=1.0):
    s  = scale
    d2 = ImageDraw.Draw(base)

    # Shadow
    shadow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    shd = ImageDraw.Draw(shadow)
    shd.ellipse([cx - s*20, cy - s*8, cx + s*20, cy + s*8], fill=(4, 8, 4, 90))
    shadow = shadow.filter(ImageFilter.GaussianBlur(5))
    base.alpha_composite(shadow)

    # Body — olive jacket (land colour), top-down view
    body_pts = blob_pts(cx, cy, s*14, s*10,
                        [(3, 0.6, 0.6), (5, 1.8, 0.4)], variation=0.10)
    d2.polygon(body_pts, fill=(*LAND, 250))
    # Jacket highlight
    circle(d2, cx - s*4, cy - s*3, s*6, (*LAND_SH, 0))
    d2.ellipse([cx - s*10, cy - s*7, cx + s*2, cy + s*1], fill=(*LAND, 180))
    circle(d2, cx - s*5, cy - s*4, s*5, (108, 128, 84, 120))

    # Backpack — dark green, small rect behind body
    d2.ellipse([cx + s*4, cy - s*6, cx + s*14, cy + s*6], fill=(38, 52, 34, 240))
    d2.ellipse([cx + s*5, cy - s*5, cx + s*13, cy + s*5], fill=(52, 68, 44, 200))

    # Head — skin tone circle
    circle(d2, cx - s*2, cy - s*12, s*7, (188, 148, 102, 245))
    # Hair
    d2.ellipse([cx - s*8, cy - s*18, cx + s*4, cy - s*8], fill=(42, 28, 14, 220))
    # Face highlight
    circle(d2, cx - s*4, cy - s*13, s*3, (208, 172, 128, 130))

    # Scanner device — gold, held in front
    scanner_cx = cx - s*14
    scanner_cy = cy - s*2
    d2.rectangle([scanner_cx - s*7, scanner_cy - s*4,
                  scanner_cx + s*7, scanner_cy + s*4],
                 fill=(*GOLD, 230))
    # Scanner lens
    circle(d2, scanner_cx, scanner_cy, s*3, (30, 30, 40, 240))
    circle(d2, scanner_cx, scanner_cy, s*1.5, WATER_HI + (200,))
    # Gold highlight on scanner edge
    d2.rectangle([scanner_cx - s*7, scanner_cy - s*4,
                  scanner_cx + s*7, scanner_cy - s*2],
                 fill=(*GOLD_HI, 150))

    # Scan beam — faint teal cone projecting left
    beam = Image.new("RGBA", base.size, (0, 0, 0, 0))
    bd   = ImageDraw.Draw(beam)
    for offset, alpha in [(-3, 15), (-1, 35), (0, 55), (1, 35), (3, 15)]:
        bd.line([(scanner_cx - s*7, scanner_cy + offset),
                 (scanner_cx - s*80, scanner_cy + offset * 4)],
                fill=(*HEALTHY_HI, alpha), width=max(1, int(s * 2)))
    beam = beam.filter(ImageFilter.GaussianBlur(3))
    base.alpha_composite(beam)

    # Arms/hands suggestion — small ovals
    for arm_x, arm_y in [(cx - s*12, cy + s*4), (cx + s*10, cy + s*2)]:
        circle(d2, arm_x, arm_y, s*4, (*LAND, 200))

    # Legs — two small ovals below
    for leg_off in [-6, 6]:
        circle(d2, cx + leg_off * s, cy + s*14, s*5, (52, 44, 32, 220))
        circle(d2, cx + leg_off * s, cy + s*20, s*4, (32, 26, 18, 200))


draw_agent(base, cx=SPLIT_X, cy=820, scale=1.8)


# =============================================================================
# LAYER 10: Diagonal boundary — soft glowing split line
# =============================================================================
boundary = Image.new("RGBA", (W, H), (0, 0, 0, 0))
bd = ImageDraw.Draw(boundary)

# The boundary follows a gentle S-curve from top to bottom
def boundary_x(y):
    # S-curve: subtle wave
    return SPLIT_X + int(55 * math.sin(y * 0.006 + 0.8))

# Draw a soft glowing strip
for y in range(GROUND_Y, H):
    bx = boundary_x(y)
    # Gold glow core
    for off, alpha in [(-6, 15), (-3, 40), (-1, 70), (0, 100), (1, 70), (3, 40), (6, 15)]:
        c = lerpc(GOLD, HEALTHY_HI, 0.3)
        bd.point((bx + off, y), fill=(*c, alpha))

boundary = boundary.filter(ImageFilter.GaussianBlur(2.5))
base.alpha_composite(boundary)

# Mask right side: re-darken toxic zone with a gradient veil
toxic_veil = Image.new("RGBA", (W, H), (0, 0, 0, 0))
tvd = ImageDraw.Draw(toxic_veil)
for y in range(GROUND_Y, H):
    bx = boundary_x(y)
    for x in range(bx, W):
        depth = min(1.0, (x - bx) / 380)
        alpha = int(depth * 88)
        tvd.point((x, y), fill=(*TOXIC_SH, alpha))
toxic_veil = toxic_veil.filter(ImageFilter.GaussianBlur(12))
base.alpha_composite(toxic_veil)


# =============================================================================
# LAYER 11: Atmospheric horizon fog + vignette
# =============================================================================
fog = Image.new("RGBA", (W, H), (0, 0, 0, 0))
fd  = ImageDraw.Draw(fog)
fog_y = GROUND_Y
fog_h = 100
for y in range(fog_y, fog_y + fog_h):
    t     = (y - fog_y) / fog_h
    alpha = int(80 * (1 - t))
    # Left — healthy teal fog
    bx = boundary_x(y)
    fd.line([(0, y), (bx, y)], fill=(*HEALTHY, alpha))
    # Right — toxic brownish haze
    fd.line([(bx, y), (W, y)], fill=(*ALGAE, int(alpha * 0.7)))
fog = fog.filter(ImageFilter.GaussianBlur(4))
base.alpha_composite(fog)

# Vignette
vig = Image.new("L", (W, H), 0)
vd2 = ImageDraw.Draw(vig)
vd2.ellipse([-W * 0.2, -H * 0.2, W * 1.2, H * 1.2], fill=255)
vig = vig.filter(ImageFilter.GaussianBlur(200))
dark_vig = Image.new("RGBA", (W, H), (4, 6, 4, 255))
dark_vig.putalpha(Image.eval(vig, lambda v: 160 - int(v * 160 / 255)))
base.alpha_composite(dark_vig)


# =============================================================================
# LAYER 12: Title, subtitle, tagline, footer
# =============================================================================
dt = ImageDraw.Draw(base)

def centered_text(draw, text, fnt, y, fill, shadow_col=(0, 0, 0, 200), sh=5):
    tw  = draw.textlength(text, font=fnt)
    x   = (W - tw) / 2
    draw.text((x + sh, y + sh), text, font=fnt, fill=shadow_col)
    draw.text((x,      y),      text, font=fnt, fill=fill)


# Main title — ECOSYSTEM X
fn_title = font(136)
centered_text(dt, "ECOSYSTEM  X", fn_title, 72,
              fill=(*GOLD, 255), shadow_col=(0, 0, 0, 220), sh=7)

# Gold underline bar
tw_title = dt.textlength("ECOSYSTEM  X", font=fn_title)
ux = (W - tw_title) / 2
uy = 72 + 140
dt.rectangle([ux, uy, ux + tw_title, uy + 4], fill=(*GOLD, 200))

# Subtitle
fn_sub = font_reg(50)
centered_text(dt, "THE  LAST  BALANCE", fn_sub, 230,
              fill=(240, 234, 218, 255), sh=4)

# Tagline lines
fn_tag = font_reg(26)
centered_text(dt, "A coastal wetland is collapsing — uncover the hidden food web,",
              fn_tag, 302, fill=(185, 218, 195, 255), sh=2)
centered_text(dt, "find the root stressor and restore the balance before it's too late.",
              fn_tag, 336, fill=(185, 218, 195, 255), sh=2)

# Left label — HEALTHY
fn_lbl = font_reg(22)
dt.text((60, H - 80), "◆  PRISTINE ESTUARY", font=fn_lbl,
        fill=(*HEALTHY_HI, 210))
# Right label — TOXIC
tw_r = dt.textlength("TOXIC RUNOFF  ◆", font=fn_lbl)
dt.text((W - 60 - tw_r, H - 80), "TOXIC RUNOFF  ◆", font=fn_lbl,
        fill=(*DANGER, 210))

# Footer
fn_foot = font_reg(20)
footer  = "Track 1 · Biodiversity & Environmental Protection   |   #CodeBuddy #TencentCloudHackathon"
tw_f    = dt.textlength(footer, font=fn_foot)
dt.text(((W - tw_f) / 2 + 2, H - 44 + 2), footer, font=fn_foot,
        fill=(0, 0, 0, 190))
dt.text(((W - tw_f) / 2,     H - 44),     footer, font=fn_foot,
        fill=(128, 210, 222, 255))


# =============================================================================
# Save
# =============================================================================
out = os.path.join(IMG, "keyart.png")
base.convert("RGBA").save(out)
print(f"wrote  {out}  {base.size}")
