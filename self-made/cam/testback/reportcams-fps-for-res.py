import cv2
import time
from dataclasses import dataclass
from typing import List, Tuple, Optional

@dataclass
class Mode:
    name: str          # "MJPG" or "YUY2"
    fourcc: str        # "MJPG" or "YUY2"
    width: int
    height: int
    target_fps: int

def fourcc_int(code: str) -> int:
    return cv2.VideoWriter_fourcc(*code)

def fourcc_to_str(v: float) -> str:
    # CAP_PROP_FOURCC returns a float sometimes
    i = int(v)
    chars = [chr((i >> 0) & 0xFF), chr((i >> 8) & 0xFF), chr((i >> 16) & 0xFF), chr((i >> 24) & 0xFF)]
    return "".join(chars)

def try_mode(cam_index: int, mode: Mode, backend=cv2.CAP_DSHOW, secs: float = 5.0, warmup_frames: int = 30) -> Tuple[bool, str]:
    cap = cv2.VideoCapture(cam_index, backend)
    if not cap.isOpened():
        return False, "open_failed"

    # Request settings (order can matter on Windows)
    cap.set(cv2.CAP_PROP_FOURCC, fourcc_int(mode.fourcc))
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, mode.width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, mode.height)
    cap.set(cv2.CAP_PROP_FPS, mode.target_fps)

    # Warmup
    for _ in range(warmup_frames):
        ok, _ = cap.read()
        if not ok:
            cap.release()
            return False, "read_failed_warmup"

    # Measure real fps
    n = 0
    t0 = time.perf_counter()
    while (time.perf_counter() - t0) < secs:
        ok, _ = cap.read()
        if not ok:
            cap.release()
            return False, "read_failed"
        n += 1
    dt = time.perf_counter() - t0
    measured_fps = n / dt if dt > 0 else 0.0

    # What the driver says it accepted (not always reliable)
    got_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    got_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    got_fps = cap.get(cv2.CAP_PROP_FPS)
    got_fourcc = fourcc_to_str(cap.get(cv2.CAP_PROP_FOURCC))

    cap.release()
    return True, f"{measured_fps:.1f} fps | got {got_w}x{got_h} {got_fourcc} rep_fps={got_fps:.1f}"

def main():
    # Put your camera indices here. From your lerobot output: 0, 1, 3, 4 (and 4 might be RealSense depending)
    cam_indices = [0, 1, 3, 4]

    modes: List[Mode] = [
        Mode("720p_MJPG_30", "MJPG", 1280, 720, 30),
        Mode("720p_MJPG_60", "MJPG", 1280, 720, 60),
        Mode("720p_YUY2_30", "YUY2", 1280, 720, 30),
        Mode("720p_YUY2_60", "YUY2", 1280, 720, 60),

        Mode("1080p_MJPG_30", "MJPG", 1920, 1080, 30),
        Mode("1080p_YUY2_30", "YUY2", 1920, 1080, 30),
    
        Mode("1080p_MJPG_60", "MJPG", 1920, 1080, 60),
        Mode("1080p_YUY2_60", "YUY2", 1920, 1080, 60),
    ]

    print("Testing cameras with OpenCV DSHOW\n")
    for cam in cam_indices:
        print(f"=== Camera {cam} ===")
        for m in modes:
            ok, info = try_mode(cam, m)
            status = "OK " if ok else "FAIL"
            print(f"{status}  {m.name:14s} -> {info}")
        print()

if __name__ == "__main__":
    main()
