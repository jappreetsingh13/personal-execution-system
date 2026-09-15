"""Synthesise the 4 bundled tunes — v2, aiming for musical rather than harsh.

What changed from v1:
  * Alarm tunes are ~27s instead of 3s. An Android notification plays its
    channel sound ONCE through, so the sound's length IS how long the alarm
    rings on the lock screen. 3s was over before you noticed it.
  * Bell/marimba partials with per-partial decay (high harmonics die fastest,
    like a real struck bar) instead of a raw sine + square-ish harmonic, which
    is what made v1 sound cheap.
  * A one-pole low-pass rolls off the brittle top end.
  * Soft-clip instead of hard clamp, so peaks compress rather than distort.
"""

import math
import struct
import wave
import os

# 22.05 kHz: every partial here is low-passed below ~7 kHz, so Nyquist at
# 11 kHz is ample and this halves the bytes shipped in the APK for free.
SR = 22050
OUT = os.environ.get("SOUND_OUT", "assets/sounds")


def write_wav(name, samples):
    path = os.path.join(OUT, name)
    with wave.open(path, "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(
            b"".join(struct.pack("<h", int(max(-1.0, min(1.0, s)) * 32600)) for s in samples)
        )
    print(f"  {name:22s} {len(samples)/SR:5.1f}s  {os.path.getsize(path)/1024:7.1f} KB")


def soft_clip(x):
    """tanh-ish limiter — keeps peaks musical instead of crunching them."""
    return math.tanh(x * 1.15) * 0.92


def low_pass(buf, cutoff_hz):
    """One-pole LPF; takes the brittle edge off the harmonics."""
    dt = 1.0 / SR
    rc = 1.0 / (2 * math.pi * cutoff_hz)
    alpha = dt / (rc + dt)
    out = [0.0] * len(buf)
    prev = 0.0
    for i, v in enumerate(buf):
        prev = prev + alpha * (v - prev)
        out[i] = prev
    return out


def add_bell(buf, start_s, freq, dur, amp, partials=(1.0, 2.0, 2.99, 4.21), decay=3.0):
    """Struck-bar tone. Higher partials decay faster, which is what sells it."""
    i0 = int(start_s * SR)
    n = int(dur * SR)
    for i in range(n):
        if i0 + i >= len(buf):
            break
        t = i / SR
        attack = min(1.0, t / 0.004)
        v = 0.0
        for k, p in enumerate(partials):
            pamp = amp / (1.0 + k * 1.7)
            v += pamp * math.sin(2 * math.pi * freq * p * t) * math.exp(-decay * (1 + k * 0.85) * t)
        buf[i0 + i] += v * attack


def add_swell(buf, start_s, freq, dur, amp):
    """Gong-like swell: slow in, long out."""
    i0 = int(start_s * SR)
    n = int(dur * SR)
    for i in range(n):
        if i0 + i >= len(buf):
            break
        t = i / SR
        env = (1 - math.exp(-t * 5.0)) * math.exp(-t * 1.25)
        v = (
            0.60 * math.sin(2 * math.pi * freq * t)
            + 0.24 * math.sin(2 * math.pi * freq * 2.01 * t)
            + 0.10 * math.sin(2 * math.pi * freq * 3.4 * t)
            + 0.05 * math.sin(2 * math.pi * freq * 4.9 * t)
        )
        buf[i0 + i] += v * env * amp


def finish(buf, cutoff=5200, fade_ms=25):
    buf = low_pass(buf, cutoff)
    n = int(SR * fade_ms / 1000)
    for i in range(min(n, len(buf) // 2)):
        g = i / n
        buf[i] *= g
        buf[-1 - i] *= g
    return [soft_clip(v) for v in buf]


# Note frequencies
C5, D5, E5, G5, A5, C6, E6, G6 = 523.25, 587.33, 659.25, 784.0, 880.0, 1046.5, 1318.5, 1568.0


def alarm_classic():
    """Warm marimba arpeggio, insistent but not shrill. Repeats for ~27s."""
    total = 27.0
    buf = [0.0] * int(total * SR)
    pattern = [(0.00, C5), (0.18, E5), (0.36, G5), (0.54, C6), (0.72, G5), (0.90, E5)]
    bar = 1.35
    t = 0.0
    while t < total - bar:
        # Every other bar lifts an octave so it keeps demanding attention.
        lift = 2.0 if int(t / bar) % 2 == 1 else 1.0
        for off, f in pattern:
            add_bell(buf, t + off, f * lift, 1.1, 0.30, decay=3.4)
        t += bar
    return finish(buf, cutoff=5000)


def alarm_pulse():
    """Deeper gong swells rising in pitch — calmer, still hard to sleep through."""
    total = 27.0
    buf = [0.0] * int(total * SR)
    steps = [C5, E5, G5, A5, C6, A5, G5, E5]
    step = 1.6
    t = 0.0
    i = 0
    while t < total - step:
        add_swell(buf, t, steps[i % len(steps)], 2.4, 0.34)
        # An octave sparkle on the accent beat gives it a heartbeat.
        if i % 4 == 0:
            add_bell(buf, t, steps[i % len(steps)] * 2, 1.3, 0.16, decay=3.0)
        t += step
        i += 1
    return finish(buf, cutoff=4200)


def notify_chime():
    """Two-note rising bell — friendly, short."""
    buf = [0.0] * int(1.6 * SR)
    add_bell(buf, 0.00, C6, 1.5, 0.34, decay=3.2)
    add_bell(buf, 0.13, E6, 1.4, 0.30, decay=3.2)
    return finish(buf, cutoff=6200, fade_ms=12)


def notify_ping():
    """Single crisp ping — the terse option."""
    buf = [0.0] * int(1.0 * SR)
    add_bell(buf, 0.0, G6, 0.95, 0.36, partials=(1.0, 2.0, 3.01), decay=5.5)
    return finish(buf, cutoff=6800, fade_ms=10)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    print(f"Writing tunes to {os.path.abspath(OUT)}")
    write_wav("alarm_classic.wav", alarm_classic())
    write_wav("alarm_pulse.wav", alarm_pulse())
    write_wav("notify_chime.wav", notify_chime())
    write_wav("notify_ping.wav", notify_ping())
