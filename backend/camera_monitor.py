from __future__ import annotations

import re
import threading
import time
from dataclasses import asdict, dataclass
from typing import Dict, List, Optional, Set, Tuple

POLL_SECONDS = 2.0
# Keep probing snappy: fewer frames for FPS estimate and a short list of common modes.
MAX_FPS_MEASURE_FRAMES = 8
COMMON_MODES = [
    (1920, 1080),
    (1600, 1200),
    (1280, 720),
    (1024, 768),
    (640, 480),
]


def _import_cv2():
    try:
        import cv2  # type: ignore

        return cv2
    except Exception:
        return None


@dataclass
class CameraMode:
    width: int
    height: int
    fps: float

    def to_dict(self) -> dict:
        return {"width": int(self.width), "height": int(self.height), "fps": float(round(self.fps, 2))}


@dataclass
class CameraDevice:
    id: str
    label: str
    kind: str  # "opencv" or "realsense"
    index: Optional[int] = None
    path: Optional[str] = None
    serial_number: Optional[str] = None
    vendor_id: Optional[str] = None
    product_id: Optional[str] = None
    suggested: Optional[CameraMode] = None

    def to_dict(self) -> dict:
        data = asdict(self)
        if self.suggested:
            data["suggested"] = self.suggested.to_dict()
        return data


def _slugify(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip())
    return cleaned or "cam"


class CameraMonitor:
    """
    Background watcher to keep track of available cameras (USB / RealSense).
    Designed to be lightweight: we only probe full mode lists on demand.
    """

    def __init__(self, interval: float = POLL_SECONDS, max_indices: int = 8):
        self.interval = interval
        self.max_indices = max_indices
        self._devices: Dict[str, CameraDevice] = {}
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def start(self) -> None:
        if not self._thread.is_alive():
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread.is_alive():
            self._thread.join(timeout=1)

    def snapshot(self) -> List[CameraDevice]:
        with self._lock:
            return list(self._devices.values())

    def get(self, device_id: str) -> Optional[CameraDevice]:
        with self._lock:
            return self._devices.get(device_id)

    def probe_modes(self, device_id: str) -> tuple[Optional[CameraDevice], List[CameraMode], Optional[CameraMode]]:
        device = self.get(device_id)
        if not device:
            return None, [], None
        if device.kind == "realsense":
            return device, *self._probe_realsense_modes(device)
        return device, *self._probe_opencv_modes(device)

    def capture_frame(
        self, device_id: str, width: Optional[int] = None, height: Optional[int] = None, fps: Optional[float] = None
    ) -> Optional[bytes]:
        device = self.get(device_id)
        if not device:
            return None
        if device.kind == "realsense":
            return self._capture_realsense_frame(device, width=width, height=height, fps=fps)
        return self._capture_opencv_frame(device, width=width, height=height, fps=fps)

    def _run(self) -> None:
        while not self._stop.is_set():
            devices = self._detect_devices()
            with self._lock:
                self._devices = devices
            time.sleep(self.interval)

    def _detect_devices(self) -> Dict[str, CameraDevice]:
        devices: Dict[str, CameraDevice] = {}
        realsense_devices = self._detect_realsense()
        for cam in realsense_devices:
            devices[cam.id] = cam
        realsense_signatures: Set[Tuple[str, str]] = set()
        realsense_serials: Set[str] = set()
        for cam in realsense_devices:
            sig = (cam.vendor_id or "", cam.product_id or "")
            if sig != ("", ""):
                realsense_signatures.add((sig[0].lower(), sig[1].lower()))
            if cam.serial_number:
                realsense_serials.add(cam.serial_number)
        for cam in self._detect_opencv(realsense_signatures, realsense_serials):
            devices[cam.id] = cam
        return devices

    def _detect_realsense(self) -> List[CameraDevice]:
        try:
            import pyrealsense2 as rs  # type: ignore
        except Exception:
            return []

        found: List[CameraDevice] = []
        try:
            ctx = rs.context()
            for dev in ctx.query_devices():
                try:
                    serial = dev.get_info(rs.camera_info.serial_number)
                except Exception:
                    serial = None
                try:
                    name = dev.get_info(rs.camera_info.name)
                except Exception:
                    name = "Intel RealSense"
                try:
                    vendor_id = dev.get_info(rs.camera_info.vendor_id)
                except Exception:
                    vendor_id = None
                try:
                    product_id = dev.get_info(rs.camera_info.product_id)
                except Exception:
                    product_id = None

                suggested = None
                try:
                    for sensor in dev.sensors:
                        for profile in sensor.profiles:
                            try:
                                vprof = profile.as_video_stream_profile()
                                if vprof.stream_type() != rs.stream.color:
                                    continue
                                suggested = CameraMode(
                                    width=vprof.width(),
                                    height=vprof.height(),
                                    fps=float(profile.fps()),
                                )
                                break
                            except Exception:
                                continue
                        if suggested:
                            break
                except Exception:
                    suggested = None

                device_id = f"realsense:{serial or name}"
                found.append(
                    CameraDevice(
                        id=device_id,
                        label=name or device_id,
                        kind="realsense",
                        index=None,
                        path=serial,
                        serial_number=serial,
                        vendor_id=vendor_id,
                        product_id=product_id,
                        suggested=suggested,
                    )
                )
        except Exception:
            return []
        return found

    def _detect_opencv(
        self,
        exclude_signatures: Optional[Set[Tuple[str, str]]] = None,
        exclude_serials: Optional[Set[str]] = None,
    ) -> List[CameraDevice]:
        cv2 = _import_cv2()
        if cv2 is None:
            return []

        devices: Dict[str, CameraDevice] = {}

        # Best effort hardware enumeration
        try:
            from cv2_enumerate_cameras import enumerate_cameras  # type: ignore

            for cam in enumerate_cameras(cv2.CAP_MSMF):
                name_lower = (cam.name or "").lower()
                if "realsense" in name_lower:
                    continue
                sig = (str(cam.vid or "").lower(), str(cam.pid or "").lower())
                if exclude_signatures and sig in exclude_signatures:
                    continue
                if exclude_serials and any(s and s in (cam.path or "") for s in exclude_serials):
                    continue

                raw_id = cam.path or str(cam.index)
                device_id = f"opencv:{_slugify(str(raw_id))}"
                suggested = self._suggest_from_default_props(cv2, cam.index)
                while device_id in devices:
                    device_id = f"{device_id}-{len(devices)}"
                devices[device_id] = CameraDevice(
                    id=device_id,
                    label=cam.name or f"Camera {cam.index}",
                    kind="opencv",
                    index=cam.index,
                    path=cam.path or None,
                    serial_number=None,
                    vendor_id=str(cam.vid) if getattr(cam, "vid", None) else None,
                    product_id=str(cam.pid) if getattr(cam, "pid", None) else None,
                    suggested=suggested,
                )
        except Exception:
            # silently ignore and fall back to index probing
            pass

        if devices:
            return list(devices.values())

        # Fallback: try opening a handful of indices
        for idx in range(self.max_indices):
            cap = cv2.VideoCapture(idx, cv2.CAP_MSMF)
            if not cap.isOpened():
                cap.release()
                continue
            suggested = self._suggest_from_props(cap)
            cap.release()
            device_id = f"opencv:{_slugify(str(idx))}"
            devices[device_id] = CameraDevice(
                id=device_id,
                label=f"Camera {idx}",
                kind="opencv",
                index=idx,
                path=str(idx),
                serial_number=None,
                suggested=suggested,
            )
        return list(devices.values())

    def _suggest_from_default_props(self, cv2, index: int) -> Optional[CameraMode]:
        cap = cv2.VideoCapture(index, cv2.CAP_MSMF)
        if not cap.isOpened():
            cap.release()
            return None
        mode = self._suggest_from_props(cap)
        cap.release()
        return mode

    def _suggest_from_props(self, cap) -> Optional[CameraMode]:
        try:
            width = int(round(cap.get(3)))  # CAP_PROP_FRAME_WIDTH
            height = int(round(cap.get(4)))  # CAP_PROP_FRAME_HEIGHT
            fps = float(cap.get(5) or 0.0)  # CAP_PROP_FPS
            if width <= 0 or height <= 0:
                return None
            if fps <= 0:
                fps = 30.0
            return CameraMode(width=width, height=height, fps=fps)
        except Exception:
            return None

    def _probe_opencv_modes(self, device: CameraDevice) -> tuple[List[CameraMode], Optional[CameraMode]]:
        cv2 = _import_cv2()
        if cv2 is None:
            return [], None

        target = device.index if device.index is not None else device.path
        cap = cv2.VideoCapture(target)
        if not cap.isOpened():
            cap.release()
            return [], None

        accepted: List[CameraMode] = []
        seen = set()
        for w, h in COMMON_MODES:
            try:
                cap.set(cv2.CAP_PROP_FRAME_WIDTH, w)
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, h)
                time.sleep(0.02)
                aw = int(round(cap.get(cv2.CAP_PROP_FRAME_WIDTH)))
                ah = int(round(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)))
                if (aw, ah) != (w, h):
                    continue
                key = (aw, ah)
                if key in seen:
                    continue
                seen.add(key)
                fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
                if fps <= 0.1:
                    fps = self._measure_fps(cap)
                accepted.append(CameraMode(width=aw, height=ah, fps=fps))
            except Exception:
                continue

        cap.release()

        if not accepted and device.suggested:
            accepted.append(device.suggested)

        accepted.sort(key=lambda m: (m.width * m.height, m.fps), reverse=True)
        suggested = accepted[0] if accepted else None
        return accepted, suggested

    def _probe_realsense_modes(self, device: CameraDevice) -> tuple[List[CameraMode], Optional[CameraMode]]:
        try:
            import pyrealsense2 as rs  # type: ignore
        except Exception:
            return [], None

        modes: List[CameraMode] = []
        try:
            ctx = rs.context()
            target = None
            for dev in ctx.query_devices():
                try:
                    serial = dev.get_info(rs.camera_info.serial_number)
                except Exception:
                    serial = None
                if serial == device.serial_number or serial == device.path:
                    target = dev
                    break
            if not target:
                return [], None
            for sensor in target.sensors:
                for profile in sensor.profiles:
                    try:
                        vprof = profile.as_video_stream_profile()
                        if vprof.stream_type() != rs.stream.color:
                            continue
                        modes.append(CameraMode(width=vprof.width(), height=vprof.height(), fps=float(profile.fps())))
                    except Exception:
                        continue
        except Exception:
            return [], None

        modes.sort(key=lambda m: (m.width * m.height, m.fps), reverse=True)
        suggested = modes[0] if modes else device.suggested
        return modes, suggested

    def _capture_opencv_frame(
        self, device: CameraDevice, width: Optional[int] = None, height: Optional[int] = None, fps: Optional[float] = None
    ) -> Optional[bytes]:
        cv2 = _import_cv2()
        if cv2 is None:
            return None

        target = device.index if device.index is not None else device.path
        cap = cv2.VideoCapture(target)
        if not cap.isOpened():
            cap.release()
            return None

        try:
            if width and height:
                cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
            if fps and fps > 0:
                cap.set(cv2.CAP_PROP_FPS, fps)

            # Warmup a couple of frames to avoid black images
            for _ in range(3):
                cap.read()

            ok, frame = cap.read()
            if not ok or frame is None:
                return None
            ok, buffer = cv2.imencode(".jpg", frame)
            if not ok:
                return None
            return buffer.tobytes()
        except Exception:
            return None
        finally:
            cap.release()

    def _capture_realsense_frame(
        self, device: CameraDevice, width: Optional[int] = None, height: Optional[int] = None, fps: Optional[float] = None
    ) -> Optional[bytes]:
        try:
            import pyrealsense2 as rs  # type: ignore
            import cv2  # type: ignore
        except Exception:
            return None

        config = rs.config()
        try:
            serial = device.serial_number or device.path
            if serial:
                config.enable_device(serial)
        except Exception:
            pass

        w = width or (device.suggested.width if device.suggested else 640)
        h = height or (device.suggested.height if device.suggested else 480)
        target_fps = int(round(fps or (device.suggested.fps if device.suggested else 30)))

        try:
            config.enable_stream(rs.stream.color, w, h, rs.format.bgr8, target_fps)
        except Exception:
            return None

        pipeline = rs.pipeline()
        try:
            pipeline.start(config)
            for _ in range(6):
                frames = pipeline.wait_for_frames(timeout_ms=1500)
                color = frames.get_color_frame()
                if color:
                    frame = color.get_data()
                    if frame is None:
                        continue
                    import numpy as np  # type: ignore

                    img = np.asanyarray(frame)
                    ok, buffer = cv2.imencode(".jpg", img)
                    if ok:
                        return buffer.tobytes()
            return None
        except Exception:
            return None
        finally:
            try:
                pipeline.stop()
            except Exception:
                pass

    def _measure_fps(self, cap) -> float:
        start = time.perf_counter()
        frames = 0
        for _ in range(MAX_FPS_MEASURE_FRAMES):
            ok, _ = cap.read()
            if not ok:
                break
            frames += 1
        elapsed = time.perf_counter() - start
        if elapsed <= 0:
            return 0.0
        return frames / elapsed
