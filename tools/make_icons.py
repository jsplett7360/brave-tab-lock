#!/usr/bin/env python3
"""Regenerate icons/*.png (dev tool, stdlib only). Draws a simple padlock on a rounded square."""
import struct, zlib, os, sys

def png(path, w, h, px):
    raw = b''.join(b'\x00' + bytes(px[y*w*4:(y+1)*w*4]) for y in range(h))
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

def rrect(x, y, x0, y0, x1, y1, r):
    cx = min(max(x, x0 + r), x1 - r); cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r and x0 <= x <= x1 and y0 <= y <= y1

def shade(u, v):
    """u,v in [0,1]. Returns RGBA."""
    bg = (47, 91, 211); fg = (255, 255, 255)
    if not rrect(u, v, 0.02, 0.02, 0.98, 0.98, 0.22): return (0, 0, 0, 0)
    # shackle: ring between radii, upper half, centred at (0.5, 0.42)
    dx, dy = u - 0.5, v - 0.43
    d = (dx * dx + dy * dy) ** 0.5
    if dy <= 0 and 0.13 <= d <= 0.21: return fg + (255,)
    if 0.43 <= v <= 0.50 and (0.29 <= u <= 0.37 or 0.63 <= u <= 0.71): return fg + (255,)
    # body
    if rrect(u, v, 0.22, 0.47, 0.78, 0.84, 0.07):
        kx, ky = u - 0.5, v - 0.62
        if kx * kx + ky * ky <= 0.055 ** 2 or (abs(kx) <= 0.022 and 0.62 <= v <= 0.74): return bg + (255,)
        return fg + (255,)
    return bg + (255,)

def render(n, ss=6):
    px = []
    for y in range(n):
        for x in range(n):
            acc = [0, 0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    c = shade((x + (sx + .5) / ss) / n, (y + (sy + .5) / ss) / n)
                    a = c[3]
                    for i in range(3): acc[i] += c[i] * a
                    acc[3] += a
            a = acc[3]
            px += ([round(acc[i] / a) for i in range(3)] + [round(a / (ss * ss))]) if a else [0, 0, 0, 0]
    return px

out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'icons')
def padded(n, art):
    """Chrome Web Store guideline: 128px icon = 96px artwork + 16px transparent padding."""
    inner = render(art); pad = (n - art) // 2; px = [0] * (n * n * 4)
    for y in range(art):
        for x in range(art):
            i, j = (y * art + x) * 4, ((y + pad) * n + x + pad) * 4
            px[j:j + 4] = inner[i:i + 4]
    return px

for n in (16, 32, 48):
    png(os.path.join(out, f'icon{n}.png'), n, n, render(n))
png(os.path.join(out, 'icon128.png'), 128, 128, padded(128, 96))
print('ok')
