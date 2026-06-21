"""
gen_sprites_ext.py  —  Ecosystem X  extinct variants + agent + UI pack
(a) Extinct silhouettes: desaturated grey, 25% opacity ghost of the 3 species
    sprite_seagrass_extinct.png
    sprite_shrimp_extinct.png
    sprite_heron_extinct.png
(b) agent.png : top-down field agent with scanner, gold-accented
(c) ui_pack.png : 5-glyph sheet (scanner, pulse-ring, link-node, coin, health-leaf)
                  arranged in a single 640×128 strip, each glyph 128×128
Output → /assets/
"""

import math, random, os
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

OUT = os.path.join(os.path.dirname(__file__), '..', 'assets')
os.makedirs(OUT, exist_ok=True)

W, H = 128, 128
CX, CY = W // 2, H // 2

def clamp(v): return max(0, min(255, int(v)))
def lerp(a, b, t): return a + (b - a) * t

# ═══════════════════════════════════════════════════════════════════════════════
# (a) EXTINCT SILHOUETTES
# ═══════════════════════════════════════════════════════════════════════════════

def make_extinct(source_name, out_name):
    """Load healthy sprite → desaturate → 25% opacity → ghostly overlay."""
    src_path = os.path.join(OUT, source_name)
    src = Image.open(src_path).convert('RGBA')

    # Desaturate to grey
    grey = ImageEnhance.Color(src).enhance(0.0)

    # Shift hue toward cool grey-blue ghost (tint)
    r, g, b, a = grey.split()
    # Slight blue tint for ghostly feel
    r2 = r.point(lambda x: clamp(x * 0.82))
    g2 = g.point(lambda x: clamp(x * 0.88))
    b2 = b.point(lambda x: clamp(x * 1.05))
    # Reduce to 25% opacity on visible pixels
    a2 = a.point(lambda x: clamp(x * 0.28))

    ghost = Image.merge('RGBA', (r2, g2, b2, a2))

    # Subtle scratchy cross over the sprite (extinction marker)
    draw = ImageDraw.Draw(ghost)
    diag_col = (160, 155, 165, 55)
    draw.line([(18, 18), (110, 110)], fill=diag_col, width=2)
    draw.line([(110, 18), (18, 110)], fill=diag_col, width=2)

    ghost = ghost.filter(ImageFilter.GaussianBlur(0.8))
    ghost.save(os.path.join(OUT, out_name))
    print(f'  ✓ {out_name}')

# ═══════════════════════════════════════════════════════════════════════════════
# (b) AGENT SPRITE
# ═══════════════════════════════════════════════════════════════════════════════

def make_agent():
    img  = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Colours
    SUIT   = ( 55,  72,  62)    # dark field green
    SUIT_L = ( 75,  95,  82)    # light panel
    GOLD   = (215, 175,  45)    # gold accent
    GOLD_L = (240, 210,  90)    # bright gold
    SKIN   = (195, 155, 115)    # face/hand
    VISOR  = ( 40, 120, 160, 200)  # scanner visor blue
    SCAN_B = ( 80, 195, 220)    # scanner beam teal
    BOOT   = ( 38,  48,  40)    # dark boots

    # Shadow underfoot
    for r in range(24, 0, -1):
        alpha = int(100 * (1 - r / 24))
        draw.ellipse([CX-r, CY+18-r//3, CX+r, CY+18+r//3], fill=(0,0,0,alpha))

    # ── Boots (two ovals, bottom of figure) ──────────────────────────────────
    draw.ellipse([CX-16, CY+24, CX-4,  CY+36], fill=BOOT+(240,))
    draw.ellipse([CX+4,  CY+24, CX+16, CY+36], fill=BOOT+(240,))

    # ── Legs ─────────────────────────────────────────────────────────────────
    draw.rectangle([CX-14, CY+8,  CX-5,  CY+28], fill=SUIT+(235,))
    draw.rectangle([CX+5,  CY+8,  CX+14, CY+28], fill=SUIT+(235,))
    # knee highlights
    draw.ellipse([CX-13, CY+14, CX-6,  CY+20], fill=SUIT_L+(160,))
    draw.ellipse([CX+6,  CY+14, CX+13, CY+20], fill=SUIT_L+(160,))

    # ── Torso / vest ─────────────────────────────────────────────────────────
    draw.rounded_rectangle([CX-18, CY-12, CX+18, CY+14], radius=5, fill=SUIT+(245,))
    # Gold chest plate band
    draw.rectangle([CX-16, CY-4, CX+16, CY+4], fill=GOLD+(200,))
    # Vest pocket left
    draw.rectangle([CX-15, CY-11, CX-7, CY-5], fill=SUIT_L+(190,))
    # Tencent/agency badge dot (gold)
    draw.ellipse([CX-13, CY-10, CX-9, CY-6], fill=GOLD_L+(220,))

    # ── Arms ─────────────────────────────────────────────────────────────────
    # Left arm — resting
    draw.rounded_rectangle([CX-26, CY-10, CX-17, CY+8], radius=3, fill=SUIT+(230,))
    # Right arm — raised, holding scanner
    draw.rounded_rectangle([CX+17, CY-18, CX+26, CY+2], radius=3, fill=SUIT+(230,))
    # Hands
    draw.ellipse([CX-26, CY+6, CX-18, CY+14], fill=SKIN+(230,))
    draw.ellipse([CX+18, CY-22, CX+26, CY-12], fill=SKIN+(230,))

    # ── Scanner device (right hand, above body) ───────────────────────────────
    # Scanner body — small rectangular device
    draw.rounded_rectangle([CX+22, CY-36, CX+40, CY-18], radius=3, fill=SUIT_L+(245,))
    draw.rectangle([CX+24, CY-34, CX+38, CY-20], fill=VISOR)
    # Gold accent strip on scanner
    draw.rectangle([CX+22, CY-38, CX+40, CY-36], fill=GOLD+(230,))
    # Scanner lens
    draw.ellipse([CX+28, CY-32, CX+36, CY-24], fill=SCAN_B+(200,))
    draw.ellipse([CX+30, CY-30, CX+34, CY-26], fill=(200,240,255,220,))

    # Scanner beam / pulse arc emanating from lens
    for radius in [10, 16, 22]:
        alpha = max(30, 110 - radius * 4)
        draw.arc([CX+31-radius, CY-28-radius, CX+33+radius, CY-26+radius],
                 start=-60, end=60, fill=SCAN_B+(alpha,), width=1)

    # ── Head ─────────────────────────────────────────────────────────────────
    # Helmet / hat brim
    draw.ellipse([CX-15, CY-32, CX+15, CY-10], fill=SUIT+(250,))
    # Hat band — gold
    draw.rectangle([CX-15, CY-20, CX+15, CY-17], fill=GOLD+(220,))
    # Face
    draw.ellipse([CX-10, CY-28, CX+10, CY-14], fill=SKIN+(240,))
    # Visor strip / goggles
    draw.rectangle([CX-9, CY-26, CX+9, CY-21], fill=VISOR)
    # Goggles highlight
    draw.ellipse([CX-7, CY-25, CX-2, CY-22], fill=(180,230,255,130,))

    img = img.filter(ImageFilter.GaussianBlur(0.5))
    img.save(os.path.join(OUT, 'agent.png'))
    print('  ✓ agent.png')


# ═══════════════════════════════════════════════════════════════════════════════
# (c) UI PACK  — 5 glyphs × 128×128 on a single 640×128 sheet
#  [0] scanner icon  [1] scan-pulse ring  [2] food-web link node
#  [3] resource coin (¤)  [4] health-leaf
# ═══════════════════════════════════════════════════════════════════════════════

GOLD  = (215, 175,  45, 255)
GOLDD = (160, 125,  25, 255)
CREAM = (240, 230, 195, 255)
TEAL  = ( 80, 195, 220, 255)
GREEN = ( 80, 195, 100, 255)
NONE  = (  0,   0,   0,   0)
LINE  = 3   # stroke width for most glyphs

def glyph_canvas():
    g = Image.new('RGBA', (128, 128), NONE)
    return g, ImageDraw.Draw(g)

# ── Glyph 0 : Scanner icon ───────────────────────────────────────────────────
def make_glyph_scanner():
    g, d = glyph_canvas()
    cx, cy = 64, 64
    # Outer scanner frame — rounded rect
    d.rounded_rectangle([cx-30, cy-30, cx+30, cy+30], radius=8,
                         outline=GOLD, width=LINE, fill=NONE)
    # Inner lens circle
    d.ellipse([cx-16, cy-16, cx+16, cy+16], outline=CREAM, width=2, fill=NONE)
    # Cross-hairs
    d.line([(cx-9, cy), (cx+9, cy)], fill=CREAM, width=1)
    d.line([(cx, cy-9), (cx, cy+9)], fill=CREAM, width=1)
    # Corner brackets (top-left, top-right, bottom-left, bottom-right)
    br = 8
    for sx, sy in [(-1,-1),(1,-1),(-1,1),(1,1)]:
        bx, by = cx + sx*26, cy + sy*26
        d.line([(bx, by), (bx + sx*br, by)], fill=GOLD, width=LINE)
        d.line([(bx, by), (bx, by + sy*br)], fill=GOLD, width=LINE)
    # Central dot
    d.ellipse([cx-4, cy-4, cx+4, cy+4], fill=GOLD)
    return g

# ── Glyph 1 : Scan-pulse ring ────────────────────────────────────────────────
def make_glyph_pulse():
    g, d = glyph_canvas()
    cx, cy = 64, 64
    # Three concentric arcs, decreasing opacity outward
    for r, alpha in [(18, 255), (30, 180), (42, 100), (54, 50)]:
        col = (TEAL[0], TEAL[1], TEAL[2], alpha)
        d.ellipse([cx-r, cy-r, cx+r, cy+r], outline=col, width=LINE)
    # Dashed outer ring — 8 dots
    r_dash = 54
    for i in range(12):
        a = math.radians(i * 30)
        dx, dy = math.cos(a) * r_dash, math.sin(a) * r_dash
        d.ellipse([cx+dx-3, cy+dy-3, cx+dx+3, cy+dy+3], fill=TEAL[:3]+(60,))
    # Centre filled dot
    d.ellipse([cx-6, cy-6, cx+6, cy+6], fill=TEAL)
    d.ellipse([cx-3, cy-3, cx+3, cy+3], fill=CREAM)
    return g

# ── Glyph 2 : Food-web link node ─────────────────────────────────────────────
def make_glyph_linknode():
    g, d = glyph_canvas()
    cx, cy = 64, 64
    # Central node
    d.ellipse([cx-10, cy-10, cx+10, cy+10], fill=GOLD, outline=CREAM, width=2)
    # Six satellite nodes and edges
    sat_r  = 36
    node_r = 7
    positions = []
    for i in range(6):
        a = math.radians(i * 60 - 30)
        sx = int(cx + math.cos(a) * sat_r)
        sy = int(cy + math.sin(a) * sat_r)
        positions.append((sx, sy))
    # Draw edges first (below nodes)
    for i, (sx, sy) in enumerate(positions):
        d.line([(cx, cy), (sx, sy)], fill=CREAM[:3]+(160,), width=1)
        # cross-edge to next satellite (ring)
        nx, ny = positions[(i+1) % 6]
        d.line([(sx, sy), (nx, ny)], fill=GOLD[:3]+(80,), width=1)
    # Draw satellite nodes
    for i, (sx, sy) in enumerate(positions):
        col = GOLD if i % 2 == 0 else CREAM
        d.ellipse([sx-node_r, sy-node_r, sx+node_r, sy+node_r],
                  fill=col, outline=CREAM[:3]+(180,), width=1)
    # Re-draw centre on top
    d.ellipse([cx-10, cy-10, cx+10, cy+10], fill=GOLD, outline=CREAM, width=2)
    return g

# ── Glyph 3 : Resource coin (¤) ──────────────────────────────────────────────
def make_glyph_coin():
    g, d = glyph_canvas()
    cx, cy = 64, 64
    # Coin body — layered circles for depth
    d.ellipse([cx-28, cy-28, cx+28, cy+28], fill=GOLDD)
    d.ellipse([cx-26, cy-28, cx+26, cy+26], fill=GOLD)   # highlight shift
    d.ellipse([cx-23, cy-23, cx+23, cy+23], fill=GOLDD)  # inner shadow ring
    d.ellipse([cx-21, cy-21, cx+21, cy+21], fill=GOLD)
    # Currency mark ¤ — circle with 4 radiating lines
    r_inner = 9
    d.ellipse([cx-r_inner, cy-r_inner, cx+r_inner, cy+r_inner],
              outline=CREAM, width=2, fill=NONE)
    for a in [45, 135, 225, 315]:
        rad = math.radians(a)
        x0 = cx + math.cos(rad) * (r_inner - 1)
        y0 = cy + math.sin(rad) * (r_inner - 1)
        x1 = cx + math.cos(rad) * (r_inner + 7)
        y1 = cy + math.sin(rad) * (r_inner + 7)
        d.line([(int(x0),int(y0)),(int(x1),int(y1))], fill=CREAM, width=2)
    # Shine highlight
    d.ellipse([cx-20, cy-24, cx-4, cy-12], fill=(255,240,160,70,))
    return g

# ── Glyph 4 : Health-leaf marker ─────────────────────────────────────────────
def make_glyph_leaf():
    g, d = glyph_canvas()
    cx, cy = 64, 64

    # Leaf shape — teardrop polygon
    leaf_pts = []
    for i in range(60):
        a   = math.radians(i * 6 - 90)   # 0 → top
        # parametric leaf: r varies with angle
        # upper lobe: bigger; lower tip: pointy
        ta  = (a + math.pi/2) / math.pi   # 0..2 normalised
        r   = 28 * (math.sin(a + math.pi/2) * 0.7 + 0.3)
        if a > 0:   # lower half → taper to tip
            r *= max(0.15, 1 - (a / math.pi) * 0.85)
        lx  = cx + math.cos(a) * r
        ly  = cy + math.sin(a) * r - 6   # shift slightly up
        leaf_pts.append((lx, ly))

    d.polygon(leaf_pts, fill=GREEN[:3]+(230,), outline=GOLD[:3]+(200,))

    # Central vein
    d.line([(cx, cy+20), (cx, cy-26)], fill=GOLD[:3]+(200,), width=2)
    # Side veins
    for i, (va, vl) in enumerate([(-35,10),(-20,15),(20,15),(35,10)]):
        rad  = math.radians(va)
        vy   = cy + 14 - i*8 if i < 2 else cy + 14 - (3-i)*8
        vy   = cy + 16 - i * 9
        d.line([(cx, vy),
                (int(cx + math.cos(rad)*vl), int(vy + math.sin(rad)*vl*0.5))],
               fill=GOLD[:3]+(160,), width=1)

    # Health percentage arc around leaf (Pristine = full circle)
    for r_arc in [38, 40]:
        d.arc([cx-r_arc, cy-r_arc-6, cx+r_arc, cy+r_arc-6],
              start=-200, end=20, fill=GREEN[:3]+(120,), width=LINE)

    # Top shine
    d.ellipse([cx-8, cy-28, cx+2, cy-18], fill=(220,255,220,80,))
    return g

def make_ui_pack():
    glyphs = [
        make_glyph_scanner(),
        make_glyph_pulse(),
        make_glyph_linknode(),
        make_glyph_coin(),
        make_glyph_leaf(),
    ]
    # Apply subtle gaussian to each glyph
    glyphs = [g.filter(ImageFilter.GaussianBlur(0.5)) for g in glyphs]

    sheet = Image.new('RGBA', (640, 128), (0, 0, 0, 0))
    for i, g in enumerate(glyphs):
        sheet.paste(g, (i * 128, 0), g)

    sheet.save(os.path.join(OUT, 'ui_pack.png'))
    print('  ✓ ui_pack.png  (640×128, 5 glyphs)')

# ═══════════════════════════════════════════════════════════════════════════════
# RUN
# ═══════════════════════════════════════════════════════════════════════════════
print('(a) Extinct silhouettes...')
make_extinct('sprite_seagrass.png', 'sprite_seagrass_extinct.png')
make_extinct('sprite_shrimp.png',   'sprite_shrimp_extinct.png')
make_extinct('sprite_heron.png',    'sprite_heron_extinct.png')

print('(b) Agent sprite...')
make_agent()

print('(c) UI glyph pack...')
make_ui_pack()

print('Done.')
