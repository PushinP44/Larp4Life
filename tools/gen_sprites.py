"""
gen_sprites.py  —  Ecosystem X species/hazard sprite generator
Produces 4 × 128×128 RGBA PNG sprite markers (top-down view):
  sprite_seagrass.png  — seagrass tuft, vivid green
  sprite_shrimp.png    — tiger prawn top-down, blue-grey
  sprite_heron.png     — painted stork wings-spread overhead, gold/white
  sprite_runoff.png    — pollution hazard marker, rust-red
Designed to read clearly at small sizes against dark water tiles.
Output → /assets/
"""

import math, random, os
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), '..', 'assets')
os.makedirs(OUT, exist_ok=True)

W, H = 128, 128
CX, CY = W // 2, H // 2

def clamp(v): return max(0, min(255, int(v)))
def lerp(a, b, t): return a + (b - a) * t

rng = random.Random(7)

# ── SPRITE 1 : sprite_seagrass.png ───────────────────────────────────────────
def make_seagrass():
    img  = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Shadow / root base — dark oval glow so it reads on water
    for r in range(30, 0, -1):
        alpha = int(120 * (1 - r / 30))
        draw.ellipse([CX-r, CY-r//2+8, CX+r, CY+r//2+8],
                     fill=(10, 60, 20, alpha))

    # Blade parameters: (angle_deg, length, width, base_green, tip_green)
    blades = [
        (-75, 46, 4, (30,160, 55), (80,220, 90)),
        (-50, 52, 4, (25,145, 45), (70,205, 80)),
        (-20, 58, 5, (20,155, 50), (75,215, 85)),
        (  5, 60, 5, (22,160, 52), (78,220, 88)),
        ( 30, 55, 4, (28,150, 48), (72,210, 82)),
        ( 55, 48, 4, (32,158, 54), (80,218, 90)),
        ( 78, 42, 3, (26,148, 46), (68,200, 78)),
        (-95, 38, 3, (35,165, 58), (82,222, 92)),
        ( 12, 44, 3, (18,140, 44), (66,198, 76)),
        (-38, 50, 3, (30,155, 50), (76,212, 84)),
    ]

    for ang, length, bw, col_base, col_tip in blades:
        rad = math.radians(ang - 90)   # -90 → upward default
        # draw as tapered bezier approximation via poly segments
        pts = []
        for i in range(length + 1):
            t  = i / length
            # slight curve: blade bends toward tip
            curve = math.sin(t * math.pi) * 8
            side  = math.radians(ang - 90 + 90)   # perpendicular
            px = CX + math.cos(rad) * i + math.cos(side) * curve * 0.3
            py = CY + math.sin(rad) * i + math.sin(side) * curve * 0.3
            w2 = max(1.0, bw * (1 - t * 0.75))
            col = tuple(int(lerp(a, b, t)) for a, b in zip(col_base, col_tip))
            alpha = int(lerp(240, 180, t))
            draw.ellipse([px-w2, py-w2, px+w2, py+w2], fill=col+(alpha,))

    # Small highlight dots at blade tips
    for ang, length, bw, _, col_tip in blades[:6]:
        rad = math.radians(ang - 90)
        curve = math.sin(math.pi) * 8 * 0.3
        tx = CX + math.cos(rad) * length
        ty = CY + math.sin(rad) * length
        draw.ellipse([tx-2, ty-2, tx+2, ty+2], fill=col_tip+(200,))

    img = img.filter(ImageFilter.GaussianBlur(0.6))
    img.save(os.path.join(OUT, 'sprite_seagrass.png'))
    print('  ✓ sprite_seagrass.png')


# ── SPRITE 2 : sprite_shrimp.png ─────────────────────────────────────────────
def make_shrimp():
    img  = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Colours
    BODY  = ( 85, 110, 145)   # blue-grey carapace
    STRIPE= ( 50,  72, 105)   # dark stripe
    SHELL = (110, 140, 175)   # lighter highlight
    TAIL  = ( 70,  95, 130)
    LEG   = ( 95, 120, 155, 180)
    EYE   = (220,  60,  30, 255)   # bright red eye — reads at small size
    ANTENNA=(120, 150, 185, 200)

    # Shadow
    for r in range(28, 0, -1):
        alpha = int(100 * (1 - r / 28))
        draw.ellipse([CX-r, CY-r//3, CX+r, CY+r//3], fill=(0,20,40,alpha))

    # Body — elongated oval, horizontal, slight curve handled by segments
    # Carapace (head+thorax): larger front half
    draw.ellipse([CX-30, CY-13, CX+10, CY+13], fill=BODY+(240,))
    # Abdomen segments (6 segments tapering to tail)
    seg_w = [11, 10, 9, 8, 7, 5]
    seg_h = [11, 10,  9, 8, 7, 5]
    seg_x = CX + 10
    for i, (sw, sh) in enumerate(zip(seg_w, seg_h)):
        cx2 = seg_x + i * 10 + sw // 2
        col = STRIPE if i % 2 == 0 else BODY
        draw.ellipse([cx2-sw, CY-sh, cx2+sw, CY+sh], fill=col+(235,))

    # Highlight stripe along carapace
    draw.ellipse([CX-26, CY-7, CX+6, CY+1], fill=SHELL+(160,))

    # Tail fan (uropods)
    tail_cx = seg_x + 6 * 10 + 10
    fan_angles = [-35, -18, 0, 18, 35]
    for fa in fan_angles:
        rad = math.radians(fa)
        fx  = tail_cx + math.cos(rad) * 14
        fy  = CY      + math.sin(rad) * 10
        draw.line([(tail_cx, CY), (int(fx), int(fy))], fill=TAIL+(210,), width=2)
        draw.ellipse([int(fx)-3, int(fy)-2, int(fx)+3, int(fy)+2], fill=TAIL+(190,))

    # Walking legs (pleopods) — 5 pairs, below body
    for i in range(5):
        lx = CX - 22 + i * 10
        # lower leg
        draw.line([(lx, CY+11), (lx-3, CY+22)], fill=LEG, width=1)
        # upper leg
        draw.line([(lx, CY-11), (lx-2, CY-21)], fill=LEG, width=1)

    # Chelipeds (front claws) — two longer front appendages
    for dy in [-6, 6]:
        draw.line([(CX-30, CY+dy), (CX-46, CY+dy*1.6)], fill=LEG, width=2)
        # claw tips
        cx3, cy3 = CX-46, int(CY+dy*1.6)
        draw.ellipse([cx3-3, cy3-3, cx3+3, cy3+3], fill=BODY+(220,))

    # Antennae — two long thin lines from head
    for side, length in [(-1, 40), (1, 34)]:
        ax0, ay0 = CX-30, CY + side*5
        ax1 = ax0 - 30
        ay1 = ay0 + side * 18
        draw.line([(ax0,ay0),(ax1,ay1)], fill=ANTENNA, width=1)

    # Eyes — two bright red dots
    for side in [-1, 1]:
        ex, ey = CX-32, CY + side * 8
        draw.ellipse([ex-3, ey-3, ex+3, ey+3], fill=EYE)
        draw.ellipse([ex-1, ey-1, ex+1, ey+1], fill=(255,200,180,255))

    img = img.filter(ImageFilter.GaussianBlur(0.5))
    img.save(os.path.join(OUT, 'sprite_shrimp.png'))
    print('  ✓ sprite_shrimp.png')


# ── SPRITE 3 : sprite_heron.png ──────────────────────────────────────────────
def make_heron():
    img  = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Painted stork overhead — wings spread wide, white/gold plumage
    WHITE  = (240, 238, 228)
    GOLD   = (220, 175,  55)
    DARK   = ( 40,  35,  25)      # dark flight feather tips
    PINK   = (210, 120,  90)      # bare pink facial skin
    BILL   = (195, 145,  30, 240) # yellow-orange bill
    BODY_C = (235, 230, 215)      # body centre

    # Shadow
    for r in range(38, 0, -1):
        alpha = int(90 * (1 - r / 38))
        draw.ellipse([CX-r, CY-r//2, CX+r, CY+r//2], fill=(0,10,20,alpha))

    # ── Wings (symmetric, drawn as filled polygons) ──────────────────────────
    # Left wing  (viewer's left = bird's right)
    lw = [
        (CX,    CY-4),   # root at body
        (CX-14, CY-18),  # leading edge shoulder
        (CX-42, CY-26),  # wingtip leading
        (CX-58, CY-16),  # outer primary tip
        (CX-54, CY- 4),  # mid trailing
        (CX-36, CY+ 8),  # inner trailing
        (CX-14, CY+ 8),  # root trailing
    ]
    rw = [(W-x+CX*2-W, y) for x, y in lw]   # mirror for right wing… simpler:
    rw = [
        (CX,    CY-4),
        (CX+14, CY-18),
        (CX+42, CY-26),
        (CX+58, CY-16),
        (CX+54, CY- 4),
        (CX+36, CY+ 8),
        (CX+14, CY+ 8),
    ]

    draw.polygon(lw, fill=WHITE+(235,))
    draw.polygon(rw, fill=WHITE+(235,))

    # Gold wing-bar stripe across coverts
    gold_lw = [
        (CX-6,  CY-10),
        (CX-28, CY-20),
        (CX-44, CY-22),
        (CX-42, CY-15),
        (CX-24, CY-12),
        (CX-8,  CY- 5),
    ]
    gold_rw = [
        (CX+6,  CY-10),
        (CX+28, CY-20),
        (CX+44, CY-22),
        (CX+42, CY-15),
        (CX+24, CY-12),
        (CX+8,  CY- 5),
    ]
    draw.polygon(gold_lw, fill=GOLD+(200,))
    draw.polygon(gold_rw, fill=GOLD+(200,))

    # Dark primary feather tips
    for i, (px, py) in enumerate([
        (CX-54, CY-12), (CX-58, CY-16), (CX-52, CY-22), (CX-46, CY-26),
    ]):
        draw.ellipse([px-5, py-4, px+5, py+4], fill=DARK+(200,))
    for i, (px, py) in enumerate([
        (CX+54, CY-12), (CX+58, CY-16), (CX+52, CY-22), (CX+46, CY-26),
    ]):
        draw.ellipse([px-5, py-4, px+5, py+4], fill=DARK+(200,))

    # Body oval
    draw.ellipse([CX-12, CY-8, CX+12, CY+16], fill=BODY_C+(245,))

    # Head — small circle, white with bare pink face patch
    draw.ellipse([CX-8, CY-22, CX+8, CY-6], fill=WHITE+(245,))
    draw.ellipse([CX-5, CY-20, CX+5, CY-10], fill=PINK+(220,))

    # Bill — downward pointing wedge (top-down: extends forward/down)
    bill_pts = [(CX-3, CY-22), (CX+3, CY-22), (CX+1, CY-36), (CX-1, CY-36)]
    draw.polygon(bill_pts, fill=BILL)

    # Eye dots
    for ex in [CX-5, CX+5]:
        draw.ellipse([ex-2, CY-18, ex+2, CY-14], fill=DARK+(255,))
        draw.ellipse([ex-1, CY-17, ex+1, CY-15], fill=(255,255,200,255))

    # Tail feathers — small fan below body
    for ta in [-20, -8, 0, 8, 20]:
        rad = math.radians(90 + ta)
        tx  = CX + math.cos(rad) * 20
        ty  = CY + math.sin(rad) * 20 + 16
        draw.line([(CX, CY+14), (int(tx), int(ty))], fill=WHITE+(200,), width=2)

    img = img.filter(ImageFilter.GaussianBlur(0.55))
    img.save(os.path.join(OUT, 'sprite_heron.png'))
    print('  ✓ sprite_heron.png')


# ── SPRITE 4 : sprite_runoff.png ─────────────────────────────────────────────
def make_runoff():
    img  = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    RUST1  = (190,  65,  30)   # rust-red main
    RUST2  = (150,  40,  15)   # dark rust
    WARN   = (230, 110,  20)   # warning orange
    PLUME  = (160,  85,  10, 180)   # toxic plume
    DRIP   = (140,  55,  10, 200)
    SKULL_W= (235, 220, 200)   # skull icon on badge
    BADGE  = ( 40,  20,  10, 220)

    # Outer glow / aura — pulsing hazard ring
    for r in range(52, 28, -2):
        t = (r - 28) / 24
        alpha = int(80 * (1 - t))
        col = (int(lerp(RUST1[0], 255, t)),
               int(lerp(RUST1[1], 80, t)),
               int(lerp(RUST1[2], 0, t)), alpha)
        draw.ellipse([CX-r, CY-r, CX+r, CY+r], fill=col)

    # Hazard badge — dark circle background
    draw.ellipse([CX-26, CY-26, CX+26, CY+26], fill=BADGE)
    draw.ellipse([CX-24, CY-24, CX+24, CY+24], fill=RUST1+(255,),
                 outline=WARN+(255,), width=2)

    # Warning symbol: exclamation mark !
    # Stem
    draw.rectangle([CX-3, CY-16, CX+3, CY+4], fill=SKULL_W+(240,))
    # Dot
    draw.ellipse([CX-4, CY+8, CX+4, CY+16], fill=SKULL_W+(240,))

    # Pollution plume drips radiating from badge (N/E/S/W + diagonals)
    plume_angles = [90, 45, 135, 20, 160, 70, 110]
    for i, angle in enumerate(plume_angles):
        rad   = math.radians(angle)
        r_start = 28
        r_end   = 42 + (i % 3) * 6
        # plume blob along direction
        steps = 8
        for s in range(steps):
            t2  = s / steps
            r2  = r_start + (r_end - r_start) * t2
            px  = CX + math.cos(rad) * r2
            py  = CY + math.sin(rad) * r2
            size = max(1.5, 5 * (1 - t2))
            alpha = int(180 * (1 - t2))
            draw.ellipse([px-size, py-size, px+size, py+size],
                         fill=PLUME[:3]+(alpha,))

    # Corner drip streaks for visual interest
    for angle in [30, 75, 120, 150]:
        rad   = math.radians(angle)
        x0    = int(CX + math.cos(rad) * 30)
        y0    = int(CY + math.sin(rad) * 30)
        x1    = int(CX + math.cos(rad) * 52)
        y1    = int(CY + math.sin(rad) * 52)
        draw.line([(x0, y0), (x1, y1)], fill=DRIP, width=2)

    img = img.filter(ImageFilter.GaussianBlur(0.6))
    img.save(os.path.join(OUT, 'sprite_runoff.png'))
    print('  ✓ sprite_runoff.png')


# ── run ───────────────────────────────────────────────────────────────────────
print('Generating species/hazard sprites → assets/')
make_seagrass()
make_shrimp()
make_heron()
make_runoff()
print('Done.')
