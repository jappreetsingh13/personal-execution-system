"""Generate the app icon set. Dependency-free: stdlib zlib/struct only.

Shapes are drawn as signed distance fields rather than by supersampling, so
edges are analytically anti-aliased at 1x — fast in pure Python and cleaner
than downsampling a 4x buffer.

Design: a violet-to-pink diagonal gradient with a bold white check. Simple and
high-contrast, because the icon is read at ~48px on a home screen far more
often than at 1024.
"""

import math
import os
import struct
import zlib

OUT = os.environ.get("ICON_OUT", "assets")

# Palette — indigo -> violet -> pink, warm and high-energy.
G0 = (0x4F, 0x46, 0xE5)
G1 = (0xA8, 0x55, 0xF7)
G2 = (0xEC, 0x48, 0x99)


# ---------------------------------------------------------------------------
# PNG
# ---------------------------------------------------------------------------

def write_png(path, w, h, pixels):
    raw = bytearray()
    for y in range(h):
        raw.append(0)  # filter type 0
        raw.extend(pixels[y * w * 4 : (y + 1) * w * 4])
    comp = zlib.compress(bytes(raw), 9)

    def chunk(typ, data):
        return (
            struct.pack(">I", len(data))
            + typ
            + data
            + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", comp)
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)
    print(f"  {os.path.basename(path):32s} {w}x{h}  {len(png)/1024:7.1f} KB")


# ---------------------------------------------------------------------------
# SDF helpers — all in normalised 0..1 space
# ---------------------------------------------------------------------------

def sd_rounded_box(px, py, cx, cy, hw, hh, r):
    qx = abs(px - cx) - (hw - r)
    qy = abs(py - cy) - (hh - r)
    return math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - r


def sd_segment(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    denom = vx * vx + vy * vy
    tt = 0.0 if denom == 0 else max(0.0, min(1.0, (wx * vx + wy * vy) / denom))
    return math.hypot(wx - vx * tt, wy - vy * tt)


def smoothstep(edge0, edge1, x):
    if edge1 == edge0:
        return 0.0 if x < edge0 else 1.0
    t = max(0.0, min(1.0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)


def lerp3(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def gradient(nx, ny):
    """Diagonal 3-stop gradient with a soft top-left highlight for depth."""
    t = max(0.0, min(1.0, (nx + ny) * 0.5))
    col = lerp3(G0, G1, t / 0.5) if t < 0.5 else lerp3(G1, G2, (t - 0.5) / 0.5)
    glow = smoothstep(0.85, 0.0, math.hypot(nx - 0.28, ny - 0.24))
    return tuple(min(255.0, c + 26 * glow) for c in col)


def check_alpha(nx, ny, aa, scale=1.0, cx=0.5, cy=0.5):
    """Two capsules forming a check mark, unioned."""
    # Normalise around the given centre so the mark can be scaled for the
    # adaptive-icon safe zone without redrawing it.
    px = (nx - cx) / scale + 0.5
    py = (ny - cy) / scale + 0.5

    d = min(
        sd_segment(px, py, 0.285, 0.520, 0.435, 0.670),
        sd_segment(px, py, 0.435, 0.670, 0.730, 0.352),
    )
    thickness = 0.076
    return smoothstep(thickness + aa / scale, thickness - aa / scale, d)


# ---------------------------------------------------------------------------
# Renderers
# ---------------------------------------------------------------------------

def render(size, mode):
    """mode: 'icon' | 'background' | 'foreground' | 'monochrome' | 'splash'"""
    buf = bytearray(size * size * 4)
    aa = 1.2 / size  # ~1px feather

    # Full-bleed for the adaptive background layer; rounded elsewhere.
    corner = 0.235
    for y in range(size):
        ny = (y + 0.5) / size
        row = y * size * 4
        for x in range(size):
            nx = (x + 0.5) / size
            i = row + x * 4

            if mode in ("icon", "splash"):
                shape = smoothstep(aa, -aa, sd_rounded_box(nx, ny, 0.5, 0.5, 0.5, 0.5, corner))
                r, g, b = gradient(nx, ny)
                ca = check_alpha(nx, ny, aa)
                r = r + (255 - r) * ca
                g = g + (255 - g) * ca
                b = b + (255 - b) * ca
                buf[i : i + 4] = bytes((int(r), int(g), int(b), int(shape * 255)))

            elif mode == "background":
                r, g, b = gradient(nx, ny)
                buf[i : i + 4] = bytes((int(r), int(g), int(b), 255))

            elif mode in ("foreground", "monochrome"):
                # Adaptive icons crop to the inner ~66%, so the mark is scaled
                # down to stay inside the safe zone on every launcher shape.
                ca = check_alpha(nx, ny, aa, scale=0.86)
                buf[i : i + 4] = bytes((255, 255, 255, int(ca * 255)))

    return bytes(buf)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    print(f"Writing icons to {os.path.abspath(OUT)}")
    jobs = [
        ("icon.png", 1024, "icon"),
        ("android-icon-background.png", 1024, "background"),
        ("android-icon-foreground.png", 1024, "foreground"),
        ("android-icon-monochrome.png", 1024, "monochrome"),
        ("splash-icon.png", 512, "splash"),
        ("favicon.png", 96, "icon"),
    ]
    for name, size, mode in jobs:
        write_png(os.path.join(OUT, name), size, size, render(size, mode))
