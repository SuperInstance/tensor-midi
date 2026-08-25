"""Minimal Standard MIDI File reader (zero dependencies).

The pulse-eye pipeline hands off through a real .mid artifact —
"plainsong session -> MIDI (plainsong compile) -> analyzer input" — so the
adapter parses the compiled MIDI file itself rather than reaching into the
compiler's in-memory arrangement. Supports format 0/1, running status,
note on/off, tempo and time-signature meta events. Good enough for any
MIDI that plainsong emits.
"""

from __future__ import annotations


def _read_vlq(data: bytes, i: int) -> tuple[int, int]:
    value = 0
    while True:
        b = data[i]
        i += 1
        value = (value << 7) | (b & 0x7F)
        if not (b & 0x80):
            return value, i


def parse_smf(path: str) -> dict:
    """Return {ppq, division, notes:[{channel,pitch,velocity,tick}], tempo_us,
    timesig} where notes are note-on events in absolute ticks."""
    data = open(path, "rb").read()
    if data[:4] != b"MThd":
        raise ValueError(f"{path}: not a MIDI file")
    header_len = int.from_bytes(data[4:8], "big")
    fmt = int.from_bytes(data[8:10], "big")
    ntrks = int.from_bytes(data[10:12], "big")
    division = int.from_bytes(data[12:14], "big")
    if division & 0x8000:
        raise ValueError("SMPTE timing not supported")
    ppq = division

    notes: list[dict] = []
    tempo_us = 500_000
    timesig = (4, 4)
    pos = 8 + header_len

    for _ in range(ntrks):
        if data[pos:pos + 4] != b"MTrk":
            break
        track_len = int.from_bytes(data[pos + 4:pos + 8], "big")
        track = data[pos + 8:pos + 8 + track_len]
        pos += 8 + track_len

        i = 0
        tick = 0
        running_status = None
        while i < len(track):
            delta, i = _read_vlq(track, i)
            tick += delta
            b = track[i]
            if b & 0x80:
                status = b
                i += 1
                if status < 0xF0:
                    running_status = status
            else:
                status = running_status
                if status is None:
                    continue

            kind = status & 0xF0
            if status in (0xFF,):
                meta_type = track[i]
                i += 1
                length, i = _read_vlq(track, i)
                payload = track[i:i + length]
                i += length
                if meta_type == 0x51 and length == 3:
                    tempo_us = int.from_bytes(payload, "big")
                elif meta_type == 0x58 and length >= 2:
                    timesig = (payload[0], 2 ** payload[1])
            elif status in (0xF0, 0xF7):
                length, i = _read_vlq(track, i)
                i += length
            elif kind in (0x80, 0x90):
                pitch, vel = track[i], track[i + 1]
                i += 2
                if kind == 0x90 and vel > 0:
                    notes.append({
                        "channel": status & 0x0F,
                        "pitch": pitch,
                        "velocity": vel,
                        "tick": tick,
                    })
            elif kind in (0xA0, 0xB0, 0xE0):
                i += 2
            elif kind in (0xC0, 0xD0):
                i += 1
            else:
                raise ValueError(f"unhandled status {status:#x}")

    notes.sort(key=lambda n: (n["tick"], n["channel"], n["pitch"]))
    return {"ppq": ppq, "notes": notes, "tempo_us": tempo_us,
            "timesig": timesig, "format": fmt}


if __name__ == "__main__":
    import sys
    r = parse_smf(sys.argv[1])
    print(f"ppq={r['ppq']} notes={len(r['notes'])} tempo={60000000/r['tempo_us']:.0f}bpm "
          f"timesig={r['timesig'][0]}/{r['timesig'][1]}")
    channels = sorted({n["channel"] for n in r["notes"]})
    print("channels:", channels, "last tick:", max(n["tick"] for n in r["notes"]))
