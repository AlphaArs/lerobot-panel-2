#!/usr/bin/env python
"""
Prompt for COM port, device name, and SO101 type, then run the matching
`lerobot-calibrate` command using the current Python interpreter.

The script adds the local `lerobot/src` to PYTHONPATH so it works with a
checkout of the repo as well as an installed package.
"""

from __future__ import annotations

import os
import shlex
import subprocess
import sys
from pathlib import Path
from typing import Callable


SUPPORTED_TYPES = {
    "so101_follower": "robot",
    "so101_leader": "teleop",
}


def prompt(label: str, *, default: str | None = None, validator: Callable[[str], bool] | None = None) -> str:
    while True:
        suffix = f" [{default}]" if default else ""
        value = input(f"{label}{suffix}: ").strip()
        if not value:
            if default is not None:
                return default
            print("Please enter a value.")
            continue
        if validator and not validator(value):
            print("Invalid value, try again.")
            continue
        return value


def choose_type() -> str:
    options = list(SUPPORTED_TYPES.keys())
    return choose_from_menu("Device type", options, default_index=0)


def choose_from_menu(
    label: str, options: list[str], *, default_index: int = 0, allow_manual: bool = False
) -> str:
    print(f"{label}:")
    for idx, option in enumerate(options, start=1):
        default_marker = " (default)" if idx - 1 == default_index else ""
        print(f"  {idx}. {option}{default_marker}")

    prompt_text = "Enter number"
    if allow_manual:
        prompt_text += " or type a value"
    prompt_text += " (blank for default): "

    while True:
        choice = input(prompt_text).strip()
        if not choice:
            return options[default_index]
        if choice.isdigit():
            idx = int(choice) - 1
            if 0 <= idx < len(options):
                return options[idx]
        if allow_manual:
            return choice
        print("Invalid selection, try again.")


def detect_com_ports() -> list[tuple[str, str]]:
    """
    Try to list COM ports via pyserial; falls back to empty list if unavailable.
    Returns a list of (device, description).
    """
    try:
        from serial.tools import list_ports
    except Exception:
        return []

    ports = []
    for info in list_ports.comports():
        device = info.device
        desc = info.description or device
        if device:
            ports.append((device, desc))
    return ports


def choose_port() -> str:
    ports = detect_com_ports()
    if ports:
        menu_entries = [
            f"{device} ({desc})" if desc and desc != device else device for device, desc in ports
        ]
        selected = choose_from_menu("COM port", menu_entries, default_index=0, allow_manual=True)
        # If the user picked an entry from the menu, map back to the device value.
        for device, desc in ports:
            if selected == f"{device} ({desc})" or selected == device:
                return device
        return selected

    print("No COM ports detected automatically; type one manually (e.g. COM14).")
    return prompt("COM port")


def build_command(device_type: str, port: str, name: str) -> list[str]:
    role = SUPPORTED_TYPES[device_type]
    return [
        sys.executable,
        "-m",
        "lerobot.scripts.lerobot_calibrate",
        f"--{role}.type={device_type}",
        f"--{role}.port={port}",
        f"--{role}.id={name}",
    ]


def add_repo_to_env(env: dict[str, str]) -> tuple[dict[str, str], Path | None]:
    repo_src = Path(__file__).resolve().parent / "lerobot" / "src"
    if repo_src.exists():
        env = env.copy()
        existing = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = f"{repo_src}{os.pathsep}{existing}" if existing else str(repo_src)
        return env, repo_src.parent
    return env, None


def main() -> int:
    device_type = choose_type()
    port = choose_port()
    name = prompt("Device name", default=device_type)

    cmd = build_command(device_type, port, name)
    env, repo_root = add_repo_to_env(os.environ)
    cwd = repo_root if repo_root else Path.cwd()

    readable_cmd = subprocess.list2cmdline(cmd) if os.name == "nt" else " ".join(shlex.quote(c) for c in cmd)
    print(f"\nExecuting: {readable_cmd}\n")

    try:
        result = subprocess.run(cmd, env=env, cwd=cwd)
    except KeyboardInterrupt:
        print("\nCancelled.")
        return 130
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
