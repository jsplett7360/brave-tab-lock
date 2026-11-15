#!/usr/bin/env python3
"""Regenerate store/promo-small-440x280.png (dev tool, stdlib only).

Chrome Web Store small promo tile: 440x280, opaque (24-bit RGB PNG, no alpha).
Content: lock motif + the name "Tab Lock" only. The store's image guidelines say
"Avoid text", so there is no tagline. The letters are drawn from simple strokes, so no
font files are needed.
"""
import math
import os
import struct
import sys
import zlib

W, H = 440, 280
SS = 4  # supersampling per axis
BG_TOP = (52, 98, 222)
BG_BOTTOM = (35, 72, 180)
FG = (255, 255, 255)


def png_rgb(path, w, h, rows):
    raw = b''.join(b'\x00' + bytes(r) for r in rows)
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


# ---- primitives: each is (bbox, inside(x, y) -> bool) -------------------------------
def seg(x1, y1, x2, y2, r):
    dx, dy = x2 - x1, y2 - y1
    L2 = dx * dx + dy * dy or 1e-9
    def inside(x, y):
        t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / L2))
        px, py = x1 + t * dx - x, y1 + t * dy - y
        return px * px + py * py <= r * r
    return (min(x1, x2) - r, min(y1, y2) - r, max(x1, x2) + r, max(y1, y2) + r), inside


def ring(cx, cy, R, r, gap=None, upper_only=False):
    def inside(x, y):
        dx, dy = x - cx, y - cy
        d = math.hypot(dx, dy)
        if abs(d - R) > r:
            return False
        if upper_only and dy > 0:
            return False
        if gap is not None and abs(math.degrees(math.atan2(dy, dx))) < gap:
            return False
        return True
    return (cx - R - r, cy - R - r, cx + R + r, cy + R + r), inside


def rrect(x0, y0, x1, y1, rad, hole=None):
    def inside(x, y):
        if not (x0 <= x <= x1 and y0 <= y <= y1):
            return False
        cx = min(max(x, x0 + rad), x1 - rad); cy = min(max(y, y0 + rad), y1 - rad)
        if (x - cx) ** 2 + (y - cy) ** 2 > rad * rad:
            return False
        return not (hole and hole(x, y))
    return (x0, y0, x1, y1), inside


# ---- lock motif ----------------------------------------------------------------------
def lock_shapes(cx, top, size):
    s = size / 100.0
    r = 7.5 * s
    shapes = [
        ring(cx, top + 38 * s, 22 * s, r, upper_only=True),
        seg(cx - 22 * s, top + 38 * s, cx - 22 * s, top + 50 * s, r),
        seg(cx + 22 * s, top + 38 * s, cx + 22 * s, top + 50 * s, r),
    ]
    def keyhole(x, y):
        return (x - cx) ** 2 + (y - (top + 70 * s)) ** 2 <= (7 * s) ** 2 or (abs(x - cx) <= 3 * s and top + 70 * s <= y <= top + 84 * s)
    shapes.append(rrect(cx - 34 * s, top + 48 * s, cx + 34 * s, top + 98 * s, 8 * s, hole=keyhole))
    return shapes


# ---- wordmark "Tab Lock" ---------------------------------------------------------------
def wordmark(x, base, cap=56, xh=40, w=11):
    r = w / 2
    R = xh / 2 - r            # bowl radius (centre line)
    bowl = 2 * R + w          # bowl width
    gap = 9
    shapes = []
    def T(x0):
        wd = 40
        shapes.extend([seg(x0 + r, base - cap + r, x0 + wd - r, base - cap + r, r), seg(x0 + wd / 2, base - cap + r, x0 + wd / 2, base - r, r)])
        return wd
    def a(x0):
        cx = x0 + r + R
        shapes.extend([ring(cx, base - xh / 2, R, r), seg(cx + R, base - xh + r, cx + R, base - r, r)])
        return bowl
    def b(x0):
        cx = x0 + r + R
        shapes.extend([seg(x0 + r, base - cap + r, x0 + r, base - r, r), ring(cx, base - xh / 2, R, r)])
        return bowl
    def Lg(x0):
        wd = 32
        shapes.extend([seg(x0 + r, base - cap + r, x0 + r, base - r, r), seg(x0 + r, base - r, x0 + wd - r, base - r, r)])
        return wd
    def o(x0):
        shapes.append(ring(x0 + r + R, base - xh / 2, R, r))
        return bowl
    def c(x0):
        shapes.append(ring(x0 + r + R, base - xh / 2, R, r, gap=40))
        return bowl - 3
    def k(x0):
        wd = 33
        shapes.extend([
            seg(x0 + r, base - cap + r, x0 + r, base - r, r),
            seg(x0 + r + 2, base - xh * 0.38, x0 + wd - r, base - xh + r, r),
            seg(x0 + r + 9, base - xh * 0.55, x0 + wd - r, base - r, r),
        ])
        return wd
    def space(x0):
        return 14
    glyphs = [T, a, b, space, Lg, o, c, k]
    # measure (draw at 0, then discard), then draw centred on x
    cur = 0
    for g in glyphs:
        cur += g(cur) + gap
    total = cur - gap
    shapes.clear()
    cur = x - total / 2
    for g in glyphs:
        cur += g(cur) + gap
    return shapes


def render(path):
    shapes = lock_shapes(W / 2, 28, 132) + wordmark(W / 2, 236)
    rows = []
    for py in range(H):
        t = py / (H - 1)
        bg = tuple(round(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3))
        cand = [s for s in shapes if s[0][1] - 1 <= py <= s[0][3] + 1]
        row = []
        for px in range(W):
            hits = 0
            near = [s for s in cand if s[0][0] - 1 <= px <= s[0][2] + 1]
            if near:
                for sy in range(SS):
                    y = py + (sy + 0.5) / SS
                    for sx in range(SS):
                        x = px + (sx + 0.5) / SS
                        if any(f(x, y) for _, f in near):
                            hits += 1
            a = hits / (SS * SS)
            row.extend(round(bg[i] + (FG[i] - bg[i]) * a) for i in range(3))
        rows.append(row)
    png_rgb(path, W, H, rows)


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'store', 'promo-small-440x280.png')
    render(out)
    print(out)
