import cv2
import time

BACKEND = cv2.CAP_DSHOW   # use the backend that worked for you

MODES = [
    ("480p",  640,  480,  30),
    ("480p",  640,  480,  60),
    ("720p",  1280,  720,  30),
    ("720p",  1280,  720,  60),
    ("1080p", 1920, 1080, 30),
]

FOURCCS = ["MJPG", "YUY2"]

def fourcc_to_str(v):
    i = int(v)
    return "".join([
        chr((i >> 0) & 0xFF),
        chr((i >> 8) & 0xFF),
        chr((i >> 16) & 0xFF),
        chr((i >> 24) & 0xFF),
    ])

def measure_fps(cap, seconds=2.0, warmup=10):
    for _ in range(warmup):
        ok, _ = cap.read()
        if not ok:
            return 0.0
    n = 0
    t0 = time.perf_counter()
    while time.perf_counter() - t0 < seconds:
        ok, _ = cap.read()
        if not ok:
            break
        n += 1
    dt = time.perf_counter() - t0
    return n / dt if dt > 0 else 0.0

def test_mode(cam_idx, label, w, h, fps, fourcc):
    print(f"\nTrying cam={cam_idx} {label} {w}x{h}@{fps} req={fourcc}", flush=True)

    cap = cv2.VideoCapture(cam_idx, BACKEND)
    if not cap.isOpened():
        print("  -> OPEN FAILED", flush=True)
        return

    # IMPORTANT: FOURCC LAST
    cap.set(cv2.CAP_PROP_FRAME_WIDTH,  w)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, h)
    cap.set(cv2.CAP_PROP_FPS,          fps)
    cap.set(cv2.CAP_PROP_FOURCC,       cv2.VideoWriter_fourcc(*fourcc))

    try:
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    except Exception:
        pass

    got_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    got_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    got_fourcc = fourcc_to_str(cap.get(cv2.CAP_PROP_FOURCC))
    rep_fps = float(cap.get(cv2.CAP_PROP_FPS))

    real_fps = measure_fps(cap)

    cap.release()

    print(
        f"  -> got {got_w}x{got_h} {got_fourcc} "
        f"rep_fps={rep_fps:.1f} measured_fps={real_fps:.1f}",
        flush=True
    )

def main():
    cam_idx = 0   # change if needed

    for label, w, h, fps in MODES:
        for fourcc in FOURCCS:
            test_mode(cam_idx, label, w, h, fps, fourcc)

if __name__ == "__main__":
    main()
