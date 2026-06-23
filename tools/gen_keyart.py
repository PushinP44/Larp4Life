#!/usr/bin/env python3
"""
gen_keyart.py — composes assets/images/keyart.png from the REAL game assets
(tiles, props, species sprites) into a 1600x1000 cover, split healthy↔collapsing,
with the title. Deterministic; run again any time to regenerate.
"""
import os, math
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG  = os.path.join(ROOT, "assets", "images")
W, H = 1600, 1000
SPLIT = 0.56  # left = healthy, right = collapsing

def load(name):
    p = os.path.join(IMG, name)
    return Image.open(p).convert("RGBA") if os.path.exists(p) else None

def font(path, size):
    for p in (path, "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
              "/Library/Fonts/Arial.ttf"):
        try: return ImageFont.truetype(p, size)
        except Exception: continue
    return ImageFont.load_default()

def sicken(im, amt):
    """Desaturate + darken a sprite for the collapsing side (amt 0..1)."""
    if im is None: return None
    im = ImageEnhance.Color(im).enhance(1 - 0.85 * amt)
    im = ImageEnhance.Brightness(im).enhance(1 - 0.30 * amt)
    return im

def paste(base, im, cx, cy, scale=1.0, anchor_bottom=False):
    if im is None: return
    s = im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))), Image.LANCZOS)
    x = int(cx - s.width / 2)
    y = int(cy - s.height) if anchor_bottom else int(cy - s.height / 2)
    base.alpha_composite(s, (x, y))

# ── 1. Background: vertical gradient sky→ground ───────────────────────────────
base = Image.new("RGBA", (W, H), (0, 0, 0, 255))
top, bot = (12, 30, 26), (20, 34, 26)
for y in range(H):
    t = y / H
    r = int(top[0] + (bot[0] - top[0]) * t)
    g = int(top[1] + (bot[1] - top[1]) * t)
    b = int(top[2] + (bot[2] - top[2]) * t)
    ImageDraw.Draw(base).line([(0, y), (W, y)], fill=(r, g, b, 255))

# ── 2. Tiled ground (lower ~48%), healthy left / toxic right ──────────────────
TS = 116
gtop = int(H * 0.50)
tiles_h = {k: load(f"tile_{k}.png") for k in ("water", "marsh", "land")}
tiles_t = {k: load(f"tile_{k}_toxic.png") for k in ("water", "marsh", "land")}
def ground_type(col, row, cols, rows):
    # a lake lower-right; marsh band; land elsewhere
    if row >= rows - 2 and col > cols * 0.5: return "water"
    if (col + row) % 3 == 0: return "marsh"
    return "land" if (col * 7 + row * 13) % 5 < 2 else "marsh"
cols = W // TS + 2
rows = (H - gtop) // TS + 2
for row in range(rows):
    for col in range(cols):
        x = col * TS - TS // 2
        y = gtop + row * TS - TS // 2
        toxic = (x + TS / 2) / W > SPLIT
        k = ground_type(col, row, cols, rows)
        tile = (tiles_t if toxic else tiles_h)[k]
        if tile:
            base.alpha_composite(tile.resize((TS + 2, TS + 2), Image.LANCZOS), (x, y))

# ── 3. Scatter props across the ground (healthy lush, toxic sparse/sick) ──────
props = {n: load(f"prop_{n}.png") for n in
         ("tree", "bush", "reeds", "rock", "flowers", "lilypad", "stump", "grass")}
scatter = [  # (prop, x, y, scale)  — left side
    ("tree", 180, 720, 1.7), ("tree", 470, 640, 1.3), ("bush", 330, 770, 1.3),
    ("flowers", 250, 830, 1.4), ("reeds", 560, 810, 1.4), ("grass", 120, 860, 1.6),
    ("rock", 430, 860, 1.2), ("flowers", 600, 700, 1.2), ("bush", 700, 880, 1.2),
    ("tree", 60, 980, 1.5),
]
scatter_t = [  # right side — sickly
    ("stump", 1050, 760, 1.4), ("rock", 1230, 720, 1.3), ("reeds", 1150, 850, 1.2),
    ("stump", 1420, 840, 1.3), ("lilypad", 1300, 950, 1.3), ("grass", 1500, 800, 1.2),
    ("rock", 980, 900, 1.1),
]
for n, x, y, s in scatter:
    paste(base, props[n], x, y, s, anchor_bottom=True)
for n, x, y, s in scatter_t:
    paste(base, sicken(props[n], 0.85), x, y, s, anchor_bottom=True)

# ── 4. Hero species + agent (the food web), runoff on the toxic side ──────────
paste(base, load("sprite_seagrass.png"), 410, 905, 1.7, anchor_bottom=True)
paste(base, load("sprite_shrimp.png"),   640, 940, 1.6, anchor_bottom=True)
paste(base, load("sprite_heron.png"),    245, 690, 2.1, anchor_bottom=True)
paste(base, load("agent.png"),           820, 980, 1.9, anchor_bottom=True)
paste(base, sicken(load("sprite_heron_extinct.png"), 0.6), 1180, 690, 1.6, anchor_bottom=True)
paste(base, load("sprite_runoff.png"),   1360, 660, 1.7, anchor_bottom=True)

# ── 5. Vignette ───────────────────────────────────────────────────────────────
vig = Image.new("L", (W, H), 0)
vd = ImageDraw.Draw(vig)
vd.ellipse([-W * 0.25, -H * 0.25, W * 1.25, H * 1.25], fill=255)
vig = vig.filter(ImageFilter.GaussianBlur(180))
dark = Image.new("RGBA", (W, H), (4, 8, 10, 255))
dark.putalpha(Image.eval(vig, lambda v: 150 - int(v * 150 / 255)))
base.alpha_composite(dark)

# ── 6. Title block ────────────────────────────────────────────────────────────
d = ImageDraw.Draw(base)
def centered(txt, fnt, y, fill, shadow=(0, 0, 0, 200), sh=4, spacing=0):
    if spacing:
        # manual letter-spacing
        widths = [d.textlength(c, font=fnt) + spacing for c in txt]
        total = sum(widths) - spacing
        x = (W - total) / 2
        for c, cw in zip(txt, widths):
            d.text((x + sh, y + sh), c, font=fnt, fill=shadow)
            d.text((x, y), c, font=fnt, fill=fill)
            x += cw
    else:
        tw = d.textlength(txt, font=fnt)
        x = (W - tw) / 2
        d.text((x + sh, y + sh), txt, font=fnt, fill=shadow)
        d.text((x, y), txt, font=fnt, fill=fill)

BLACK = "/System/Library/Fonts/Supplemental/Arial Black.ttf"
BOLD  = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
centered("ECOSYSTEM X", font(BLACK, 150), 90, (240, 165, 0, 255), sh=5)
centered("THE LAST BALANCE", font(BOLD, 46), 250, (245, 240, 232, 255), spacing=14, sh=3)
centered("A coastal wetland is collapsing — uncover the hidden food web,",
         font(BOLD, 26), 332, (200, 214, 205, 255), sh=2)
centered("find the root stressor, and restore the balance.",
         font(BOLD, 26), 368, (200, 214, 205, 255), sh=2)

# footer
foot = font(BOLD, 22)
ft = "Track 1 · Biodiversity & Environmental Protection   |   #CodeBuddy #TencentCloudHackathon"
tw = d.textlength(ft, font=foot)
d.text(((W - tw) / 2 + 2, H - 46 + 2), ft, font=foot, fill=(0, 0, 0, 180))
d.text(((W - tw) / 2, H - 46), ft, font=foot, fill=(127, 209, 255, 255))

out = os.path.join(IMG, "keyart.png")
base.convert("RGBA").save(out)
print("wrote", out, base.size)
