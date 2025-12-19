import time
import cv2
from cv2_enumerate_cameras import enumerate_cameras

# Resolutions to try (ordered high -> low)
COMMON_MODES = [
    (7680, 4320),  # 8K
    (5120, 2880),  # 5K
    (3840, 2160),  # 4K
    (2560, 1440),  # QHD
    (1920, 1080),  # FHD
    (1600, 1200),
    (1280, 720),   # HD
    (1024, 768),
    (800, 600),
    (640, 480),
]

def measure_fps(cap: cv2.VideoCapture, frames: int = 60, warmup: int = 10) -> float:
    # Warm up auto-exposure / buffering
    for _ in range(warmup):
        cap.read()

    start = time.perf_counter()
    got = 0
    for _ in range(frames):
        ret, _ = cap.read()
        if not ret:
            break
        got += 1
    elapsed = time.perf_counter() - start
    return (got / elapsed) if elapsed > 0 else 0.0

def probe_camera(index: int, backend: int, modes=COMMON_MODES):
    cap = cv2.VideoCapture(index, backend)
    if not cap.isOpened():
        return None

    accepted = []
    seen = set()

    for w, h in modes:
        # Request mode
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, w)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, h)

        # Read back what we actually got
        aw = int(round(cap.get(cv2.CAP_PROP_FRAME_WIDTH)))
        ah = int(round(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)))

        # Some drivers snap to nearest supported size; keep only exact matches
        if aw == w and ah == h:
            if (aw, ah) in seen:
                continue
            seen.add((aw, ah))

            fps = measure_fps(cap)
            accepted.append((aw, ah, fps))

    cap.release()

    # Sort: highest resolution first, then highest fps
    accepted.sort(key=lambda x: (x[0] * x[1], x[2]), reverse=True)
    return accepted

def dump_and_probe(backend, name):
    print(f"\n=== {name} ===")
    cams = list(enumerate_cameras(backend))
    if not cams:
        print("No cameras found.")
        return

    for c in cams:
        print(f"\nindex={c.index}  name={c.name}")
        print(f"  vid={c.vid} pid={c.pid}")
        print(f"  path={c.path}")

        modes = probe_camera(c.index, backend)
        if not modes:
            print("  (Could not open camera or no tested modes were accepted.)")
            continue

        best_w, best_h, best_fps = modes[0]
        print(f"  Best (tested): {best_w}x{best_h} @ ~{best_fps:.1f} FPS")

        print("  Accepted modes (tested):")
        for w, h, fps in modes:
            print(f"    {w}x{h} @ ~{fps:.1f} FPS")

if __name__ == "__main__":
    dump_and_probe(cv2.CAP_MSMF, "CAP_MSMF")
    dump_and_probe(cv2.CAP_DSHOW, "CAP_DSHOW")
