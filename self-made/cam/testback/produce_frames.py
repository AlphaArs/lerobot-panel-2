import cv2, time, os

def open_cam(idx, w=1280, h=720, fps=20):
    cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open cam {idx}")

    # set FOURCC last (critical)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, w)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, h)
    cap.set(cv2.CAP_PROP_FPS, fps)
    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
    try:
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    except Exception:
        pass
    return cap

cam_idx = 1
cap = open_cam(cam_idx)

# warmup
for _ in range(30):
    cap.read()

ok, frame = cap.read()
print("read ok?", ok, "frame is None?", frame is None)

if ok and frame is not None:
    os.makedirs("frames_out", exist_ok=True)
    cv2.imwrite(f"frames_out/cam{cam_idx}.jpg", frame)
    print("saved", f"frames_out/cam{cam_idx}.jpg")

cap.release()
