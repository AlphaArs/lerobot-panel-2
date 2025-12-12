from __future__ import annotations

import os
import subprocess
import tempfile
import uuid
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from threading import Lock, Thread
from typing import Deque, Optional

from .commands import _build_env, _find_repo_root, build_calibration_cmd
from .models import Robot


@dataclass
class CalibrationSessionState:
    id: str
    robot_id: str
    logs: Deque[str] = field(default_factory=lambda: deque(maxlen=400))
    process: Optional[subprocess.Popen[str]] = None
    enter_flag: Optional[Path] = None
    running: bool = False
    return_code: Optional[int] = None
    dry_run: bool = False

    def snapshot(self) -> dict:
        return {
            "session_id": self.id,
            "robot_id": self.robot_id,
            "logs": list(self.logs),
            "running": self.running,
            "return_code": self.return_code,
            "dry_run": self.dry_run,
        }


class CalibrationManager:
    def __init__(self) -> None:
        self._sessions: dict[str, CalibrationSessionState] = {}
        self._lock = Lock()

    def start(self, robot: Robot, *, dry_run: bool = False) -> CalibrationSessionState:
        session_id = uuid.uuid4().hex
        cmd = build_calibration_cmd(robot)
        env = _build_env()
        cwd = _find_repo_root() or Path.cwd()
        enter_flag = Path(tempfile.gettempdir()) / f"lerobot_enter_{session_id}.flag"

        state = CalibrationSessionState(
            id=session_id,
            robot_id=robot.id,
            enter_flag=enter_flag,
            dry_run=dry_run,
        )

        if dry_run:
            readable_cmd = subprocess.list2cmdline(cmd) if os.name == "nt" else " ".join(cmd)
            state.logs.append(f"[dry-run] {readable_cmd}")
            state.return_code = 0
            self._store(state)
            return state

        env["LEROBOT_ENTER_FLAG"] = str(enter_flag)

        try:
            process = subprocess.Popen(
                cmd,
                env=env,
                cwd=cwd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
        except Exception as exc:
            state.logs.append(f"Failed to start calibration: {exc}")
            state.return_code = -1
            self._store(state)
            return state

        state.process = process
        state.running = True
        self._store(state)

        Thread(target=self._consume_output, args=(state,), daemon=True).start()
        Thread(target=self._watch_process, args=(state,), daemon=True).start()
        return state

    def _consume_output(self, state: CalibrationSessionState) -> None:
        if not state.process or not state.process.stdout:
            return
        for line in iter(state.process.stdout.readline, ""):
            clean = line.rstrip("\n")
            if clean:
                state.logs.append(clean)
        if state.process.stdout:
            state.process.stdout.close()

    def _watch_process(self, state: CalibrationSessionState) -> None:
        if not state.process:
            return
        state.process.wait()
        state.return_code = state.process.returncode
        state.running = False
        try:
            if state.enter_flag and state.enter_flag.exists():
                state.enter_flag.unlink()
        except OSError:
            pass

    def _store(self, state: CalibrationSessionState) -> None:
        with self._lock:
            self._sessions[state.id] = state

    def get(self, session_id: str) -> Optional[CalibrationSessionState]:
        with self._lock:
            return self._sessions.get(session_id)

    def send_enter(self, session_id: str) -> tuple[bool, str]:
        state = self.get(session_id)
        if not state:
            return False, "Session not found."
        if state.dry_run:
            return False, "Dry-run session does not accept input."
        if not state.process or state.process.poll() is not None:
            state.running = False
            return False, "Calibration process is not running."

        try:
            if state.process.stdin:
                state.process.stdin.write("\n")
                state.process.stdin.flush()
        except Exception as exc:
            return False, f"Failed to send input: {exc}"
        return True, "ENTER sent."

    def send_stop(self, session_id: str) -> tuple[bool, str]:
        state = self.get(session_id)
        if not state:
            return False, "Session not found."
        if state.dry_run:
            return False, "Dry-run session does not accept input."
        if not state.process or state.process.poll() is not None:
            state.running = False
            return False, "Calibration process is not running."

        try:
            if state.enter_flag:
                state.enter_flag.touch(exist_ok=True)
            if state.process.stdin:
                state.process.stdin.write("\n")
                state.process.stdin.flush()
        except Exception as exc:
            return False, f"Failed to send input: {exc}"
        return True, "Stop ENTER sent."

    def cancel(self, session_id: str) -> tuple[bool, str]:
        state = self.get(session_id)
        if not state:
            return False, "Session not found."
        if state.dry_run:
            return True, "Dry-run session closed."

        proc = state.process
        if not proc:
            return False, "No process to cancel."

        if proc.poll() is None:
            try:
                proc.terminate()
            except Exception:
                proc.kill()
            try:
                proc.wait(timeout=1)
            except Exception:
                proc.kill()
        state.running = False
        state.return_code = proc.returncode
        try:
            if state.enter_flag and state.enter_flag.exists():
                state.enter_flag.unlink()
        except OSError:
            pass
        return True, "Calibration cancelled."

    def snapshot(self, session_id: str) -> Optional[dict]:
        state = self.get(session_id)
        if not state:
            return None
        return state.snapshot()
