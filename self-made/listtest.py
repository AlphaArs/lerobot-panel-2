import cv2
import time
import json

RESOLUTIONS = [
    (1920, 1080),
    (1280, 720),
    (640, 480),
]

def probe(cam_id, warmup=5, measure_frames=20):
    cap = cv2.VideoCapture(cam_id, cv2.CAP_MSMF)
    if not cap.isOpened():
        cap.release()
        return None

    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))

    for (w, h) in RESOLUTIONS:
        cap.set(cv2.CAP_PROP_FRAME_WIDTH,  w)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, h)

        # warm-up
        for _ in range(warmup):
            ok, frame = cap.read()
            if not ok:
                break

        # measure FPS
        t0 = time.perf_counter()
        frames = 0
        last = None
        while frames < measure_frames:
            ok, frame = cap.read()
            if not ok:
                break
            last = frame
            frames += 1
        t1 = time.perf_counter()

        if last is None:
            continue

        ah, aw = last.shape[:2]
        fps = frames / (t1 - t0) if (t1 - t0) > 0 else 0

        # Accept if resolution really matches and fps is decent
        if aw == w and ah == h and fps >= 20:
            cap.release()
            return {
                "id": cam_id,
                "backend": "MSMF",
                "width": aw,
                "height": ah,
                "fps": round(fps, 2),
            }

    cap.release()
    return None

def main():
    MAX_CAM_ID = 10
    results = []

    for cam_id in range(MAX_CAM_ID):
        info = probe(cam_id)
        if info:
            results.append(info)

    print(json.dumps(results, indent=2))

if __name__ == "__main__":
    main()
