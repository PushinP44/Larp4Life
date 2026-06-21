"""
gen_audio.py  —  Ecosystem X procedural audio synthesiser
Generates 5 files in /assets/:
  amb_toxic.mp3      30 s seamless loop  — oppressive, near-silent life
  amb_degraded.mp3   30 s seamless loop  — tense, thin
  amb_recovering.mp3 30 s seamless loop  — warming, returning life
  amb_pristine.mp3   30 s seamless loop  — full living wetland
  sting_win.mp3      5 s one-shot        — hopeful resolution swell

Key: all tuned to A-minor / C-major (A=220 Hz root) for coherence.
Technique: additive synthesis + filtered noise + AM/FM modulation,
           rendered as 16-bit stereo WAV → encoded to MP3 via lameenc.
"""

import math, os, struct, wave, random
import numpy as np
from scipy import signal
import lameenc

SR   = 44100          # sample rate
OUT  = os.path.join(os.path.dirname(__file__), '..', 'assets')
os.makedirs(OUT, exist_ok=True)

rng = random.Random(42)

# ── helpers ───────────────────────────────────────────────────────────────────

def t_axis(duration):
    return np.linspace(0, duration, int(SR * duration), endpoint=False)

def sine(freq, t, phase=0.0):
    return np.sin(2 * np.pi * freq * t + phase)

def noise(n):
    return np.random.RandomState(7).randn(n).astype(np.float32)

def lowpass(sig, cutoff, order=4):
    b, a = signal.butter(order, cutoff / (SR / 2), btype='low')
    return signal.filtfilt(b, a, sig).astype(np.float32)

def bandpass(sig, lo, hi, order=3):
    b, a = signal.butter(order, [lo/(SR/2), hi/(SR/2)], btype='band')
    return signal.filtfilt(b, a, sig).astype(np.float32)

def highpass(sig, cutoff, order=3):
    b, a = signal.butter(order, cutoff / (SR / 2), btype='high')
    return signal.filtfilt(b, a, sig).astype(np.float32)

def fade_ends(sig, fade_sec=1.5):
    """Equal-power fade in + out for seamless looping."""
    n_fade = int(SR * fade_sec)
    env = np.ones(len(sig), dtype=np.float32)
    ramp = np.linspace(0, 1, n_fade)
    env[:n_fade]  = ramp
    env[-n_fade:] = ramp[::-1]
    return sig * env

def crossfade_loop(sig, xfade_sec=2.0):
    """Overlap-add the end onto the beginning for seamless looping."""
    n_xf = int(SR * xfade_sec)
    out  = sig.copy()
    ramp_up   = np.linspace(0, 1, n_xf)
    ramp_down = ramp_up[::-1]
    out[:n_xf]  += sig[-n_xf:] * ramp_down
    out[-n_xf:] += sig[:n_xf]  * ramp_up
    return out

def normalise(sig, peak=0.88):
    mx = np.max(np.abs(sig))
    if mx > 0:
        sig = sig / mx * peak
    return sig

def to_stereo(left, right):
    """Interleave two mono float32 arrays into stereo int16."""
    left  = np.clip(left,  -1, 1)
    right = np.clip(right, -1, 1)
    stereo = np.empty(len(left) * 2, dtype=np.int16)
    stereo[0::2] = (left  * 32767).astype(np.int16)
    stereo[1::2] = (right * 32767).astype(np.int16)
    return stereo

def encode_mp3(stereo_int16, path, bitrate=128):
    encoder = lameenc.Encoder()
    encoder.set_bit_rate(bitrate)
    encoder.set_in_sample_rate(SR)
    encoder.set_channels(2)
    encoder.set_quality(2)
    mp3_data = encoder.encode(stereo_int16.tobytes())
    mp3_data += encoder.flush()
    with open(path, 'wb') as f:
        f.write(mp3_data)

def save(name, mono_L, mono_R=None, loop=True, fade_sec=1.2):
    if mono_R is None:
        mono_R = mono_L
    if loop:
        mono_L = crossfade_loop(mono_L, fade_sec)
        mono_R = crossfade_loop(mono_R, fade_sec)
    mono_L = normalise(mono_L)
    mono_R = normalise(mono_R)
    stereo = to_stereo(mono_L, mono_R)
    path   = os.path.join(OUT, name)
    encode_mp3(stereo, path)
    print(f'  ✓ {name}  ({len(mono_L)/SR:.1f}s)')

# ── Musical constants (A-minor, root A=220) ───────────────────────────────────
A2, C3, E3  = 220.0, 261.63, 329.63
G2, D3, F3  = 196.0, 293.66, 349.23
A3, E4      = 440.0, 659.25
C4, G4      = 523.25, 783.99

# ─────────────────────────────────────────────────────────────────────────────
# 1. amb_toxic  — oppressive, near-silent, hollow drone, drip, distorted call
# ─────────────────────────────────────────────────────────────────────────────
def gen_toxic():
    D = 30.0
    t = t_axis(D)
    n = len(t)

    # Sub-bass drone A2 — slow tremolo for oppressive feel
    tremolo = 0.92 + 0.08 * sine(0.07, t)
    drone = sine(A2 * 0.5, t) * tremolo * 0.30
    drone += sine(A2, t) * tremolo * 0.15
    # Very slight detuned layer for hollow beating
    drone += sine(A2 * 1.003, t) * 0.08

    # Dark sub rumble — filtered noise
    rumble = lowpass(noise(n) * 0.35, 80)

    # Sporadic drip events — short sine bursts
    drip_track = np.zeros(n, dtype=np.float32)
    rng2 = np.random.RandomState(3)
    drip_times = sorted(rng2.uniform(2, D-2, 14))
    for dt in drip_times:
        di = int(dt * SR)
        dur = int(SR * 0.18)
        if di + dur >= n: continue
        tt  = np.linspace(0, 1, dur)
        env = np.exp(-tt * 18)
        freq_d = rng2.choice([880, 1100, 660])
        drip_track[di:di+dur] += np.sin(2*np.pi*freq_d*tt) * env * 0.28

    # Distorted distant bird — degraded chirp
    bird = np.zeros(n, dtype=np.float32)
    bird_times = [5.5, 14.2, 22.8]
    for bt in bird_times:
        bi = int(bt * SR)
        dur = int(SR * 0.9)
        if bi + dur >= n: continue
        tt  = np.linspace(0, 1, dur)
        env = np.exp(-tt * 5) * np.sin(np.pi * tt)
        # Pitch drops — distress call
        freq_sweep = 1800 - tt * 900
        chirp = np.sin(2*np.pi * np.cumsum(freq_sweep) / SR) * env * 0.18
        # ring mod distortion
        chirp *= np.sin(2*np.pi * 220 * tt)
        bird[bi:bi+dur] += chirp.astype(np.float32)

    # Combine
    mix = drone + rumble + drip_track + bird
    mix = lowpass(mix, 2400)     # muffle high end — oppressive

    # Stereo: subtle room difference
    mix_R = mix * 0.92 + np.roll(mix, 220) * 0.08
    save('amb_toxic.mp3', mix.astype(np.float32), mix_R.astype(np.float32))

# ─────────────────────────────────────────────────────────────────────────────
# 2. amb_degraded  — tense, thin, insects, uneasy drone, faint water
# ─────────────────────────────────────────────────────────────────────────────
def gen_degraded():
    D = 30.0
    t = t_axis(D)
    n = len(t)

    # Mid drone — slightly detuned A+G minor 7th, uneasy
    wobble = 1 + 0.015 * sine(0.18, t)
    drone  = sine(A2, t) * wobble * 0.20
    drone += sine(G2, t) * 0.12
    drone += sine(A2 * 2, t) * wobble * 0.07

    # Tension cluster: bandpassed noise in dissonant freq range
    tension = bandpass(noise(n) * 0.5, 300, 700) * 0.18

    # Cricket/insect buzz — sparse AM oscillators
    insect = np.zeros(n, dtype=np.float32)
    rng3 = np.random.RandomState(5)
    for freq_i in [4200, 5100, 3800]:
        am_rate = rng3.uniform(14, 22)
        am = 0.5 + 0.5 * sine(am_rate, t, rng3.uniform(0, 2*np.pi))
        # presence: only in patches
        patch = np.zeros(n, dtype=np.float32)
        for _ in range(5):
            start = rng3.randint(0, n - SR*4)
            length = rng3.randint(SR*2, SR*5)
            patch[start:start+length] = 1.0
        patch = lowpass(patch, 3)
        insect += sine(freq_i, t) * am * patch * 0.06

    # Faint water trickle — high-freq shaped noise
    water = highpass(noise(n) * 0.25, 800)
    water = lowpass(water, 2800) * 0.10
    water_mod = 0.6 + 0.4 * sine(0.12, t)
    water *= water_mod

    mix = drone + tension + insect + water
    mix_R = mix * 0.88 + np.roll(mix, 310) * 0.12
    save('amb_degraded.mp3', mix.astype(np.float32), mix_R.astype(np.float32))

# ─────────────────────────────────────────────────────────────────────────────
# 3. amb_recovering  — warming, returning birdsong, water, soft strings/marimba
# ─────────────────────────────────────────────────────────────────────────────
def gen_recovering():
    D = 30.0
    t = t_axis(D)
    n = len(t)

    # Warm drone — A major flavour, C# hint
    drone  = sine(A2, t) * 0.15
    drone += sine(E3, t) * 0.10
    drone += sine(C3, t) * 0.08
    # Slow swell
    swell  = 0.7 + 0.3 * sine(0.05, t)
    drone *= swell

    # Soft string pad — stack of detuned sines with slow attack
    attack = np.minimum(t / 4, 1.0).astype(np.float32)
    string = (sine(C3, t, 0.0) * 0.12
            + sine(E3, t, 0.3) * 0.10
            + sine(G2, t, 0.6) * 0.08
            + sine(C3*1.004, t) * 0.06) * attack

    # Marimba-like pluck sequence — pentatonic A: A C D E G
    marimba_freqs = [A2*2, C3*2, D3*2, E3*2, G2*2]
    marimba = np.zeros(n, dtype=np.float32)
    rng4 = np.random.RandomState(9)
    note_times = sorted(rng4.uniform(1, D-2, 22))
    for nt in note_times:
        ni = int(nt * SR)
        dur = int(SR * 0.55)
        if ni + dur >= n: continue
        tt  = np.linspace(0, 1, dur)
        env = np.exp(-tt * 9)
        freq_m = rng4.choice(marimba_freqs)
        note = np.sin(2*np.pi*freq_m*tt) * env * 0.20
        note += np.sin(2*np.pi*freq_m*2*tt) * env * 0.06
        marimba[ni:ni+dur] += note.astype(np.float32)

    # Returning bird calls — simple rising chirps
    birds = np.zeros(n, dtype=np.float32)
    chirp_times = [3.1, 7.4, 11.8, 16.2, 20.5, 25.3]
    for ct in chirp_times:
        ci = int(ct * SR)
        dur = int(SR * 0.35)
        if ci + dur >= n: continue
        tt  = np.linspace(0, 1, dur)
        env = np.sin(np.pi * tt) * 0.25
        sweep = 1200 + tt * 800
        chirp = np.sin(2*np.pi * np.cumsum(sweep) / SR) * env
        birds[ci:ci+dur] += chirp.astype(np.float32)

    # Gentle water movement
    water = lowpass(noise(n) * 0.30, 600) * 0.14
    water_env = 0.7 + 0.3 * sine(0.08, t)
    water *= water_env

    mix = drone + string + marimba + birds + water
    mix = lowpass(mix, 8000)
    mix_R = mix * 0.85 + np.roll(mix, 450) * 0.15
    save('amb_recovering.mp3', mix.astype(np.float32), mix_R.astype(np.float32))

# ─────────────────────────────────────────────────────────────────────────────
# 4. amb_pristine  — full living wetland, rich dawn chorus, frogs, lapping water
# ─────────────────────────────────────────────────────────────────────────────
def gen_pristine():
    D = 30.0
    t = t_axis(D)
    n = len(t)

    # Rich harmonic drone A major chord — bright
    drone  = sine(A2, t) * 0.12
    drone += sine(E3, t) * 0.10
    drone += sine(A3, t) * 0.08
    drone += sine(C3, t) * 0.06
    swell  = 0.8 + 0.2 * sine(0.04, t)
    drone *= swell

    # Dawn chorus — many overlapping chirps at various pitches
    chorus = np.zeros(n, dtype=np.float32)
    rng5 = np.random.RandomState(11)
    bird_freqs = [1600, 2000, 2400, 2800, 3200, 1400, 1800, 2200]
    for _ in range(40):
        ct  = rng5.uniform(0.5, D-2)
        ci  = int(ct * SR)
        dur = int(SR * rng5.uniform(0.15, 0.45))
        if ci + dur >= n: continue
        tt  = np.linspace(0, 1, dur)
        env = np.sin(np.pi * tt) * rng5.uniform(0.12, 0.28)
        f0  = rng5.choice(bird_freqs)
        # Chirp with slight trill
        trill = f0 + rng5.uniform(80, 200) * (np.sin(tt * np.pi * rng5.uniform(4,8)) * 0.5 + 0.5)
        ch = np.sin(2*np.pi * np.cumsum(trill) / SR) * env
        chorus[ci:ci+dur] += ch.astype(np.float32)

    # Frogs — deep croaking pulses
    frogs = np.zeros(n, dtype=np.float32)
    rng6 = np.random.RandomState(13)
    for _ in range(18):
        ft  = rng6.uniform(1, D-2)
        fi  = int(ft * SR)
        dur = int(SR * 0.22)
        if fi + dur >= n: continue
        tt  = np.linspace(0, 1, dur)
        env = np.exp(-tt * 12) * np.sin(np.pi * tt * 2)
        # Deep, slightly buzzy croak
        croak = (np.sin(2*np.pi*280*tt) + 0.4*np.sin(2*np.pi*560*tt)) * env * 0.22
        frogs[fi:fi+dur] += croak.astype(np.float32)

    # Lapping water — dense shaped noise
    water = lowpass(noise(n) * 0.5, 1200) * 0.22
    water += bandpass(noise(n) * 0.3, 1200, 4000) * 0.08
    water_env = 0.75 + 0.25 * sine(0.06, t)
    water *= water_env

    # Insects — continuous bright layer
    insect = np.zeros(n, dtype=np.float32)
    for freq_i, amp in [(5200, 0.05), (6100, 0.04), (4700, 0.03)]:
        am_rate = rng6.uniform(18, 28)
        am = 0.5 + 0.5 * sine(am_rate, t, rng6.uniform(0, 2*np.pi))
        insect += sine(freq_i, t) * am * amp

    mix = drone + chorus + frogs + water + insect
    mix = lowpass(mix, 14000)   # open, bright
    mix_R = mix * 0.80 + np.roll(mix, 600) * 0.20
    save('amb_pristine.mp3', mix.astype(np.float32), mix_R.astype(np.float32))

# ─────────────────────────────────────────────────────────────────────────────
# 5. sting_win  — 5 s hopeful resolution swell (one-shot, not looped)
# ─────────────────────────────────────────────────────────────────────────────
def gen_sting_win():
    D = 5.0
    t = t_axis(D)
    n = len(t)

    # Rising swell attack then sustained — envelope
    attack_env  = np.minimum(t / 1.2, 1.0).astype(np.float32)
    release_env = np.maximum(0, 1 - (t - 3.5) / 1.5).astype(np.float32)
    env_main    = attack_env * release_env

    # A major chord: A-C#-E-A  (use C# = C3*1.059 ≈ 277 Hz)
    Cs3 = 277.18
    chord = (sine(A2, t) * 0.22
           + sine(Cs3, t) * 0.18
           + sine(E3, t)  * 0.20
           + sine(A3, t)  * 0.15
           + sine(E4, t)  * 0.10)
    # Gentle vibrato from beat 1.5 s in
    vib_depth = np.minimum(np.maximum((t - 1.5) / 1.0, 0), 1) * 0.008
    vib = 1 + vib_depth * sine(5.5, t)
    chord *= vib

    # Marimba bright arpeggio — A C# E A (ascending)
    arpegg = np.zeros(n, dtype=np.float32)
    arp_notes = [(0.05, A2*2), (0.30, Cs3*2), (0.55, E3*2), (0.80, A3*2),
                 (1.10, E4),   (1.40, A3*2),  (1.70, E3*2)]
    for nt, freq_a in arp_notes:
        ai  = int(nt * SR)
        dur = int(SR * 0.40)
        if ai + dur >= n: continue
        tt2 = np.linspace(0, 1, dur)
        note_env = np.exp(-tt2 * 7)
        arpegg[ai:ai+dur] += (np.sin(2*np.pi*freq_a*tt2)
                             + 0.3*np.sin(2*np.pi*freq_a*2*tt2)) * note_env * 0.30

    # Rising bird call swell at start
    bird_sting = np.zeros(n, dtype=np.float32)
    dur_b = int(SR * 1.8)
    tt_b  = np.linspace(0, 1, dur_b)
    env_b = np.sin(np.pi * tt_b * 0.55) * 0.30
    sweep_b = 800 + tt_b * 1600
    bird_sting[:dur_b] = np.sin(2*np.pi * np.cumsum(sweep_b) / SR) * env_b

    # Warm pad beneath
    pad = (sine(A2, t) * 0.10 + sine(E3, t) * 0.08) * env_main

    # Shimmer — high bells
    shimmer = np.zeros(n, dtype=np.float32)
    for st, sf in [(1.0, C4*2), (1.5, A3*2), (2.0, E4*2), (2.5, G4*2), (3.0, C4*3)]:
        si  = int(st * SR)
        dur_s = int(SR * 0.6)
        if si + dur_s >= n: continue
        tt_s = np.linspace(0, 1, dur_s)
        s_env = np.exp(-tt_s * 6)
        shimmer[si:si+dur_s] += np.sin(2*np.pi*sf*tt_s) * s_env * 0.12

    mix = (chord * env_main + arpegg + bird_sting + pad + shimmer)
    mix = normalise(mix, 0.90)
    # Stereo spread
    mix_R = mix * 0.82 + np.roll(mix, 350) * 0.18
    save('sting_win.mp3', mix.astype(np.float32), mix_R.astype(np.float32), loop=False)

# ── run ───────────────────────────────────────────────────────────────────────
print('Generating audio → assets/')
gen_toxic()
gen_degraded()
gen_recovering()
gen_pristine()
gen_sting_win()
print('Done.')
