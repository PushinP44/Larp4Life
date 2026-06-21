"""
gen_tiles_toxic.py  —  Ecosystem X  TOXIC / DEGRADED terrain tile variants
Same 128×128 RGBA, tileable composition as healthy tiles — different palette:
  algal bloom olive-brown, oil sheen iridescence, desaturated, dead reeds.
  tile_water_toxic.png
  tile_marsh_toxic.png
  tile_land_toxic.png
  tile_source_toxic.png
Output → /assets/
"""

import math, random, os
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), '..', 'assets')
os.makedirs(OUT, exist_ok=True)

W, H = 128, 128
rng  = random.Random(99)   # different seed from healthy set

# ── helpers (same as gen_tiles.py) ───────────────────────────────────────────

def noise_offset(x, y, scale=0.08, amp=6):
    v  = math.sin(x * scale + 1.3) * math.cos(y * scale * 0.9 + 0.7)
    v += math.sin(x * scale * 2.1 + y * scale * 1.7 + 3.1) * 0.4
    return int(v * amp)

def lerp_color(c1, c2, t):
    t = max(0.0, min(1.0, t))
    return tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))

def jitter(val, spread, r=rng):
    return max(0, min(255, val + r.randint(-spread, spread)))

def clamp(v):
    return max(0, min(255, int(v)))

# ── oil-sheen helper ─────────────────────────────────────────────────────────
OIL_COLORS = [
    (160, 140,  50),   # yellow-green
    (110,  60, 120),   # muted purple
    ( 40, 110,  90),   # dark teal
    (160,  80,  30),   # burnt orange
    ( 80, 110,  40),   # olive
]

def oil_sheen_pixel(x, y, strength=0.35):
    """Return an additive RGB tint for iridescent oil sheen — blob-like, not striped."""
    # use lower frequency so patches are larger, less striated
    blobx = x * 0.045 + y * 0.033
    bloby = y * 0.038 - x * 0.029
    blob  = (math.sin(blobx + 1.3) * math.cos(bloby + 0.9) + 1) / 2  # 0-1
    # only apply where blob is above threshold (sparse patches)
    if blob < 0.52:
        return (0, 0, 0)
    idx  = int((math.sin(x * 0.06 + y * 0.05 + 1.7) + 1) / 2 * (len(OIL_COLORS)-1))
    base = OIL_COLORS[idx % len(OIL_COLORS)]
    s    = (blob - 0.52) / 0.48 * strength
    return tuple(int(c * s) for c in base)

# ── TILE 1 : tile_water_toxic.png ─────────────────────────────────────────────
def make_water_toxic():
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))

    ALGAE_BASE  = ( 78,  92,  38)   # murky olive-brown
    ALGAE_DEEP  = ( 50,  60,  22)   # darker algal shadow
    ALGAE_BLOOM = (110, 130,  28)   # bright algal bloom patch
    FOAM_DEAD   = (155, 148,  88, 160)   # yellowish dead foam

    pixels = img.load()
    for y in range(H):
        for x in range(W):
            t  = y / H
            n  = noise_offset(x, y, 0.09, 14)
            nt = (n + 14) / 28
            c  = lerp_color(ALGAE_BASE, ALGAE_DEEP, t * 0.55 + nt * 0.35)
            # algal bloom patches — large blob noise, NOT sin stripes
            bx = x * 0.055; by = y * 0.060
            bloom = (math.sin(bx + 1.1) * math.cos(by + 2.3)
                   + math.sin(bx*1.7 + by*1.3 + 0.8) * 0.45 + 1) / 2.9
            if bloom > 0.38:
                c = lerp_color(c, ALGAE_BLOOM, min(1.0,(bloom - 0.38) * 2.8))
            # subtle oil sheen (sparse patches only)
            sheen = oil_sheen_pixel(x, y, 0.22)
            c = tuple(clamp(cv + sv) for cv, sv in zip(c, sheen))
            pixels[x, y] = (c[0], c[1], c[2], 255)

    draw = ImageDraw.Draw(img)
    # dead yellowish surface ripples
    for row in range(6, H, 16):
        for x in range(W):
            dy = math.sin((x + row * 2.7) * 0.13) * 2 + noise_offset(x, row, 0.08, 2)
            py = int(row + dy)
            if 0 <= py < H:
                alpha = rng.randint(40, 80)
                r2, g2, b2, _ = img.getpixel((x, py))
                img.putpixel((x, py), (clamp(r2+25), clamp(g2+20), clamp(b2-10), 255))

    # dead foam clumps
    for _ in range(20):
        x, y = rng.randint(2, W-3), rng.randint(2, H-3)
        r2 = rng.randint(1, 4)
        draw.ellipse([x-r2, y-r2, x+r2, y+r2], fill=FOAM_DEAD)

    img = img.filter(ImageFilter.GaussianBlur(0.45))
    img.save(os.path.join(OUT, 'tile_water_toxic.png'))
    print('  ✓ tile_water_toxic.png')

# ── TILE 2 : tile_marsh_toxic.png ─────────────────────────────────────────────
def make_marsh_toxic():
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))

    BASE     = ( 65,  72,  40, 255)   # murky stagnant base
    DEAD1    = ( 95,  85,  45)        # dead/dried grass tan
    DEAD2    = ( 70,  60,  30)        # dark rotten stem
    ALGAE    = ( 85, 100,  30)        # algal surface coat
    STEM_COL = (110,  95,  50, 200)   # dead reed stem

    pixels = img.load()
    for y in range(H):
        for x in range(W):
            n  = noise_offset(x, y, 0.11, 12)
            nt = (n + 12) / 24
            c  = lerp_color(BASE[:3], DEAD2, nt * 0.5)
            # algal patches — blob noise
            bx = x * 0.052; by = y * 0.058
            ag = (math.sin(bx + 0.8) * math.cos(by + 1.9)
                + math.sin(bx*1.6 + by*1.2 + 2.1) * 0.4 + 1) / 2.8
            if ag > 0.40:
                c = lerp_color(c, ALGAE, min(1.0, (ag - 0.40) * 2.5))
            # subtle oil sheen patches
            sheen = oil_sheen_pixel(x, y, 0.18)
            c = tuple(clamp(cv + sv) for cv, sv in zip(c, sheen))
            pixels[x, y] = (c[0], c[1], c[2], 255)

    draw = ImageDraw.Draw(img)
    # dead reed clumps — desaturated tan/brown upright strokes
    for _ in range(38):
        x  = rng.randint(3, W-4)
        y0 = rng.randint(H//3, H - 4)
        length = rng.randint(10, 26)
        sway   = rng.randint(-4, 4)
        broken = rng.random() > 0.5   # drooping dead reed
        alpha  = rng.randint(170, 230)
        col    = (jitter(DEAD1[0], 12), jitter(DEAD1[1], 10), jitter(DEAD1[2], 8), alpha)
        if broken:
            mid_y = y0 - length // 2
            mid_x = x + sway // 2
            # drooped top half
            draw.line([(x, y0), (mid_x, mid_y)], fill=col, width=1)
            draw.line([(mid_x, mid_y), (mid_x + sway + rng.randint(-3,3), mid_y + length//3)],
                      fill=col, width=1)
        else:
            draw.line([(x, y0), (x + sway, y0 - length)], fill=col, width=1)
        # withered seed head — pale brown
        draw.ellipse([x+sway-2, y0-length-2, x+sway+2, y0-length+2],
                     fill=(100, 80, 40, alpha))

    img = img.filter(ImageFilter.GaussianBlur(0.35))
    img.save(os.path.join(OUT, 'tile_marsh_toxic.png'))
    print('  ✓ tile_marsh_toxic.png')

# ── TILE 3 : tile_land_toxic.png ─────────────────────────────────────────────
def make_land_toxic():
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))

    MUD1   = ( 80,  70,  45)   # compacted dead mudflat
    MUD2   = ( 55,  48,  30)   # dark cracked shadow
    CRACK  = ( 40,  35,  20)   # desiccation cracks
    STAIN  = ( 70,  80,  25)   # chemical stain / algal residue
    OILPUD = ( 50,  52,  35)   # oily puddle

    pixels = img.load()
    for y in range(H):
        for x in range(W):
            n  = noise_offset(x, y, 0.12, 14)
            nt = (n + 14) / 28
            c  = lerp_color(MUD1, MUD2, nt)
            # chemical stain blotches — blob noise
            bx = x * 0.048; by = y * 0.053
            st = (math.cos(bx + 2.0) * math.sin(by + 1.5)
                + math.sin(bx*1.5 + by*1.1 + 3.0) * 0.4 + 1) / 2.8
            if st > 0.44:
                c = lerp_color(c, STAIN, min(1.0, (st - 0.44) * 3.0))
            # sparse oil sheen patches
            sheen = oil_sheen_pixel(x, y, 0.20)
            c = tuple(clamp(cv + sv) for cv, sv in zip(c, sheen))
            pixels[x, y] = (c[0], c[1], c[2], 255)

    draw = ImageDraw.Draw(img)
    # desiccation crack network
    for _ in range(10):
        x0 = rng.randint(5, W-6)
        y0 = rng.randint(5, H-6)
        angle = rng.uniform(0, math.pi)
        length = rng.randint(12, 35)
        x1 = int(x0 + math.cos(angle) * length)
        y1 = int(y0 + math.sin(angle) * length)
        draw.line([(x0, y0), (x1, y1)], fill=CRACK+(200,), width=1)
        # branch
        if rng.random() > 0.4:
            angle2 = angle + rng.uniform(0.4, 1.2) * (1 if rng.random()>0.5 else -1)
            mx, my = (x0+x1)//2, (y0+y1)//2
            bx = int(mx + math.cos(angle2) * length * 0.5)
            by = int(my + math.sin(angle2) * length * 0.5)
            draw.line([(mx, my), (bx, by)], fill=CRACK+(160,), width=1)

    # oily puddles
    for _ in range(5):
        cx = rng.randint(10, W-11)
        cy = rng.randint(10, H-11)
        rx, ry = rng.randint(4,14), rng.randint(2,8)
        draw.ellipse([cx-rx, cy-ry, cx+rx, cy+ry], fill=OILPUD+(140,))
        # oil sheen on puddle
        for dx in range(-rx, rx):
            for dy2 in range(-ry, ry):
                px2 = cx+dx; py2 = cy+dy2
                if 0<=px2<W and 0<=py2<H:
                    if (dx/rx)**2 + (dy2/ry)**2 < 1.0:
                        sh = oil_sheen_pixel(px2, py2, 0.6)
                        r2,g2,b2,a2 = img.getpixel((px2,py2))
                        img.putpixel((px2,py2),(clamp(r2+sh[0]),clamp(g2+sh[1]),clamp(b2+sh[2]),a2))

    img = img.filter(ImageFilter.GaussianBlur(0.4))
    img.save(os.path.join(OUT, 'tile_land_toxic.png'))
    print('  ✓ tile_land_toxic.png')

# ── TILE 4 : tile_source_toxic.png ───────────────────────────────────────────
def make_source_toxic():
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))

    BASE    = ( 65,  68,  40)    # stained dark concrete
    DARK    = ( 42,  44,  25)
    PIPE    = ( 72,  70,  55)    # corroded pipe
    RUST    = (120,  65,  20)    # rust streaks
    EFFLUENT= ( 90, 110,  20, 220)   # thick toxic outflow
    FOAM_T  = (175, 180,  60, 200)   # toxic foam

    pixels = img.load()
    for y in range(H):
        for x in range(W):
            n  = noise_offset(x, y, 0.11, 14)
            nt = (n + 14) / 28
            c  = lerp_color(BASE, DARK, nt)
            # oil sheen — moderate blobs around pipe area
            dist_pipe = math.sqrt((x - W//2)**2 + (y - H//2)**2)
            local_str = max(0.0, 0.30 * (1.0 - dist_pipe / 55))
            sheen = oil_sheen_pixel(x, y, local_str)
            c = tuple(clamp(cv + sv) for cv, sv in zip(c, sheen))
            pixels[x, y] = (c[0], c[1], c[2], 255)

    draw = ImageDraw.Draw(img)

    # wider, more prominent drainage channel — stained
    channel_cx = W // 2
    for y in range(0, H * 4 // 5):
        wid = max(3, int(5 + y * 0.055))
        for dx in range(-wid, wid+1):
            px = channel_cx + dx + noise_offset(dx, y, 0.18, 2)
            if 0 <= px < W:
                depth = int((1 - abs(dx)/wid) * 70)
                r2, g2, b2, a2 = img.getpixel((px, y))
                # stain greenish near centre
                img.putpixel((px, y), (
                    clamp(r2 - depth + 8),
                    clamp(g2 - depth//2 + 12),
                    clamp(b2 - depth),
                    a2))

    # rust streaks along channel walls
    for _ in range(8):
        rx = channel_cx + rng.choice([-1,1]) * rng.randint(4, 10)
        ry0 = rng.randint(5, H//2)
        rl  = rng.randint(8, 22)
        draw.line([(rx, ry0), (rx + rng.randint(-2,2), ry0 + rl)],
                  fill=RUST+(180,), width=1)

    # corroded pipe — ovoid, greenish tinge
    pipe_cx, pipe_cy = W//2, H//2 - 2
    draw.ellipse([pipe_cx-15, pipe_cy-11, pipe_cx+15, pipe_cy+11],
                 fill=PIPE+(255,), outline=(38,42,22,255), width=2)
    # rust on pipe rim
    for angle in [0.3, 1.1, 2.0, 3.5, 5.0]:
        rox = int(pipe_cx + 13 * math.cos(angle))
        roy = int(pipe_cy +  9 * math.sin(angle))
        draw.ellipse([rox-2, roy-2, rox+2, roy+2], fill=RUST+(200,))
    # dark corroded mouth
    draw.ellipse([pipe_cx-9, pipe_cy-6, pipe_cx+9, pipe_cy+6],
                 fill=(20, 28, 10, 255))
    # green glow inside
    draw.ellipse([pipe_cx-5, pipe_cy-3, pipe_cx+5, pipe_cy+3],
                 fill=(40, 80, 10, 200))

    # thick toxic effluent plume — wider and more opaque than healthy
    for i, (col, rx2, ry2) in enumerate([
        (EFFLUENT, 32, 14),
        ((70,90,15,180), 22, 10),
        ((50,70,10,140), 14, 7),
    ]):
        cy2 = pipe_cy + 14 + i * 9
        draw.ellipse([pipe_cx-rx2, cy2-ry2, pipe_cx+rx2, cy2+ry2], fill=col)

    # toxic foam blobs near outlet
    for _ in range(14):
        fx = pipe_cx + rng.randint(-20, 20)
        fy = pipe_cy + rng.randint(14, 50)
        fr = rng.randint(2, 6)
        draw.ellipse([fx-fr, fy-fr, fx+fr, fy+fr], fill=FOAM_T)

    img = img.filter(ImageFilter.GaussianBlur(0.45))
    img.save(os.path.join(OUT, 'tile_source_toxic.png'))
    print('  ✓ tile_source_toxic.png')

# ── run ───────────────────────────────────────────────────────────────────────
print('Generating TOXIC terrain tiles → assets/')
make_water_toxic()
make_marsh_toxic()
make_land_toxic()
make_source_toxic()
print('Done.')
