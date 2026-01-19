from __future__ import annotations

import os
import re
import shlex
import shutil
import subprocess
import sys
import urllib.parse
from pathlib import Path
from typing import Callable, Dict, Iterable, Tuple

from .models import Robot, RobotCamera

DEFAULT_TELEOP_FPS = 20
DEFAULT_CAMERA_WIDTH = 1280
DEFAULT_CAMERA_HEIGHT = 720
DEFAULT_CAMERA_FPS = 20.0
DEFAULT_CAMERA_FOURCC = "MJPG"
REALSENSE_KIND = "intelrealsense"
# Default off: only embed shared stream URLs in teleop commands if explicitly enabled.
PANEL_STREAM_CAMERAS = os.environ.get("LEROBOT_PANEL_STREAM_CAMERAS", "0").lower() not in ("0", "false", "no")


def _find_repo_root() -> Path | None:
    candidate = Path(__file__).resolve().parent.parent / "lerobot" / "src"
    if candidate.exists():
        return candidate.parent
    return None


def _build_env() -> Dict[str, str]:
    env = os.environ.copy()
    repo_root = _find_repo_root()
    if repo_root:
        existing = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = f"{repo_root / 'src'}{os.pathsep}{existing}" if existing else str(
            repo_root / "src"
        )
    return env


def _resolve_console_script(name: str) -> str | None:
    suffix = ".exe" if os.name == "nt" else ""
    candidate = Path(sys.executable).resolve().parent / f"{name}{suffix}"
    if candidate.exists():
        return str(candidate)
    return shutil.which(name)


def _slugify_camera_name(name: str, *, fallback: str = "cam") -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_-]+", "_", (name or "").strip().lower())
    return cleaned or fallback


def _camera_stream_url(device_id: str, *, width: int | None, height: int | None, fps: float | None) -> str:
    base = os.environ.get("LEROBOT_PANEL_API_BASE", "http://127.0.0.1:8000").rstrip("/")
    params = []
    if width:
        params.append(f"width={int(width)}")
    if height:
        params.append(f"height={int(height)}")
    if fps and fps > 0:
        params.append(f"fps={fps}")
    params.append("shared=true")
    query = f"?{'&'.join(params)}" if params else ""
    return f"{base}/cameras/{urllib.parse.quote(device_id)}/stream{query}"


def _quote_identifier(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, (int, float)):
        return str(value)
    s = str(value)
    if s == "":
        return ""
    if all(c.isalnum() or c in "._-" for c in s):
        return s
    escaped = s.replace('"', '\\"')
    return f'"{escaped}"'


def _resolve_camera_target(
    cam: RobotCamera,
    devices: Iterable[object],
    resolve_index_from_container: Callable[[str], int | None] | None,
) -> tuple[object | None, str | None]:
    """
    Try to translate a saved camera entry back to a live OpenCV index or device path.
    """

    def _norm(value: object | None) -> str:
        return (str(value or "")).strip().lower()

    if resolve_index_from_container and cam.container_id:
        try:
            resolved = resolve_index_from_container(cam.container_id)
            if resolved is not None:
                return resolved, "container_id"
        except Exception:
            pass

    for dev in devices:
        if cam.container_id and _norm(getattr(dev, "container_id", None)) == _norm(cam.container_id):
            value = (
                getattr(dev, "index", None)
                if getattr(dev, "index", None) is not None
                else (getattr(dev, "path", None) or getattr(dev, "id", None))
            )
            return value, "container_id"

    for dev in devices:
        if cam.path and _norm(getattr(dev, "path", None)) == _norm(cam.path):
            value = (
                getattr(dev, "index", None)
                if getattr(dev, "index", None) is not None
                else (getattr(dev, "path", None) or getattr(dev, "id", None))
            )
            return value, "path"

    for dev in devices:
        if cam.serial_number and _norm(getattr(dev, "serial_number", None)) == _norm(cam.serial_number):
            value = (
                getattr(dev, "index", None)
                if getattr(dev, "index", None) is not None
                else (getattr(dev, "path", None) or getattr(dev, "id", None))
            )
            return value, "serial_number"

    for dev in devices:
        if cam.device_id and _norm(getattr(dev, "id", None)) == _norm(cam.device_id):
            value = (
                getattr(dev, "index", None)
                if getattr(dev, "index", None) is not None
                else (getattr(dev, "path", None) or getattr(dev, "id", None))
            )
            return value, "device_id"

    if cam.index is not None:
        return cam.index, "saved index"
    if cam.path:
        return cam.path, "saved path"
    if cam.serial_number:
        return cam.serial_number, "saved serial"
    if cam.device_id:
        return cam.device_id, "saved device_id"
    return None, None


def _format_robot_cameras_arg(
    follower: Robot,
    devices: Iterable[object] | None = None,
    resolve_index_from_container: Callable[[str], int | None] | None = None,
) -> tuple[list[str], int | None, list[str]]:
    """
    Build the --robot.cameras argument using saved follower cameras.
    Returns (args, suggested_loop_fps, notes).
    """
    if not follower.cameras:
        return [], None, []

    devices = list(devices or [])
    notes: list[str] = []
    target_fps_values: list[float] = []
    entries: list[str] = []
    seen: set[str] = set()

    for cam in follower.cameras:
        raw_kind = (cam.kind or "opencv").strip().lower()
        kind = REALSENSE_KIND if raw_kind in ("realsense", REALSENSE_KIND) else "opencv"

        name = _slugify_camera_name(cam.name or "camera")
        base = name
        suffix = 1
        while name in seen:
            name = f"{base}_{suffix}"
            suffix += 1
        seen.add(name)

        index_or_path, source = _resolve_camera_target(cam, devices, resolve_index_from_container)
        if index_or_path is None:
            notes.append(f"[panel] Skipped camera '{cam.name}' (no index/path resolved).")
            continue
        width = int(cam.width or DEFAULT_CAMERA_WIDTH)
        height = int(cam.height or DEFAULT_CAMERA_HEIGHT)
        fps = float(cam.fps or DEFAULT_CAMERA_FPS)
        target_fps_values.append(fps)
        stream_url = None
        if PANEL_STREAM_CAMERAS and cam.device_id and kind == "opencv":
            stream_url = _camera_stream_url(cam.device_id, width=width, height=height, fps=fps)

        fps_rendered = int(fps) if fps.is_integer() else round(fps, 2)
        identifier_key = "serial_number_or_name" if kind == REALSENSE_KIND else "index_or_path"
        identifier_value = stream_url or index_or_path
        identifier_value = _quote_identifier(identifier_value)
        parts = [
            f"type: {kind}",
            f"{identifier_key}: {identifier_value}",
            f"width: {width}",
            f"height: {height}",
            f"fps: {fps_rendered}",
        ]
        if kind == "opencv":
            parts.append(f"fourcc: {DEFAULT_CAMERA_FOURCC}")

        entries.append(f"{name}: {{ {', '.join(parts)} }}")
        note_source = f"via {source}" if source else "from saved data"
        if stream_url:
            notes.append(f"[panel] Camera '{cam.name}' -> {stream_url} (shared stream).")
        else:
            notes.append(f"[panel] Camera '{cam.name}' -> {index_or_path} ({note_source}, type={kind}).")

    if not entries:
        return [], None, notes

    cameras_value = f"{{{', '.join(entries)}}}"
    valid_fps = [v for v in target_fps_values if v > 0]
    loop_fps = int(round(min(valid_fps))) if valid_fps else DEFAULT_TELEOP_FPS
    args = [f"--robot.cameras={cameras_value}", "--display_data=true", f"--fps={loop_fps}"]
    return args, loop_fps, notes


def build_calibration_cmd(robot: Robot) -> list[str]:
    role_key = "teleop" if robot.role == "leader" else "robot"
    return [
        sys.executable,
        "-u",  # unbuffered stdout/stderr so UI sees logs immediately
        "-m",
        "lerobot.scripts.lerobot_calibrate",
        f"--{role_key}.type={robot.device_type()}",
        f"--{role_key}.port={robot.com_port}",
        f"--{role_key}.id={robot.name}",
    ]


def run_calibration(robot: Robot, *, dry_run: bool = False) -> Tuple[bool, str]:
    cmd = build_calibration_cmd(robot)
    readable = subprocess.list2cmdline(cmd) if os.name == "nt" else " ".join(shlex.quote(p) for p in cmd)
    if dry_run:
        return True, f"[dry-run] {readable}"

    if not shutil.which(sys.executable):
        return False, "Python interpreter not found."

    env = _build_env()
    cwd = _find_repo_root() or Path.cwd()
    try:
        result = subprocess.run(cmd, env=env, cwd=cwd)
    except Exception as exc:
        return False, f"Failed to start calibration: {exc}"

    if result.returncode == 0:
        return True, f"Executed: {readable}"
    return False, f"Calibration command failed with code {result.returncode}."


def build_teleop_cmd(
    leader: Robot,
    follower: Robot,
    *,
    camera_devices: Iterable[object] | None = None,
    resolve_index_from_container: Callable[[str], int | None] | None = None,
) -> tuple[list[str], list[str]]:
    args = [
        f"--robot.type={follower.device_type()}",
        f"--robot.port={follower.com_port}",
        f"--robot.id={follower.name}",
        f"--teleop.type={leader.device_type()}",
        f"--teleop.port={leader.com_port}",
        f"--teleop.id={leader.name}",
    ]

    camera_args, _, notes = _format_robot_cameras_arg(
        follower, devices=camera_devices, resolve_index_from_container=resolve_index_from_container
    )
    args.extend(camera_args)

    entrypoint = _resolve_console_script("lerobot-teleoperate")
    cmd = [entrypoint, *args] if entrypoint else [sys.executable, "-u", "-m", "lerobot.scripts.lerobot_teleoperate", *args]
    return cmd, notes
