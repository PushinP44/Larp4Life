"""
gen_crab.py  —  Ecosystem X crab sprite generator (companion to gen_sprites.py)
Produces 2 × 128×128 RGBA PNG sprite markers (top-down view):
  sprite_crab.png          — mangrove mud crab top-down, mottled orange-brown
  sprite_crab_extinct.png  — desaturated husk variant for the extinct state
Same visual language as gen_sprites.py: soft shadow, reads at small sizes
against dark marsh/water tiles.
Output → /assets/images/
"""

import math, os
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'images')
os.makedirs(OUT, exist_ok=True)

W, H = 128, 128
CX, CY = W // 2, H // 2

def lerp(a, b, t): return a + (b - a) * t


def make_crab():
    img  = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Colours — mangrove mud crab: warm orange-brown, dark mottling
    SHELL  = (188,  95,  42)   # carapace main
    SHELL_D= (140,  62,  25)   # carapace shading / mottle
    SHELL_L= (225, 140,  70)   # highlight
    CLAW   = (205, 105,  45)
    CLAW_TIP=(240, 200, 150)
    LEG    = (160,  78,  32, 230)
    EYE    = ( 25,  18,  10, 255)

    # Soft ground shadow so it reads on any tile
    for r in range(30, 0, -1):
        alpha = int(110 * (1 - r / 30))
        draw.ellipse([CX-r, CY-r//2+6, CX+r, CY+r//2+6], fill=(20, 12, 5, alpha))

    # ── Walking legs — 4 per side, jointed, splayed outward ─────────────────
    for side in (-1, 1):
        for i in range(4):
            ang  = math.radians(28 + i * 26)          # 28°..106° fan
            hipx = CX + side * 22
            hipy = CY - 14 + i * 9
            kx   = hipx + side * math.cos(ang) * 16
            ky   = hipy + math.sin(ang) * 6 - 4
            fx   = kx + side * math.cos(ang) * 14
            fy   = ky + math.sin(ang) * 14
            draw.line([(hipx, hipy), (kx, ky)], fill=LEG, width=4)
            draw.line([(kx, ky), (fx, fy)], fill=LEG, width=3)
            draw.ellipse([fx-2, fy-2, fx+2, fy+2], fill=(120, 55, 20, 220))

    # ── Claws (chelipeds) — two big pincers front-left/front-right ──────────
    for side in (-1, 1):
        armx0, army0 = CX + side * 18, CY - 16
        armx1, army1 = CX + side * 34, CY - 28
        draw.line([(armx0, army0), (armx1, army1)], fill=CLAW+(240,), width=6)
        # pincer bulb
        draw.ellipse([armx1-9, army1-9, armx1+9, army1+9], fill=CLAW+(245,))
        draw.ellipse([armx1-9, army1-9, armx1+3, army1+3], fill=SHELL_L+(120,))
        # pincer gap (open claw) — two small teeth
        tipa = (armx1 + side * 7, army1 - 9)
        tipb = (armx1 + side * 9, army1 - 2)
        draw.line([(armx1, army1), tipa], fill=CLAW_TIP+(235,), width=3)
        draw.line([(armx1, army1), tipb], fill=CLAW_TIP+(235,), width=3)

    # ── Carapace — wide oval, subtly hexagonal, mottled ──────────────────────
    draw.ellipse([CX-24, CY-18, CX+24, CY+20], fill=SHELL+(248,))
    # rim shading (bottom-right)
    draw.arc([CX-24, CY-18, CX+24, CY+20], start=20, end=160, fill=SHELL_D+(255,), width=3)
    # carapace ridge highlight (top-left)
    draw.ellipse([CX-16, CY-13, CX+8, CY+1], fill=SHELL_L+(90,))
    # deterministic mottle spots (no random — fixed pattern like prng rule)
    mottle = [(-12, -6, 3), (6, -9, 2), (-3, 4, 3), (13, 3, 2), (2, 12, 3), (-14, 8, 2)]
    for mx, my, mr in mottle:
        draw.ellipse([CX+mx-mr, CY+my-mr, CX+mx+mr, CY+my+mr], fill=SHELL_D+(160,))
    # front notch between the eyes
    draw.ellipse([CX-4, CY-21, CX+4, CY-13], fill=SHELL+(248,))

    # ── Eye stalks — two forward dots on short stalks ─────────────────────────
    for side in (-1, 1):
        sx = CX + side * 7
        draw.line([(sx, CY-16), (sx + side * 2, CY-24)], fill=SHELL_D+(255,), width=3)
        draw.ellipse([sx+side*2-3, CY-27, sx+side*2+3, CY-21], fill=EYE)
        draw.ellipse([sx+side*2-1, CY-26, sx+side*2+1, CY-24], fill=(255, 240, 210, 255))

    img = img.filter(ImageFilter.GaussianBlur(0.55))
    img.save(os.path.join(OUT, 'sprite_crab.png'))
    print('  ok sprite_crab.png')
    return img


def make_crab_extinct(base):
    # Extinct = desaturated, darkened husk (same silhouette, reads as loss)
    g = base.convert('LA').convert('RGBA')
    g = ImageEnhance.Brightness(g).enhance(0.55)
    # keep original alpha
    g.putalpha(base.split()[3])
    g.save(os.path.join(OUT, 'sprite_crab_extinct.png'))
    print('  ok sprite_crab_extinct.png')


if __name__ == '__main__':
    print('Generating crab sprites -> assets/images/')
    crab = make_crab()
    make_crab_extinct(crab)
    print('Done.')
