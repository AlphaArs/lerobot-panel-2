import cv2
import time

BACKEND = cv2.CAP_DSHOW

MODES = [
    ("480p",  640,  480),
    ("720p",  1280,  720),
    ("1080p", 1920, 1080),
]

FPS_LIST = [60]
FOURCCS = ["MJPG", "YUY2"]

def fourcc_to_str(v):
    i = int(v)
    return "".join([
        chr((i >> 0) & 0xFF),
        chr((i >> 8) & 0xFF),
        chr((i >> 16) & 0xFF),
        chr((i >> 24) & 0xFF),
    ])

def frame_signature(frame):
    small = cv2.resize(frame, (32, 18), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    return int(gray.sum())

def measure_fps_reliable(cap, seconds=1.25, warmup=10, yield_sleep=0.001):
    # Warmup
    last_sig = None
    for _ in range(warmup):
        ok, frame = cap.read()
        if not ok:
            return 0.0
        last_sig = frame_signature(frame)
        time.sleep(yield_sleep)

    # Timed average; count only new frames
    n_new = 0
    t0 = time.perf_counter()
    while time.perf_counter() - t0 < seconds:
        ok, frame = cap.read()
        if not ok:
            break

        sig = frame_signature(frame)
        if sig != last_sig:
            n_new += 1
            last_sig = sig
        else:
            time.sleep(yield_sleep)

    dt = time.perf_counter() - t0
    return (n_new / dt) if dt > 0 else 0.0

def test_mode(cam_idx, label, w, h, fps, fourcc):
    print(f"\nTrying cam={cam_idx} {label} {w}x{h}@{fps} req={fourcc}", flush=True)

    cap = cv2.VideoCapture(cam_idx, BACKEND)
    if not cap.isOpened():
        print("  -> OPEN FAILED", flush=True)
        return

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

    measured = measure_fps_reliable(cap, seconds=1.25, warmup=10, yield_sleep=0.001)

    cap.release()

    print(
        f"  -> got {got_w}x{got_h} {got_fourcc} "
        f"rep_fps={rep_fps:.1f} measured_fps={measured:.1f}",
        flush=True
    )

def main():
    cam_idx = 1
    for label, w, h in MODES:
        for fps in FPS_LIST:
            for fourcc in FOURCCS:
                test_mode(cam_idx, label, w, h, fps, fourcc)

if __name__ == "__main__":
    main()
