import subprocess
import re
import time
import hashlib
from dataclasses import dataclass
from typing import List, Dict, Optional, Tuple

import cv2
import numpy as np


@dataclass
class PnpCam:
    name: str
    instance_id: str


def list_present_cameras_pnp() -> List[PnpCam]:
    """
    Returns cameras currently PRESENT according to Windows PnP.
    Uses PowerShell only (no extra Python deps).
    """
    ps = r"""
$classes = @("Camera","Image")
$devs = foreach ($c in $classes) {
  Get-PnpDevice -PresentOnly -Class $c -Status OK -ErrorAction SilentlyContinue
}
$devs | Sort-Object FriendlyName | ForEach-Object {
  "{0}|||{1}" -f $_.FriendlyName, $_.InstanceId
}
"""
    try:
        out = subprocess.check_output(
            ["powershell", "-NoProfile", "-Command", ps],
            text=True,
            stderr=subprocess.STDOUT,
        )
    except Exception as e:
        print("PowerShell query failed:", e)
        return []

    cams = []
    for line in out.splitlines():
        line = line.strip()
        if not line or "|||" not in line:
            continue
        name, iid = line.split("|||", 1)
        cams.append(PnpCam(name=name.strip(), instance_id=iid.strip()))
    return cams


def frame_hash(frame: np.ndarray) -> str:
    """
    Robust-ish hash: resize + grayscale + sha1.
    Good enough to detect 'same camera feed' duplicates.
    """
    small = cv2.resize(frame, (64, 64), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    return hashlib.sha1(gray.tobytes()).hexdigest()


def try_open_index(i: int, backend: int, warmup: int = 10) -> Tuple[bool, Optional[np.ndarray]]:
    cap = cv2.VideoCapture(i, backend)
    if not cap.isOpened():
        cap.release()
        return False, None

    # Warm up
    frame = None
    for _ in range(warmup):
        ok, fr = cap.read()
        if ok and fr is not None and fr.size > 0:
            frame = fr
            break
        time.sleep(0.02)

    cap.release()
    if frame is None:
        return True, None
    return True, frame


def probe_indices(max_index: int = 15, backends: List[Tuple[str, int]] = None):
    if backends is None:
        backends = [
            ("DSHOW", cv2.CAP_DSHOW),
            ("MSMF", cv2.CAP_MSMF),
            ("ANY", cv2.CAP_ANY),
        ]

    print("=== Present cameras (PnP) ===")
    pnp = list_present_cameras_pnp()
    if not pnp:
        print("No PnP camera devices found (or PowerShell blocked).")
    else:
        for c in pnp:
            print(f"{c.name:45s} {c.instance_id}")

    print("\n=== OpenCV probing ===")
    for backend_name, backend in backends:
        print(f"\n--- Backend: {backend_name} ---")
        results = []
        for i in range(max_index + 1):
            opened, frame = try_open_index(i, backend)
            if not opened:
                continue
            h = None
            shape = None
            if frame is not None:
                h = frame_hash(frame)
                shape = frame.shape
            results.append((i, shape, h))

        if not results:
            print("No indices opened.")
            continue

        # Group by hash to find duplicates
        groups: Dict[str, List[int]] = {}
        for i, shape, h in results:
            key = h if h is not None else f"NOFRAME_{i}"
            groups.setdefault(key, []).append(i)

        for i, shape, h in results:
            dup = ""
            if h is not None and len(groups[h]) > 1:
                dup = f"  <-- DUP with {groups[h]}"
            print(f"index {i:2d}: opened, shape={shape}, hash={h}{dup}")

        # Summary: unique indices
        unique = [inds[0] for k, inds in groups.items() if not k.startswith("NOFRAME_")]
        print("Unique-video indices (one per distinct hash):", unique)


if __name__ == "__main__":
    probe_indices(max_index=20)
