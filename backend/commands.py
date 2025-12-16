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


def run_teleop(leader: Robot, follower: Robot, *, dry_run: bool = False) -> Tuple[bool, str]:
    """
    Placeholder hook for teleoperation. The actual command is project-specific; for now
    we simply acknowledge the request.
    """
    if dry_run:
        return True, "[dry-run] Teleop request accepted."
    # This is intentionally minimal so it can be swapped with the real command later.
    return True, f"Ready to teleoperate {follower.name} from {leader.name}."
