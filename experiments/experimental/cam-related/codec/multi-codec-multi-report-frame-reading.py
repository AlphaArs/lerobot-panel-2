import cv2
import time

CAM_IDX = 1
BACKEND = cv2.CAP_DSHOW
FOURCC = "MJPG"

RESOLUTIONS = [
    ("480p",  640,  480),
    ("720p",  1280, 720),
    ("1080p", 1920, 1080),
]

FPS_TARGETS = [30, 60]
RUNS_PER_MODE = 5

def fourcc_to_str(v):
    i = int(v)
    return "".join([
        chr((i >> 0) & 0xFF),
        chr((i >> 8) & 0xFF),
        chr((i >> 16) & 0xFF),
        chr((i >> 24) & 0xFF),
    ])

def open_camera(w, h, fps):
    cap = cv2.VideoCapture(CAM_IDX, BACKEND)
    if not cap.isOpened():
        raise RuntimeError("Could not open camera")

    # IMPORTANT: FOURCC LAST
    cap.set(cv2.CAP_PROP_FRAME_WIDTH,  w)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, h)
    cap.set(cv2.CAP_PROP_FPS,          fps)
    cap.set(cv2.CAP_PROP_FOURCC,       cv2.VideoWriter_fourcc(*FOURCC))

    try:
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    except Exception:
        pass

    # Flush startup frames
    for _ in range(30):
        cap.read()

    got_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    got_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    got_fourcc = fourcc_to_str(cap.get(cv2.CAP_PROP_FOURCC))
    rep_fps = cap.get(cv2.CAP_PROP_FPS)

    print(f"\nOpened {got_w}x{got_h} {got_fourcc} rep_fps={rep_fps:.1f}")
    return cap

def measure_fps(cap, seconds=2.5):
    n = 0
    t0 = time.perf_counter()
    while time.perf_counter() - t0 < seconds:
        ok, _ = cap.read()
        if not ok:
            return 0.0
        n += 1
    return n / (time.perf_counter() - t0)

def main():
    for label, w, h in RESOLUTIONS:
        for fps in FPS_TARGETS:
            print(f"\n=== TEST {label} @ {fps} FPS (MJPEG) ===")
            cap = open_camera(w, h, fps)

            for run in range(1, RUNS_PER_MODE + 1):
                real = measure_fps(cap)
                print(f"Run {run}: measured_fps={real:.1f}")
                time.sleep(0.4)

            cap.release()
            time.sleep(1.5)  # cooldown between modes

if __name__ == "__main__":
    main()
