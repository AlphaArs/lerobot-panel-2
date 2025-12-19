import json
import cv2

def get_dshow_device_names():
    try:
        from pygrabber.dshow_graph import FilterGraph
        return FilterGraph().get_input_devices()
    except Exception:
        return []

def open_and_read(index: int, backend: int, settings=None, warmup=3):
    cap = cv2.VideoCapture(index, backend)
    if not cap.isOpened():
        cap.release()
        return None, None, None

    if settings:
        for (prop, val) in settings:
            cap.set(prop, val)

    # Warm up: some backends need a few reads before settling
    frame = None
    ok = False
    for _ in range(max(1, warmup)):
        ok, frame = cap.read()
        if ok and frame is not None:
            break

    if ok and frame is not None:
        h, w = frame.shape[:2]
        fps = cap.get(cv2.CAP_PROP_FPS)
        cap.release()
        return int(w), int(h), float(fps) if fps else None

    # fallback to reported props
    w = cap.get(cv2.CAP_PROP_FRAME_WIDTH)
    h = cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
    fps = cap.get(cv2.CAP_PROP_FPS)
    cap.release()
    if w and h:
        return int(w), int(h), float(fps) if fps else None
    return None, None, None

def backend_name(backend):
    return "DSHOW" if backend == cv2.CAP_DSHOW else "MSMF"

def main():
    names = get_dshow_device_names()

    # Probe a reasonable range; if names known, probe that many + a couple extra
    max_probe = max(len(names) + 2, 10)

    # Settings like your working snippet
    mjpg_1080p30 = [
        (cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG")),
        (cv2.CAP_PROP_FRAME_WIDTH, 1920),
        (cv2.CAP_PROP_FRAME_HEIGHT, 1080),
        (cv2.CAP_PROP_FPS, 30),
    ]

    results = []
    for i in range(max_probe):
        nm = names[i] if i < len(names) else None

        for backend in (cv2.CAP_DSHOW, cv2.CAP_MSMF):
            entry = {
                "backend": backend_name(backend),
                "id": i,
                "name": nm,
                "opened_default": False,
                "default": {"width": None, "height": None, "fps": None},
                "mjpg_1080p30": {"width": None, "height": None, "fps": None},
            }

            w, h, fps = open_and_read(i, backend, settings=None, warmup=2)
            if w and h:
                entry["opened_default"] = True
                entry["default"] = {"width": w, "height": h, "fps": fps}

                w2, h2, fps2 = open_and_read(i, backend, settings=mjpg_1080p30, warmup=4)
                if w2 and h2:
                    entry["mjpg_1080p30"] = {"width": w2, "height": h2, "fps": fps2}

            results.append(entry)

    # Keep only devices that open at least at default
    results = [r for r in results if r["opened_default"]]

    print(json.dumps(results, indent=2))

if __name__ == "__main__":
    main()
