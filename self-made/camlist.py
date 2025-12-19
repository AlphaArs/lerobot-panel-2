import cv2
import time

def probe_camera(idx, backend=cv2.CAP_MSMF, warmup=20):
    cap = cv2.VideoCapture(idx, backend)
    if not cap.isOpened():
        cap.release()
        return None

    # Request something reasonable; device may choose closest
    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1920)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)
    cap.set(cv2.CAP_PROP_FPS, 30)

    ok = False
    frame = None
    for _ in range(warmup):
        ok, frame = cap.read()
        if ok and frame is not None and frame.size > 0:
            break
        time.sleep(0.02)

    if not ok:
        cap.release()
        return None

    info = {
        "index": idx,
        "backend": "MSMF" if backend == cv2.CAP_MSMF else str(backend),
        "frame_shape": frame.shape,
        "width": cap.get(cv2.CAP_PROP_FRAME_WIDTH),
        "height": cap.get(cv2.CAP_PROP_FRAME_HEIGHT),
        "fps": cap.get(cv2.CAP_PROP_FPS),
        "fourcc": int(cap.get(cv2.CAP_PROP_FOURCC)),
    }
    cap.release()
    return info

def fourcc_to_str(v):
    return "".join([chr((v >> (8*i)) & 0xFF) for i in range(4)])

print("Probing camera indices (MSMF)…")
found = []
for i in range(0, 15):
    info = probe_camera(i, backend=cv2.CAP_MSMF)
    if info:
        info["fourcc_str"] = fourcc_to_str(info["fourcc"])
        found.append(info)

if not found:
    print("No working cameras found.")
else:
    for cam in found:
        print(
            f"Index {cam['index']}: {cam['frame_shape']}  "
            f"{int(cam['width'])}x{int(cam['height'])}@{cam['fps']:.1f}  "
            f"FOURCC={cam['fourcc_str']}"
        )
