from __future__ import annotations

import os
import shlex
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Dict, Tuple

from .models import Robot


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


def build_teleop_cmd(leader: Robot, follower: Robot) -> list[str]:
    args = [
        f"--robot.type={follower.device_type()}",
        f"--robot.port={follower.com_port}",
        f"--robot.id={follower.name}",
        f"--teleop.type={leader.device_type()}",
        f"--teleop.port={leader.com_port}",
        f"--teleop.id={leader.name}",
    ]
    entrypoint = _resolve_console_script("lerobot-teleoperate")
    if entrypoint:
        return [entrypoint, *args]
    return [sys.executable, "-u", "-m", "lerobot.scripts.lerobot_teleoperate", *args]
