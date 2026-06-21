"""
gen_tiles.py  —  Ecosystem X terrain tile generator
Produces 4 × 128×128 PNG tiles for the healthy-state biome:
  tile_water.png   clear shallow estuary water + gentle ripples
  tile_marsh.png   vibrant seagrass/reed marsh
  tile_land.png    damp vegetated mudflat / bank
  tile_source.png  runoff outfall / drainage mouth (subtle hazard)
Output: /assets/  (created if absent)
"""

import math, random, os
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), '..', 'assets')
os.makedirs(OUT, exist_ok=True)

W, H = 128, 128
rng  = random.Random(42)          # deterministic, matches game seed philosophy

# ── helpers ──────────────────────────────────────────────────────────────────

def noise_offset(x, y, scale=0.08, amp=6):
    """cheap pseudo-noise displacement using sin/cos harmonics."""
    v  = math.sin(x * scale + 1.3) * math.cos(y * scale * 0.9 + 0.7)
    v += math.sin(x * scale * 2.1 + y * scale * 1.7 + 3.1) * 0.4
    return int(v * amp)

def lerp_color(c1, c2, t):
    return tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))

def jitter(val, spread, r=rng):
    return val + r.randint(-spread, spread)

# ── TILE 1 : tile_water.png ───────────────────────────────────────────────────
def make_water():
    img  = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    BASE   = (62, 150, 175)      # clear teal
    DEEP   = (40, 115, 148)
    LIGHT  = (130, 205, 220)
    FOAM   = (200, 235, 240, 180)

    # base gradient (top=lighter, bottom=deeper)
    for y in range(H):
        t = y / H
        c = lerp_color(BASE, DEEP, t * 0.6)
        c = lerp_color(c, LIGHT, math.sin(y * 0.18) * 0.12 + 0.06)
        draw.line([(0, y), (W, y)], fill=c + (255,))

    # wavy ripple lines
    for row in range(4, H, 14):
        pts = []
        for x in range(W + 1):
            dy = math.sin((x + row * 3) * 0.14) * 2.5 + noise_offset(x, row, 0.07, 2)
            pts.append((x, row + dy))
        for i in range(len(pts) - 1):
            x0, y0 = pts[i];  x1, y1 = pts[i+1]
            alpha = rng.randint(55, 110)
            draw.line([(x0, y0), (x1, y1)], fill=(255, 255, 255, alpha), width=1)

    # small highlight specks
    for _ in range(35):
        x, y = rng.randint(2, W-3), rng.randint(2, H-3)
        r2 = rng.randint(1, 3)
        draw.ellipse([x-r2, y-r2, x+r2, y+r2], fill=FOAM)

    img = img.filter(ImageFilter.GaussianBlur(0.4))
    img.save(os.path.join(OUT, 'tile_water.png'))
    print('  ✓ tile_water.png')

# ── TILE 2 : tile_marsh.png ───────────────────────────────────────────────────
def make_marsh():
    img  = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    WATER  = (55, 135, 100, 255)   # dark teal-green base
    GRASS1 = (60, 170,  80)        # bright seagrass
    GRASS2 = (30, 120,  50)        # deep shadow grass
    REED   = (100, 180,  60)
    BLADE  = (180, 220,  90, 220)

    # base: shallow water between grass
    for y in range(H):
        for x in range(W):
            t = (math.sin(x * 0.18 + y * 0.11) + 1) / 2
            c = lerp_color(WATER[:3], GRASS2, t * 0.55)
            img.putpixel((x, y), c + (255,))

    # grass clumps
    for _ in range(28):
        cx = rng.randint(5, W-6)
        cy = rng.randint(5, H-6)
        spread = rng.randint(4, 14)
        col = GRASS1 if rng.random() > 0.4 else GRASS2
        for bx in range(-spread, spread+1):
            for by in range(-spread//2, spread//2+1):
                px, py = cx+bx, cy+by
                if 0 <= px < W and 0 <= py < H:
                    d = math.sqrt(bx*bx + by*by*1.6) / spread
                    if d < 1.0:
                        alpha = int((1 - d) * 200 + 55)
                        jc = tuple(jitter(v, 12) for v in col)
                        img.putpixel((px, py), (
                            max(0,min(255,jc[0])),
                            max(0,min(255,jc[1])),
                            max(0,min(255,jc[2])),
                            alpha))

    # reed blades (thin vertical strokes)
    for _ in range(40):
        x = rng.randint(3, W-4)
        y0 = rng.randint(H//3, H-4)
        length = rng.randint(8, 22)
        sway = rng.randint(-3, 3)
        alpha = rng.randint(160, 220)
        draw.line([(x, y0), (x+sway, y0-length)], fill=BLADE[:3]+(alpha,), width=1)
        # tip seed head
        draw.ellipse([x+sway-2, y0-length-2, x+sway+2, y0-length+2],
                     fill=(80, 60, 30, alpha))

    img = img.filter(ImageFilter.GaussianBlur(0.3))
    img.save(os.path.join(OUT, 'tile_marsh.png'))
    print('  ✓ tile_marsh.png')

# ── TILE 3 : tile_land.png ────────────────────────────────────────────────────
def make_land():
    img  = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    MUD1  = (120, 95,  65)    # damp mudflat
    MUD2  = ( 95, 72,  48)    # wet shadow
    MOSS  = ( 90, 135, 60)    # moss/algae patches
    HERB  = (130, 160, 70)    # low vegetation
    WATER = ( 70, 130, 110)   # wet puddle traces

    # base mudflat
    for y in range(H):
        for x in range(W):
            n = noise_offset(x, y, 0.10, 15)
            t = (n + 15) / 30
            c = lerp_color(MUD1, MUD2, t)
            img.putpixel((x, y), c + (255,))

    # wet puddle traces
    for _ in range(6):
        cx = rng.randint(10, W-11)
        cy = rng.randint(10, H-11)
        rx, ry = rng.randint(5,18), rng.randint(3,10)
        draw.ellipse([cx-rx, cy-ry, cx+rx, cy+ry], fill=WATER+(110,))

    # moss/algae patches
    for _ in range(18):
        cx = rng.randint(4, W-5)
        cy = rng.randint(4, H-5)
        r2 = rng.randint(3, 10)
        col = MOSS if rng.random() > 0.45 else HERB
        draw.ellipse([cx-r2, cy-r2, cx+r2, cy+r2],
                     fill=col+(rng.randint(130,200),))

    # small pebbles
    for _ in range(14):
        x, y = rng.randint(2, W-3), rng.randint(2, H-3)
        r2 = rng.randint(1, 3)
        shade = rng.randint(80, 130)
        draw.ellipse([x-r2, y-r2, x+r2, y+r2], fill=(shade,shade-10,shade-20,210))

    img = img.filter(ImageFilter.GaussianBlur(0.4))
    img.save(os.path.join(OUT, 'tile_land.png'))
    print('  ✓ tile_land.png')

# ── TILE 4 : tile_source.png ──────────────────────────────────────────────────
def make_source():
    img  = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    BASE   = (100, 110,  80)   # worn concrete / earth
    DARK   = ( 65,  72,  50)
    PIPE   = ( 80,  85,  75)   # grey pipe
    PLUME1 = (130, 155,  60, 200)   # murky outflow, still subtle
    PLUME2 = (100, 120,  45, 140)
    SHEEN  = (170, 190,  50, 80)    # very faint iridescent sheen

    # base: worn earth/concrete
    for y in range(H):
        for x in range(W):
            n = noise_offset(x, y, 0.12, 12)
            t = (n + 12) / 24
            c = lerp_color(BASE, DARK, t)
            img.putpixel((x, y), c + (255,))

    # drainage channel — a shallow groove leading from top to center
    channel_cx = W // 2
    for y in range(0, H*3//4):
        wid = max(2, int(3 + y * 0.04))
        for dx in range(-wid, wid+1):
            px = channel_cx + dx + noise_offset(dx, y, 0.2, 2)
            if 0 <= px < W:
                depth = int((1 - abs(dx)/wid) * 60)
                r, g, b, a = img.getpixel((px, y))
                img.putpixel((px, y), (max(0,r-depth),max(0,g-depth),max(0,b-depth),a))

    # concrete pipe opening at center
    pipe_cx, pipe_cy = W//2, H//2 - 4
    draw.ellipse([pipe_cx-14, pipe_cy-10, pipe_cx+14, pipe_cy+10],
                 fill=PIPE+(255,), outline=(50,55,45,255), width=2)
    draw.ellipse([pipe_cx-9, pipe_cy-6, pipe_cx+9, pipe_cy+6],
                 fill=(30,35,25,255))   # dark mouth

    # outflow plume spreading downward
    for i, (col, radius) in enumerate([(PLUME1, 28), (PLUME2, 18), (SHEEN, 12)]):
        cy2 = pipe_cy + 14 + i*6
        draw.ellipse([pipe_cx-radius, cy2-radius//2,
                      pipe_cx+radius, cy2+radius//2], fill=col)

    # subtle sheen ripples near outlet
    for offset_y in range(0, 35, 8):
        oy = pipe_cy + 18 + offset_y
        arc_w = int(20 + offset_y * 0.6)
        for dx in range(-arc_w, arc_w):
            px = pipe_cx + dx
            py = int(oy + math.sin(dx * 0.18) * 3)
            if 0 <= px < W and 0 <= py < H:
                r, g, b, a = img.getpixel((px, py))
                img.putpixel((px, py), (min(255,r+15),min(255,g+20),min(255,b+5),a))

    img = img.filter(ImageFilter.GaussianBlur(0.35))
    img.save(os.path.join(OUT, 'tile_source.png'))
    print('  ✓ tile_source.png')

# ── run ───────────────────────────────────────────────────────────────────────
print('Generating terrain tiles → assets/')
make_water()
make_marsh()
make_land()
make_source()
print('Done.')
