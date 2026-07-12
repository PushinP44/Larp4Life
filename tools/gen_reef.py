#!/usr/bin/env python3
"""
gen_reef.py — Deterministic Pillow placeholder art for the coral_reef biome.
Writes every reef PNG into assets/images/ and prints each path.
Running `python3 tools/gen_reef.py` is the only step needed.

Palette: turquoise #1a6e8b · sand #d8c89a · coral pink #e0748a · reef green #2a8b6b
         sediment brown #6b5a3a · bleached #cfc8b8 · toxic silt #5c4a1e
         accent gold #f0a500 · danger #c0392b
"""
import os, math, random
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

ROOT    = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG_DIR = os.path.join(ROOT, "assets", "images")
os.makedirs(IMG_DIR, exist_ok=True)

rng = random.Random(7)   # deterministic — fixed seed for all scatter/jitter

# ── Palette ───────────────────────────────────────────────────────────────────
TURQUOISE   = ( 26, 110, 139)
TURQUOISE_H = ( 55, 158, 188)
TURQUOISE_D = ( 12,  66,  88)
SAND        = (216, 200, 154)
SAND_H      = (240, 224, 185)
SAND_D      = (175, 156, 108)
CPINK       = (224, 116, 138)
CPINK_H     = (245, 158, 175)
CPINK_D     = (170,  75,  95)
RGREEN      = ( 42, 139, 107)
RGREEN_H    = ( 70, 185, 145)
RGREEN_D    = ( 22,  88,  66)
SEDBROWN    = (107,  90,  58)
SEDBROWN_H  = (145, 125,  85)
SEDBROWN_D  = ( 65,  52,  28)
BLEACHED    = (207, 200, 184)
BLEACHED_D  = (162, 154, 140)
TOXIC       = ( 92,  74,  30)
TOXIC_H     = (130, 108,  50)
TOXIC_D     = ( 52,  40,  12)
GOLD        = (240, 165,   0)
GOLD_H      = (255, 210,  70)
DANGER      = (192,  57,  43)
BLACK       = (  8,   8,  10)
WHITE       = (245, 248, 250)


# ── Shared helpers (matches gen_keyart / gen_player style) ────────────────────

def lerp(a, b, t):
    return a + (b - a) * t


def lerpc(ca, cb, t):
    return tuple(int(lerp(ca[i], cb[i], t)) for i in range(len(ca)))


def circle(d, cx, cy, r, fill, outline=None, ow=1):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill,
              outline=outline, width=ow)


def rrect(d, x0, y0, x1, y1, r, fill, outline=None, ow=1):
    d.rounded_rectangle([x0, y0, x1, y1], radius=r,
                        fill=fill, outline=outline, width=ow)


def poly(d, pts, fill, outline=None, ow=1):
    d.polygon(pts, fill=fill, outline=outline)


def drop_shadow(img, radius=6, offset=(3, 4), alpha=90):
    """Bake a soft drop-shadow into a copy of img (RGBA)."""
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    mask = img.split()[3]
    solid = Image.new("RGBA", img.size, (0, 0, 0, alpha))
    solid.putalpha(mask)
    ox, oy = offset
    canvas = Image.new("RGBA", img.size, (0, 0, 0, 0))
    canvas.alpha_composite(solid, (ox, oy))
    canvas = canvas.filter(ImageFilter.GaussianBlur(radius))
    canvas.alpha_composite(img)
    return canvas


def save(img, name):
    p = os.path.join(IMG_DIR, name)
    img.save(p)
    print(f"wrote  {p}  {img.size}")


def desaturate(img, amt=0.85):
    """Desaturate + darken + warm-silt tint — for toxic/extinct variants."""
    img = ImageEnhance.Color(img).enhance(1 - 0.85 * amt)
    img = ImageEnhance.Brightness(img).enhance(1 - 0.28 * amt)
    tint = Image.new("RGBA", img.size, (*TOXIC_H, int(55 * amt)))
    img = Image.alpha_composite(img, tint)
    return img


# =============================================================================
# 1.  TILES  128×128  opaque
# =============================================================================

def tile_reefwater():
    """Open turquoise water with faint caustic shimmer lines."""
    img = Image.new("RGBA", (128, 128), (*TURQUOISE_D, 255))
    d   = ImageDraw.Draw(img)
    # Gradient — lighter toward top-centre
    for y in range(128):
        t = y / 127
        c = lerpc(TURQUOISE_H, TURQUOISE_D, t * 0.7)
        d.line([(0, y), (127, y)], fill=(*c, 255))
    # Caustic arcs — deterministic
    r2 = random.Random(11)
    cl = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    cd = ImageDraw.Draw(cl)
    for _ in range(22):
        cx = r2.randint(4, 124)
        cy = r2.randint(4, 124)
        w  = r2.randint(8, 28)
        h  = r2.randint(3, 10)
        a  = r2.randint(20, 50)
        cd.arc([cx - w, cy - h, cx + w, cy + h],
               start=r2.randint(150, 210), end=r2.randint(330, 390),
               fill=(*TURQUOISE_H, a), width=1)
    cl = cl.filter(ImageFilter.GaussianBlur(0.8))
    img.alpha_composite(cl)
    return img


def tile_sand():
    """Pale rippled lagoon sand."""
    img = Image.new("RGBA", (128, 128), (*SAND_D, 255))
    d   = ImageDraw.Draw(img)
    for y in range(128):
        t = y / 127
        c = lerpc(SAND_H, SAND, t)
        d.line([(0, y), (127, y)], fill=(*c, 255))
    # Ripple lines
    r2 = random.Random(22)
    for i in range(14):
        y0   = r2.randint(0, 127)
        xoff = r2.randint(-10, 10)
        alpha = r2.randint(25, 55)
        col   = r2.choice([SAND_H, SAND_D])
        d.arc([xoff, y0 - 3, 128 + xoff, y0 + 3],
              start=0, end=180, fill=(*col, alpha), width=1)
    return img


def tile_reef():
    """Coral-rubble reef flat — pink/green speckle on pale base."""
    img = Image.new("RGBA", (128, 128), (*BLEACHED, 255))
    d   = ImageDraw.Draw(img)
    r2  = random.Random(33)
    # Base texture noise
    for _ in range(280):
        x  = r2.randint(0, 127)
        y  = r2.randint(0, 127)
        sz = r2.randint(2, 8)
        col = r2.choice([CPINK, CPINK_D, RGREEN, RGREEN_D, BLEACHED_D, SEDBROWN])
        alpha = r2.randint(80, 180)
        d.ellipse([x - sz, y - sz, x + sz, y + sz], fill=(*col, alpha))
    # A few larger rubble clumps
    for _ in range(18):
        x  = r2.randint(8, 120)
        y  = r2.randint(8, 120)
        rx = r2.randint(4, 12)
        ry = r2.randint(3, 8)
        col = r2.choice([CPINK_D, RGREEN_D, SEDBROWN])
        d.ellipse([x - rx, y - ry, x + rx, y + ry], fill=(*col, 140))
    return img


def tile_sediment():
    """Silt-choked murky brown water."""
    img = Image.new("RGBA", (128, 128), (*SEDBROWN_D, 255))
    d   = ImageDraw.Draw(img)
    for y in range(128):
        t = y / 127
        c = lerpc(SEDBROWN, SEDBROWN_D, t * 0.8)
        d.line([(0, y), (127, y)], fill=(*c, 255))
    # Turbidity swirls
    r2 = random.Random(44)
    sl = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sl)
    for _ in range(14):
        cx = r2.randint(10, 118)
        cy = r2.randint(10, 118)
        rx = r2.randint(10, 32)
        ry = r2.randint(5, 18)
        alpha = r2.randint(25, 60)
        sd.ellipse([cx - rx, cy - ry, cx + rx, cy + ry],
                   fill=(*SEDBROWN_H, alpha))
    sl = sl.filter(ImageFilter.GaussianBlur(3))
    img.alpha_composite(sl)
    return img


def make_tiles():
    healthy = {
        "tile_reefwater": tile_reefwater(),
        "tile_sand":      tile_sand(),
        "tile_reef":      tile_reef(),
        "tile_sediment":  tile_sediment(),
    }
    for name, img in healthy.items():
        save(img, f"{name}.png")
        tox = desaturate(img.copy(), amt=0.80)
        save(tox, f"{name}_toxic.png")


# =============================================================================
# 2.  SPECIES SPRITES  128×128  transparent + drop-shadow
# =============================================================================

def sprite_coral():
    """Branching/brain coral — living pink-green colony."""
    img = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    d   = ImageDraw.Draw(img)
    cx, cy = 64, 78

    # Brain-coral dome base
    d.ellipse([cx - 30, cy - 18, cx + 30, cy + 16], fill=(*CPINK, 230))
    d.ellipse([cx - 26, cy - 22, cx + 26, cy + 12], fill=(*CPINK_H, 200))
    # Surface grooves
    for ang in range(0, 180, 22):
        a = math.radians(ang)
        x1 = cx + int(math.cos(a) * 24)
        y1 = cy + int(math.sin(a) * 14) - 4
        x2 = cx + int(math.cos(a + math.pi) * 24)
        y2 = cy + int(math.sin(a + math.pi) * 14) - 4
        d.line([(x1, y1), (x2, y2)], fill=(*CPINK_D, 120), width=1)

    # Branching polyps — short stout fingers
    r2 = random.Random(101)
    branches = [
        (-20, -28, -14), (-8, -34, -10), (0, -36, -8),
        (12, -34, -10), (22, -28, -14), (-28, -14, -8),
        (28, -14, -8), (-16, -16, -22), (16, -16, -22),
    ]
    for bx, by, btop in branches:
        bw  = r2.randint(6, 10)
        col = r2.choice([CPINK, CPINK_H, RGREEN, RGREEN_H])
        # btop is the "top" offset (more negative = higher); ensure y0 <= y1
        y0  = cy + min(btop, by)
        y1  = cy + max(btop, by)
        d.ellipse([cx + bx - bw // 2, y0,
                   cx + bx + bw // 2, y1], fill=(*col, 220))
        # Polyp tip circle at the actual top
        tip_off = min(btop, by)
        tr = bw // 2 + 1
        d.ellipse([cx + bx - tr, cy + tip_off - tr,
                   cx + bx + tr, cy + tip_off + tr], fill=(*RGREEN_H, 200))

    # Algae coat on lower rim
    d.arc([cx - 32, cy - 4, cx + 32, cy + 20],
          start=0, end=180, fill=(*RGREEN, 160), width=3)
    return drop_shadow(img)


def sprite_parrotfish():
    """Teal parrotfish — top-down, beak visible, chunky body."""
    img = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    d   = ImageDraw.Draw(img)
    cx, cy = 64, 64

    PFISH   = ( 38, 148, 148)
    PFISH_H = ( 80, 195, 195)
    PFISH_D = ( 18,  90,  90)
    BEAK    = (220, 190,  60)

    # Body — elongated top-down oval
    d.ellipse([cx - 26, cy - 14, cx + 26, cy + 14], fill=(*PFISH, 240))
    # Highlight
    d.ellipse([cx - 18, cy - 10, cx + 8, cy + 0], fill=(*PFISH_H, 140))
    # Shadow flank
    d.ellipse([cx + 4, cy - 10, cx + 26, cy + 10], fill=(*PFISH_D, 120))

    # Scale pattern — small arcs
    r2 = random.Random(202)
    for _ in range(18):
        sx = r2.randint(cx - 22, cx + 18)
        sy = r2.randint(cy - 10, cy + 10)
        d.arc([sx - 4, sy - 3, sx + 4, sy + 3],
              start=0, end=180, fill=(*PFISH_D, 80), width=1)

    # Pectoral fins — side paddles
    poly(d, [(cx - 2, cy - 14), (cx - 12, cy - 24), (cx + 6, cy - 20),
             (cx + 8, cy - 12)], (*PFISH_D, 200))
    poly(d, [(cx - 2, cy + 14), (cx - 12, cy + 24), (cx + 6, cy + 20),
             (cx + 8, cy + 12)], (*PFISH_D, 200))

    # Tail fin
    poly(d, [(cx + 24, cy - 16), (cx + 38, cy - 6), (cx + 40, cy + 6),
             (cx + 24, cy + 16)], (*PFISH_D, 220))
    poly(d, [(cx + 24, cy - 12), (cx + 34, cy - 4), (cx + 34, cy + 4),
             (cx + 24, cy + 12)], (*PFISH, 200))

    # Dorsal fin strip
    poly(d, [(cx - 18, cy - 14), (cx - 6, cy - 18), (cx + 14, cy - 16),
             (cx + 14, cy - 12), (cx - 6, cy - 14), (cx - 18, cy - 11)],
         (*PFISH_D, 180))

    # Parrot beak — fused teeth, pale yellow-green
    poly(d, [(cx - 32, cy - 5), (cx - 26, cy - 8),
             (cx - 22, cy + 0), (cx - 26, cy + 8), (cx - 32, cy + 5)],
         (*BEAK, 240))
    circle(d, cx - 27, cy - 3, 3, (*BEAK, 180))

    # Eye
    circle(d, cx - 18, cy - 5, 4, (10, 10, 14, 240))
    circle(d, cx - 19, cy - 6, 2, (220, 240, 240, 160))

    # Colour stripe — magenta blush
    poly(d, [(cx - 10, cy - 8), (cx + 16, cy - 8),
             (cx + 14, cy - 5), (cx - 10, cy - 5)],
         (200, 80, 120, 70))
    return drop_shadow(img)


def sprite_urchin():
    """Black long-spined sea urchin — top-down radiating spines."""
    img = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    d   = ImageDraw.Draw(img)
    cx, cy = 64, 64

    URCH_BODY = ( 22,  18,  22)
    URCH_RING = ( 55,  42,  62)
    SPINE_C   = ( 14,  10,  14)
    SPINE_H   = ( 85,  70,  95)
    URCH_EYE  = (180, 155, 200)

    # Spines — long radiating lines first (below body)
    spine_layer = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    sd = ImageDraw.Draw(spine_layer)
    n_spines = 28
    for i in range(n_spines):
        ang  = 2 * math.pi * i / n_spines
        l    = 26 + (i % 3) * 4
        tip_x = cx + int(math.cos(ang) * l)
        tip_y = cy + int(math.sin(ang) * l)
        base_x = cx + int(math.cos(ang) * 11)
        base_y = cy + int(math.sin(ang) * 11)
        sd.line([(base_x, base_y), (tip_x, tip_y)],
                fill=(*SPINE_C, 230), width=2)
        # Spine highlight line
        hx = cx + int(math.cos(ang - 0.05) * l * 0.85)
        hy = cy + int(math.sin(ang - 0.05) * l * 0.85)
        sd.line([(base_x, base_y), (hx, hy)],
                fill=(*SPINE_H, 80), width=1)
    img.alpha_composite(spine_layer)
    d = ImageDraw.Draw(img)

    # Body dome
    circle(d, cx, cy, 13, (*URCH_BODY, 250))
    circle(d, cx, cy, 10, (*URCH_RING, 180))
    # Ambulacral groove pattern (5-way symmetry)
    for i in range(5):
        ang = 2 * math.pi * i / 5
        gx  = cx + int(math.cos(ang) * 6)
        gy  = cy + int(math.sin(ang) * 6)
        d.line([(cx, cy), (gx, gy)], fill=(*SPINE_C, 120), width=1)
    # Apical disc (top)
    circle(d, cx, cy, 3, (*URCH_EYE, 200))
    circle(d, cx, cy, 1, (240, 240, 255, 240))

    return drop_shadow(img, radius=5, offset=(2, 3), alpha=70)


def sprite_shark():
    """Blacktip reef shark — top-down, grey body, black fin tips."""
    img = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    d   = ImageDraw.Draw(img)
    cx, cy = 64, 64

    SGREY   = (110, 118, 122)
    SGREY_H = (158, 168, 172)
    SGREY_D = ( 62,  70,  76)
    BELLY   = (225, 228, 225)
    FINTIP  = ( 14,  14,  16)

    # Torpedo body — very elongated ellipse
    d.ellipse([cx - 42, cy - 12, cx + 42, cy + 12], fill=(*SGREY, 240))
    # Belly stripe
    d.ellipse([cx - 30, cy - 6, cx + 36, cy + 6], fill=(*BELLY, 160))
    # Dorsal highlight
    d.ellipse([cx - 30, cy - 11, cx + 10, cy - 3], fill=(*SGREY_H, 130))

    # Dorsal fin — tall triangle offset toward head
    poly(d, [(cx - 12, cy - 12), (cx + 2, cy - 30), (cx + 14, cy - 12)],
         (*SGREY, 240))
    poly(d, [(cx - 2,  cy - 12), (cx + 2, cy - 30), (cx + 14, cy - 12)],
         (*SGREY_D, 160))
    # Dorsal fin tip — black
    poly(d, [(cx - 2,  cy - 12), (cx + 2, cy - 30), (cx + 10, cy - 16)],
         (*FINTIP, 220))

    # Pectoral fins — swept back
    poly(d, [(cx - 22, cy - 6), (cx - 38, cy - 26), (cx - 4, cy - 6)],
         (*SGREY_D, 220))
    poly(d, [(cx - 22, cy + 6), (cx - 38, cy + 26), (cx - 4, cy + 6)],
         (*SGREY_D, 220))
    # Pectoral fin tips — black
    poly(d, [(cx - 32, cy - 24), (cx - 38, cy - 26), (cx - 28, cy - 18)],
         (*FINTIP, 210))
    poly(d, [(cx - 32, cy + 24), (cx - 38, cy + 26), (cx - 28, cy + 18)],
         (*FINTIP, 210))

    # Caudal (tail) fin — lunate
    poly(d, [(cx + 40, cy), (cx + 52, cy - 22), (cx + 56, cy - 8),
             (cx + 44, cy)], (*SGREY_D, 230))
    poly(d, [(cx + 40, cy), (cx + 52, cy + 22), (cx + 56, cy + 8),
             (cx + 44, cy)], (*SGREY_D, 230))
    # Tail tips — black
    poly(d, [(cx + 50, cy - 18), (cx + 52, cy - 22), (cx + 56, cy - 8),
             (cx + 52, cy - 12)], (*FINTIP, 210))
    poly(d, [(cx + 50, cy + 18), (cx + 52, cy + 22), (cx + 56, cy + 8),
             (cx + 52, cy + 12)], (*FINTIP, 210))

    # Snout
    poly(d, [(cx + 38, cy - 8), (cx + 52, cy), (cx + 38, cy + 8)],
         (*SGREY, 240))
    circle(d, cx + 44, cy, 4, (*SGREY_H, 180))

    # Eye
    circle(d, cx + 18, cy - 7, 3, (12, 12, 14, 240))
    circle(d, cx + 17, cy - 8, 1, (200, 210, 215, 160))

    return drop_shadow(img)


def sprite_sediment_plume():
    """Murky silt plume — the pollution SOURCE marker."""
    img = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    d   = ImageDraw.Draw(img)
    cx, cy = 64, 88

    r2 = random.Random(505)
    # Rising plume clouds
    for layer, (lx, ly, rx, ry, a) in enumerate([
        (64, 88, 26, 18, 200),
        (58, 68, 22, 16, 170),
        (70, 50, 18, 14, 140),
        (62, 34, 14, 12, 110),
        (66, 22, 10,  9,  80),
        (64, 12,  7,  6,  55),
    ]):
        jx = r2.randint(-4, 4)
        jy = r2.randint(-3, 3)
        col = lerpc(SEDBROWN, TOXIC, layer / 6)
        d.ellipse([lx + jx - rx, ly + jy - ry,
                   lx + jx + rx, ly + jy + ry],
                  fill=(*col, a))

    # Silt particles
    for _ in range(30):
        px = r2.randint(38, 90)
        py = r2.randint(14, 90)
        r  = r2.randint(1, 3)
        circle(d, px, py, r, (*SEDBROWN_H, r2.randint(50, 120)))

    # Source base — dark sediment pool
    d.ellipse([cx - 22, cy - 8, cx + 22, cy + 8], fill=(*SEDBROWN_D, 210))
    d.ellipse([cx - 14, cy - 5, cx + 14, cy + 5], fill=(*TOXIC_D, 180))

    pl = img.filter(ImageFilter.GaussianBlur(1.2))
    return drop_shadow(pl, radius=4, offset=(2, 3), alpha=60)


def extinct_variant(img):
    """Skeletal / collapsed variant — heavy desaturation + fade."""
    img = ImageEnhance.Color(img).enhance(0.12)
    img = ImageEnhance.Brightness(img).enhance(0.75)
    tint = Image.new("RGBA", img.size, (*BLEACHED, 45))
    img = Image.alpha_composite(img, tint)
    return img


def make_species():
    living = {
        "sprite_coral":      sprite_coral(),
        "sprite_parrotfish": sprite_parrotfish(),
        "sprite_urchin":     sprite_urchin(),
        "sprite_shark":      sprite_shark(),
        "sprite_sediment":   sprite_sediment_plume(),
    }
    extinct_needed = {"sprite_coral", "sprite_parrotfish", "sprite_shark"}
    for name, img in living.items():
        save(img, f"{name}.png")
        if name in extinct_needed:
            save(extinct_variant(img), f"{name}_extinct.png")


# =============================================================================
# 3.  INVASIVE SPRITES  128×128  transparent
# =============================================================================

def sprite_lionfish():
    """Red-and-white striped lionfish — fanned venomous spines, reads as invader."""
    img = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    d   = ImageDraw.Draw(img)
    cx, cy = 64, 72

    LION_R  = (195,  52,  42)
    LION_W  = (235, 228, 218)
    LION_D  = (120,  28,  18)
    SPIN_C  = (190,  48,  38)
    SPIN_H  = (235, 160, 140)
    FIN_MEM = (200,  80,  70, 120)

    # Fan dorsal spines — radiate upward
    n_spines = 13
    for i in range(n_spines):
        t = i / (n_spines - 1)
        base_x = cx - 22 + int(t * 44)
        ang    = math.radians(lerp(108, 72, t))
        length = lerp(28, 42, abs(t - 0.5) * 2)
        tip_x  = base_x + int(math.cos(ang) * length)
        tip_y  = (cy - 12) + int(math.sin(ang) * length)
        # Membrane between spines (semi-transparent fill)
        if i > 0:
            prev_base = (cx - 22 + int((i - 1) / (n_spines - 1) * 44), cy - 12)
            prev_tip  = (prev_base[0] + int(math.cos(math.radians(lerp(108, 72, (i-1)/(n_spines-1))))
                         * lerp(28, 42, abs((i-1)/(n_spines-1) - 0.5) * 2)),
                         prev_base[1] + int(math.sin(math.radians(lerp(108, 72, (i-1)/(n_spines-1))))
                         * lerp(28, 42, abs((i-1)/(n_spines-1) - 0.5) * 2)))
            poly(d, [prev_base, prev_tip, (tip_x, tip_y), (base_x, cy - 12)],
                 FIN_MEM)
        d.line([(base_x, cy - 12), (tip_x, tip_y)],
               fill=(*SPIN_C, 220), width=2)
        circle(d, tip_x, tip_y, 2, (*SPIN_H, 200))

    # Pectoral fan fins — swept wide, left and right
    for side, start_a, end_a in [(-1, 150, 240), (1, -60, 30)]:
        fan_cx = cx + side * 24
        fan_cy = cy + 4
        n_rays = 8
        for j in range(n_rays):
            t2    = j / (n_rays - 1)
            ang2  = math.radians(lerp(start_a, end_a, t2))
            rlen  = lerp(16, 26, 1 - abs(t2 - 0.5) * 2)
            ex    = fan_cx + int(math.cos(ang2) * rlen)
            ey    = fan_cy + int(math.sin(ang2) * rlen)
            if j > 0:
                prev_ang = math.radians(lerp(start_a, end_a, (j-1)/(n_rays-1)))
                prev_rlen = lerp(16, 26, 1 - abs((j-1)/(n_rays-1) - 0.5) * 2)
                px2 = fan_cx + int(math.cos(prev_ang) * prev_rlen)
                py2 = fan_cy + int(math.sin(prev_ang) * prev_rlen)
                poly(d, [(fan_cx, fan_cy), (px2, py2), (ex, ey)], FIN_MEM)
            d.line([(fan_cx, fan_cy), (ex, ey)], fill=(*SPIN_C, 180), width=2)

    # Body — stout, striped
    d.ellipse([cx - 24, cy - 10, cx + 24, cy + 12], fill=(*LION_W, 235))
    # Red stripes
    stripe_xs = [-18, -10, -2, 6, 14]
    for sx in stripe_xs:
        d.ellipse([cx + sx - 3, cy - 10, cx + sx + 3, cy + 12],
                  fill=(*LION_R, 180))
    d.ellipse([cx - 24, cy - 10, cx + 24, cy + 12], outline=(*LION_D, 180), width=1)
    # Body highlight
    d.ellipse([cx - 16, cy - 8, cx + 4, cy - 2], fill=(245, 240, 235, 80))

    # Head — wider
    poly(d, [(cx - 30, cy - 8), (cx - 24, cy - 10),
             (cx - 24, cy + 12), (cx - 30, cy + 10)],
         (*LION_W, 230))
    for sx in [-28, -26]:
        d.ellipse([cx + sx - 2, cy - 8, cx + sx + 2, cy + 10],
                  fill=(*LION_R, 160))

    # Snout + mouth
    poly(d, [(cx - 36, cy - 4), (cx - 28, cy - 7),
             (cx - 28, cy + 9), (cx - 36, cy + 6)],
         (*LION_D, 220))
    d.line([(cx - 38, cy + 1), (cx - 28, cy + 1)],
           fill=(30, 10, 10, 160), width=1)

    # Eye
    circle(d, cx - 27, cy - 2, 4, (18, 14, 14, 245))
    circle(d, cx - 28, cy - 3, 2, (210, 215, 220, 160))

    # Tail fin
    poly(d, [(cx + 22, cy - 10), (cx + 36, cy - 18),
             (cx + 40, cy + 0), (cx + 36, cy + 20), (cx + 22, cy + 12)],
         (*LION_D, 220))
    for ty in [cy - 8, cy - 2, cy + 6]:
        d.line([(cx + 22, ty), (cx + 38, ty)],
               fill=(*LION_R, 100), width=1)

    # Subopercular spines
    for spine_y in [cy + 6, cy + 10]:
        d.line([(cx - 24, spine_y), (cx - 34, spine_y + 6)],
               fill=(*SPIN_C, 180), width=2)

    return drop_shadow(img)


def sprite_tilapia():
    """Drab grey tilapia — wetland invasive symmetry fish."""
    img = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    d   = ImageDraw.Draw(img)
    cx, cy = 64, 64

    TILAPIA   = (130, 135, 130)
    TILAPIA_H = (175, 182, 175)
    TILAPIA_D = ( 78,  82,  78)
    BELLY_T   = (195, 198, 190)
    FIN_T     = ( 90,  96,  90)

    # Body
    d.ellipse([cx - 32, cy - 14, cx + 32, cy + 14], fill=(*TILAPIA, 240))
    d.ellipse([cx - 22, cy - 10, cx + 28, cy + 10], fill=(*BELLY_T, 120))
    d.ellipse([cx - 22, cy - 13, cx + 8, cy - 4], fill=(*TILAPIA_H, 100))

    # Vertical bar markings
    r2 = random.Random(303)
    for bx in [-14, -4, 6, 16]:
        d.ellipse([cx + bx - 3, cy - 12, cx + bx + 3, cy + 12],
                  fill=(*TILAPIA_D, 60))

    # Dorsal fin — long spiny ridge
    pts_dorsal = [(cx - 24, cy - 14)]
    for xi in range(-24, 22, 4):
        h = r2.randint(12, 22)
        pts_dorsal.append((cx + xi, cy - 14 - h))
    pts_dorsal += [(cx + 20, cy - 14)]
    poly(d, pts_dorsal, (*FIN_T, 200))
    d.line(pts_dorsal, fill=(*TILAPIA_D, 160), width=1)

    # Anal fin
    poly(d, [(cx - 6, cy + 14), (cx + 2, cy + 26),
             (cx + 16, cy + 14)], (*FIN_T, 180))

    # Pectoral fins
    poly(d, [(cx - 14, cy - 8), (cx - 26, cy - 20), (cx - 6, cy - 8)],
         (*TILAPIA_D, 180))
    poly(d, [(cx - 14, cy + 8), (cx - 26, cy + 20), (cx - 6, cy + 8)],
         (*TILAPIA_D, 180))

    # Tail fin
    poly(d, [(cx + 30, cy - 14), (cx + 44, cy - 22),
             (cx + 46, cy + 0), (cx + 44, cy + 22), (cx + 30, cy + 14)],
         (*FIN_T, 220))

    # Head / operculum
    d.ellipse([cx - 38, cy - 12, cx - 18, cy + 12], fill=(*TILAPIA, 230))
    d.arc([cx - 36, cy - 10, cx - 20, cy + 10],
          start=60, end=300, fill=(*TILAPIA_D, 120), width=2)

    # Snout
    poly(d, [(cx - 44, cy - 5), (cx - 36, cy - 8),
             (cx - 36, cy + 8), (cx - 44, cy + 5)],
         (*TILAPIA_D, 220))
    d.line([(cx - 46, cy + 0), (cx - 36, cy + 0)],
           fill=(30, 30, 28, 150), width=1)

    # Eye
    circle(d, cx - 30, cy - 3, 4, (18, 18, 16, 245))
    circle(d, cx - 31, cy - 4, 2, (200, 205, 200, 160))

    return drop_shadow(img)


def make_invasive():
    for name, img in [("sprite_lionfish", sprite_lionfish()),
                      ("sprite_tilapia",  sprite_tilapia())]:
        save(img, f"{name}.png")


# =============================================================================
# 4.  DECORATIVE PROPS  transparent + drop-shadow
# =============================================================================

def prop_coral(size=96):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d   = ImageDraw.Draw(img)
    cx, cy = size // 2, size * 3 // 4
    r2 = random.Random(401)

    # Main branches — 5 thick arms from base
    for i in range(5):
        ang = math.radians(-90 + (i - 2) * 28)
        for seg in range(4):
            bx = cx + int(math.cos(ang) * seg * 9)
            by = cy + int(math.sin(ang) * seg * 9)
            ex = cx + int(math.cos(ang) * (seg + 1) * 9)
            ey = cy + int(math.sin(ang) * (seg + 1) * 9)
            w  = max(2, 7 - seg * 1)
            col = lerpc(CPINK, RGREEN, i / 4)
            d.line([(bx, by), (ex, ey)], fill=(*col, 220), width=w)
        # Tip polyp circle
        tip_x = cx + int(math.cos(ang) * 36)
        tip_y = cy + int(math.sin(ang) * 36)
        tr = r2.randint(3, 5)
        d.ellipse([tip_x - tr, tip_y - tr, tip_x + tr, tip_y + tr],
                  fill=(*RGREEN_H, 210))

    # Base mass
    d.ellipse([cx - 10, cy - 6, cx + 10, cy + 8], fill=(*CPINK_D, 200))
    return drop_shadow(img, radius=5, offset=(3, 4), alpha=75)


def prop_coralhead(size=64):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d   = ImageDraw.Draw(img)
    cx, cy = size // 2, size * 3 // 5
    r2 = random.Random(402)

    # Rounded dome
    d.ellipse([cx - 18, cy - 12, cx + 18, cy + 10], fill=(*CPINK, 230))
    d.ellipse([cx - 14, cy - 16, cx + 14, cy + 6], fill=(*CPINK_H, 180))
    # Grooves
    for a in range(0, 180, 30):
        ang = math.radians(a)
        d.line([(cx + int(math.cos(ang) * 16), cy + int(math.sin(ang) * 9) - 2),
                (cx + int(math.cos(ang + math.pi) * 16), cy + int(math.sin(ang + math.pi) * 9) - 2)],
               fill=(*CPINK_D, 100), width=1)
    # Green algae patches
    for _ in range(6):
        gx = r2.randint(cx - 14, cx + 14)
        gy = r2.randint(cy - 12, cy + 6)
        circle(d, gx, gy, r2.randint(2, 4), (*RGREEN, 140))
    return drop_shadow(img, radius=4, offset=(2, 3), alpha=70)


def prop_anemone(size=64):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d   = ImageDraw.Draw(img)
    cx, cy = size // 2, size * 3 // 4
    r2 = random.Random(403)

    # Tentacles — curved upward strands
    n = 14
    for i in range(n):
        t    = i / (n - 1)
        bx   = cx - 12 + int(t * 24)
        ang  = math.radians(-90 + r2.randint(-20, 20))
        length = r2.randint(16, 26)
        ex   = bx + int(math.cos(ang) * length)
        ey   = cy + int(math.sin(ang) * length)
        col  = lerpc(CPINK_H, RGREEN_H, t)
        d.line([(bx, cy), (ex, ey)], fill=(*col, 210), width=2)
        # Bulb tip
        circle(d, ex, ey, r2.randint(2, 4), (*CPINK_H, 220))

    # Column base
    d.ellipse([cx - 10, cy - 4, cx + 10, cy + 8], fill=(*CPINK_D, 200))
    d.ellipse([cx - 6,  cy - 2, cx + 6,  cy + 6], fill=(*CPINK, 180))
    return drop_shadow(img, radius=4, offset=(2, 3), alpha=65)


def prop_kelp(size=64):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d   = ImageDraw.Draw(img)
    cx, cy = size // 2, size - 4
    r2 = random.Random(404)

    KELP   = ( 38, 118,  65)
    KELP_H = ( 68, 162,  95)
    KELP_D = ( 18,  72,  38)

    # Several swaying fronds
    n_fronds = 4
    for fi in range(n_fronds):
        fx = cx + (fi - 1) * 7
        # S-curve frond via small line segments
        pts = [(fx, cy)]
        cur_x, cur_y = fx, cy
        sway = r2.choice([-1, 1]) * r2.randint(3, 7)
        for seg in range(10):
            cur_x += sway * math.sin(seg * 0.8) * 1.5
            cur_y -= r2.randint(4, 7)
            pts.append((int(cur_x), int(cur_y)))
        for j in range(len(pts) - 1):
            w = max(1, 4 - j // 3)
            t = j / (len(pts) - 1)
            col = lerpc(KELP_D, KELP_H, t)
            d.line([pts[j], pts[j + 1]], fill=(*col, 220), width=w)
        # Blade at tip
        tip = pts[-1]
        bw = r2.randint(5, 9)
        bh = r2.randint(8, 12)
        d.ellipse([tip[0] - bw, tip[1] - bh, tip[0] + bw, tip[1] + bh // 3],
                  fill=(*KELP, 200))
        # Float bladder
        circle(d, tip[0], tip[1], r2.randint(2, 4), (*KELP_H, 180))

    return drop_shadow(img, radius=4, offset=(2, 3), alpha=65)


def prop_algae(size=48):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d   = ImageDraw.Draw(img)
    cx, cy = size // 2, size - 4
    r2 = random.Random(405)

    ALG   = ( 48, 128,  78)
    ALG_H = ( 82, 172, 115)
    ALG_D = ( 22,  78,  42)

    # Low-lying turf — short bushy tufts
    for ti in range(6):
        tx = cx - 16 + ti * 6
        for _ in range(4):
            lx = tx + r2.randint(-3, 3)
            ly = cy
            length = r2.randint(8, 18)
            ang    = math.radians(-90 + r2.randint(-25, 25))
            ex     = lx + int(math.cos(ang) * length)
            ey     = ly + int(math.sin(ang) * length)
            col    = r2.choice([ALG, ALG_H, ALG_D, RGREEN])
            d.line([(lx, ly), (ex, ey)], fill=(*col, 200), width=2)

    # Base holdfast smudge
    d.ellipse([cx - 14, cy - 4, cx + 14, cy + 4], fill=(*ALG_D, 140))
    return drop_shadow(img, radius=3, offset=(2, 2), alpha=55)


def prop_starfish(size=48):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d   = ImageDraw.Draw(img)
    cx, cy = size // 2, size // 2

    STAR   = (210, 110,  60)
    STAR_H = (240, 155, 100)
    STAR_D = (155,  68,  28)
    STAR_SP = (195, 155, 120)

    # Five-arm star polygon
    outer_r = 18
    inner_r = 7
    pts = []
    for i in range(10):
        ang = math.radians(-90 + i * 36)
        r   = outer_r if i % 2 == 0 else inner_r
        pts.append((cx + math.cos(ang) * r, cy + math.sin(ang) * r))
    poly(d, pts, (*STAR, 230))

    # Arm highlights and texture
    for i in range(5):
        ang = math.radians(-90 + i * 72)
        ax  = cx + math.cos(ang) * outer_r * 0.6
        ay  = cy + math.sin(ang) * outer_r * 0.6
        d.line([(cx, cy), (ax, ay)], fill=(*STAR_H, 100), width=2)
        # Tube feet dots along arm
        for fi in range(3):
            t  = (fi + 1) / 4
            fx = cx + math.cos(ang) * outer_r * t
            fy = cy + math.sin(ang) * outer_r * t
            off_ang = ang + math.pi / 2
            for side in [-1, 1]:
                sx = fx + math.cos(off_ang) * 3 * side
                sy = fy + math.sin(off_ang) * 3 * side
                circle(d, int(sx), int(sy), 1, (*STAR_SP, 150))

    # Central disc
    circle(d, cx, cy, 5, (*STAR_D, 220))
    circle(d, cx, cy, 2, (*STAR_H, 200))

    return drop_shadow(img, radius=3, offset=(2, 2), alpha=55)


def prop_shell(size=64):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d   = ImageDraw.Draw(img)
    cx, cy = size // 2, size // 2

    SHELL   = (215, 195, 155)
    SHELL_H = (240, 222, 188)
    SHELL_D = (158, 135, 100)
    SHELL_L = (200, 105,  85)

    # Conical spiral shell — top-down view as a coiled shape
    # Draw concentric elliptical rings getting smaller (spiral effect)
    for ring in range(5, 0, -1):
        t = ring / 5
        rx = int(18 * t)
        ry = int(14 * t)
        ang_off = ring * 0.4
        col = lerpc(SHELL_D, SHELL_H, 1 - t)
        d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry],
                  fill=(*col, 200 + ring * 8))
        # Spiral rib lines
        for rib_a in range(0, 360, 60):
            a = math.radians(rib_a + ang_off * 30)
            d.arc([cx - rx, cy - ry, cx + rx, cy + ry],
                  start=rib_a + int(ang_off * 15), end=rib_a + int(ang_off * 15) + 40,
                  fill=(*SHELL_D, 80), width=1)

    # Colour bands — spiral-ish arcs
    for band in range(3):
        a0 = band * 120
        d.arc([cx - 16, cy - 12, cx + 16, cy + 12],
              start=a0, end=a0 + 60,
              fill=(*SHELL_L, 120), width=2)

    # Lip / aperture
    d.arc([cx - 18, cy - 14, cx + 4, cy + 14],
          start=120, end=240, fill=(*SHELL_D, 180), width=3)
    # Spire tip
    circle(d, cx + 4, cy - 4, 4, (*SHELL_H, 220))
    circle(d, cx + 5, cy - 5, 2, (250, 245, 235, 180))

    return drop_shadow(img, radius=4, offset=(2, 3), alpha=65)


def make_props():
    props = [
        ("prop_coral.png",     prop_coral(96)),
        ("prop_coralhead.png", prop_coralhead(64)),
        ("prop_anemone.png",   prop_anemone(64)),
        ("prop_kelp.png",      prop_kelp(64)),
        ("prop_algae.png",     prop_algae(48)),
        ("prop_starfish.png",  prop_starfish(48)),
        ("prop_shell.png",     prop_shell(64)),
    ]
    for name, img in props:
        save(img, name)


# =============================================================================
# 5.  KEYART_REEF  1600×1000  cover
# =============================================================================

def make_keyart_reef():
    W, H = 1600, 1000
    SPLIT_X = int(W * 0.50)

    base = Image.new("RGBA", (W, H), (0, 0, 0, 255))
    d    = ImageDraw.Draw(base)
    r2   = random.Random(77)

    # ── Background water gradient ─────────────────────────────────────────
    for y in range(H):
        t = y / H
        # left: vibrant living reef water
        cl = lerpc(lerpc(TURQUOISE_H, TURQUOISE, t * 0.8),
                   lerpc(TURQUOISE, TURQUOISE_D, t * 0.5), t)
        # right: bleached toxic silt water
        cr = lerpc(lerpc(SEDBROWN, TOXIC, 0.4),
                   lerpc(TOXIC_D, (22, 18, 8), 0.6), min(1, t * 0.9))
        split_here = SPLIT_X + int(70 * math.sin(y * 0.009 + 1.2))
        d.line([(0, y), (split_here, y)], fill=(*cl, 255))
        d.line([(split_here, y), (W, y)], fill=(*cr, 255))

    # ── Caustic light shafts — left half ─────────────────────────────────
    caustic_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    cld = ImageDraw.Draw(caustic_layer)
    for _ in range(30):
        cx2 = r2.randint(30, SPLIT_X - 60)
        cy2 = r2.randint(80, 900)
        w2  = r2.randint(10, 40)
        h2  = r2.randint(4, 14)
        a2  = r2.randint(18, 45)
        cld.arc([cx2 - w2, cy2 - h2, cx2 + w2, cy2 + h2],
                start=r2.randint(160, 200), end=r2.randint(340, 380),
                fill=(*TURQUOISE_H, a2), width=1)
    caustic_layer = caustic_layer.filter(ImageFilter.GaussianBlur(1.2))
    base.alpha_composite(caustic_layer)

    # ── Coral garden — left half scattered reef art ───────────────────────
    reef_props = {
        "prop_coral.png":     prop_coral(96),
        "prop_coralhead.png": prop_coralhead(64),
        "prop_anemone.png":   prop_anemone(64),
        "prop_kelp.png":      prop_kelp(64),
        "prop_algae.png":     prop_algae(48),
        "prop_starfish.png":  prop_starfish(48),
    }
    scatter_left = [
        ("prop_coral.png",     160, 780, 2.6), ("prop_coral.png",     380, 700, 2.2),
        ("prop_coral.png",      60, 860, 2.0), ("prop_coralhead.png", 260, 820, 2.0),
        ("prop_coralhead.png", 520, 750, 1.8), ("prop_coralhead.png", 680, 830, 1.7),
        ("prop_anemone.png",   340, 870, 2.0), ("prop_anemone.png",   580, 840, 1.8),
        ("prop_anemone.png",   210, 940, 1.9), ("prop_kelp.png",      440, 780, 2.2),
        ("prop_kelp.png",      140, 720, 2.0), ("prop_kelp.png",      600, 770, 1.8),
        ("prop_algae.png",     190, 880, 2.2), ("prop_algae.png",     460, 950, 2.0),
        ("prop_algae.png",      70, 950, 1.9), ("prop_starfish.png",  620, 900, 1.8),
        ("prop_starfish.png",  130, 950, 1.6), ("prop_starfish.png",  380, 970, 1.5),
    ]

    def paste(canvas, img_obj, cx3, cy3, scale=1.0):
        nw = max(1, int(img_obj.width * scale))
        nh = max(1, int(img_obj.height * scale))
        s  = img_obj.resize((nw, nh), Image.LANCZOS)
        x  = int(cx3 - nw / 2)
        y  = int(cy3 - nh / 2)
        canvas.alpha_composite(s, (x, y))

    for name, px3, py3, sc in scatter_left:
        if px3 < SPLIT_X - 60:
            paste(base, reef_props[name], px3, py3, sc)

    # ── Bleached/toxic right half — sickened prop scatter ────────────────
    scatter_right = [
        ("prop_coralhead.png", 1050, 790, 1.8), ("prop_coralhead.png", 1350, 830, 1.6),
        ("prop_coralhead.png", 1500, 770, 1.5), ("prop_coral.png",      980, 870, 1.6),
        ("prop_coral.png",    1200, 750, 1.4), ("prop_algae.png",     1080, 950, 1.7),
        ("prop_algae.png",    1300, 910, 1.5), ("prop_algae.png",     1520, 960, 1.4),
    ]
    for name, px3, py3, sc in scatter_right:
        if px3 > SPLIT_X + 40:
            sick = desaturate(reef_props[name].copy(), amt=0.85)
            paste(base, sick, px3, py3, sc)

    # ── Silt plume clouds — right half ───────────────────────────────────
    silt_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sld = ImageDraw.Draw(silt_layer)
    silt_clusters = [
        (1060, 700, 160, 75), (1220, 820, 190, 85), (1390, 760, 150, 65),
        (1490, 900, 130, 60), (1110, 945, 165, 70), (1330, 965, 140, 55),
        ( 910, 855, 115, 52),
    ]
    for (sx, sy, srx, sry) in silt_clusters:
        if sx < SPLIT_X + 30:
            continue
        col = lerpc(SEDBROWN, TOXIC, r2.random() * 0.6)
        sld.ellipse([sx - srx, sy - sry, sx + srx, sy + sry],
                    fill=(*col, r2.randint(55, 105)))
    silt_layer = silt_layer.filter(ImageFilter.GaussianBlur(18))
    base.alpha_composite(silt_layer)

    # ── Blacktip shark — large, left half ────────────────────────────────
    shark_img = sprite_shark()
    shark_big = shark_img.resize((380, int(380 * shark_img.height / shark_img.width)),
                                  Image.LANCZOS)
    paste(base, shark_big, 310, 480, 1.0)

    # ── Dividing boundary glow ────────────────────────────────────────────
    def boundary_x(y):
        return SPLIT_X + int(65 * math.sin(y * 0.007 + 0.9))

    bdl = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    bdd = ImageDraw.Draw(bdl)
    for y in range(H):
        bx = boundary_x(y)
        for off, alpha in [(-7, 12), (-3, 35), (-1, 65), (0, 90), (1, 65), (3, 35), (7, 12)]:
            col = lerpc(TURQUOISE_H, GOLD, 0.4)
            bdd.point((bx + off, y), fill=(*col, alpha))
    bdl = bdl.filter(ImageFilter.GaussianBlur(2.5))
    base.alpha_composite(bdl)

    # Right side darken veil
    veil = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    vd   = ImageDraw.Draw(veil)
    for y in range(H):
        bx = boundary_x(y)
        for x in range(bx, W):
            depth = min(1.0, (x - bx) / 420)
            vd.point((x, y), fill=(*TOXIC_D, int(depth * 92)))
    veil = veil.filter(ImageFilter.GaussianBlur(14))
    base.alpha_composite(veil)

    # ── Vignette ──────────────────────────────────────────────────────────
    vig = Image.new("L", (W, H), 0)
    vd2 = ImageDraw.Draw(vig)
    vd2.ellipse([-W * 0.2, -H * 0.2, W * 1.2, H * 1.2], fill=255)
    vig = vig.filter(ImageFilter.GaussianBlur(200))
    dark_vig = Image.new("RGBA", (W, H), (6, 8, 10, 255))
    dark_vig.putalpha(Image.eval(vig, lambda v: 155 - int(v * 155 / 255)))
    base.alpha_composite(dark_vig)

    # ── Title headroom — subtle gradient reserve at top ───────────────────
    head = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    hd   = ImageDraw.Draw(head)
    for y in range(220):
        t = 1 - y / 220
        hd.line([(0, y), (W, y)], fill=(6, 18, 24, int(t * 160)))
    base.alpha_composite(head)

    # ── Left / right labels ───────────────────────────────────────────────
    from PIL import ImageFont
    def _font(sz):
        for p in ["/System/Library/Fonts/Supplemental/Arial Bold.ttf",
                  "/Library/Fonts/Arial.ttf",
                  "/System/Library/Fonts/Helvetica.ttc"]:
            try:
                return ImageFont.truetype(p, sz)
            except Exception:
                pass
        return ImageFont.load_default()

    dt = ImageDraw.Draw(base)
    fn = _font(22)
    dt.text((60, H - 80), "◆  LIVING REEF", font=fn, fill=(*TURQUOISE_H, 210))
    rw = dt.textlength("BLEACHED REEF  ◆", font=fn)
    dt.text((W - 60 - rw, H - 80), "BLEACHED REEF  ◆", font=fn, fill=(*DANGER, 210))
    fn2 = _font(20)
    footer = "Track 1 · Biodiversity & Environmental Protection   |   #CodeBuddy #TencentCloudHackathon"
    fw = dt.textlength(footer, font=fn2)
    dt.text(((W - fw) / 2 + 2, H - 44 + 2), footer, font=fn2, fill=(0, 0, 0, 190))
    dt.text(((W - fw) / 2,     H - 44),     footer, font=fn2, fill=(*TURQUOISE_H, 255))

    save(base, "keyart_reef.png")


# =============================================================================
# MAIN
# =============================================================================
if __name__ == "__main__":
    print("=== gen_reef.py — coral_reef placeholder art ===")
    print("── tiles ──────────────────────────────────────")
    make_tiles()
    print("── species sprites ────────────────────────────")
    make_species()
    print("── invasive sprites ───────────────────────────")
    make_invasive()
    print("── decorative props ───────────────────────────")
    make_props()
    print("── keyart ─────────────────────────────────────")
    make_keyart_reef()
    print("done.")
