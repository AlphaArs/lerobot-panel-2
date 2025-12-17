from __future__ import annotations

import os
import signal
import subprocess
import uuid
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from threading import Lock, Thread
from typing import Deque, Optional

from .commands import _build_env, _find_repo_root, build_teleop_cmd
from .models import Robot


@dataclass
class TeleopSessionState:
    id: str
    leader_id: str
    follower_id: str
    logs: Deque[str] = field(default_factory=lambda: deque(maxlen=600))
    process: Optional[subprocess.Popen[str]] = None
    running: bool = False
    return_code: Optional[int] = None
    dry_run: bool = False
    cmd: list[str] = field(default_factory=list)
    readable_cmd: str = ""

    def snapshot(self) -> dict:
        return {
            "session_id": self.id,
            "leader_id": self.leader_id,
            "follower_id": self.follower_id,
            "logs": list(self.logs),
            "running": self.running,
            "dry_run": self.dry_run,
            "return_code": self.return_code,
            "command": self.readable_cmd,
        }


class TeleopManager:
    def __init__(self) -> None:
        self._sessions: dict[str, TeleopSessionState] = {}
        self._active_session_id: str | None = None
        self._lock = Lock()

    def _store(self, state: TeleopSessionState) -> None:
        with self._lock:
            self._sessions[state.id] = state

    def get(self, session_id: str) -> Optional[TeleopSessionState]:
        with self._lock:
            return self._sessions.get(session_id)

    def active(self) -> Optional[TeleopSessionState]:
        with self._lock:
            if not self._active_session_id:
                return None
            return self._sessions.get(self._active_session_id)

    def start(self, leader: Robot, follower: Robot, *, dry_run: bool = False) -> tuple[bool, str, TeleopSessionState]:
        current = self.active()
        if current and current.running:
            if current.leader_id == leader.id and current.follower_id == follower.id:
                return True, "Teleop already running.", current
            return False, "Another teleop session is already running. Stop it first.", current

        session_id = uuid.uuid4().hex
        cmd = build_teleop_cmd(leader, follower)
        readable = subprocess.list2cmdline(cmd) if os.name == "nt" else " ".join(cmd)

        state = TeleopSessionState(
            id=session_id,
            leader_id=leader.id,
            follower_id=follower.id,
            dry_run=dry_run,
            cmd=cmd,
            readable_cmd=readable,
        )

        state.logs.append(f"Starting: {readable}")
        self._store(state)
        with self._lock:
            self._active_session_id = state.id

        if dry_run:
            state.logs.append("[dry-run] Teleop request accepted (no process started).")
            state.return_code = 0
            state.running = False
            return True, "Dry-run teleop accepted.", state

        env = _build_env()
        cwd = _find_repo_root() or Path.cwd()
        env["PYTHONUNBUFFERED"] = "1"

        popen_kwargs: dict = {}
        if os.name == "nt":
            popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            popen_kwargs["start_new_session"] = True

        try:
            process = subprocess.Popen(
                cmd,
                env=env,
                cwd=cwd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                **popen_kwargs,
            )
        except Exception as exc:
            state.logs.append(f"Failed to start teleop: {exc}")
            state.return_code = -1
            state.running = False
            return False, str(exc), state

        state.process = process
        state.running = True
        state.logs.append(f"Teleop process started (pid={process.pid}).")

        Thread(target=self._consume_output, args=(state,), daemon=True).start()
        Thread(target=self._watch_process, args=(state,), daemon=True).start()
        return True, f"Teleop started (pid={process.pid}).", state

    def _consume_output(self, state: TeleopSessionState) -> None:
        if not state.process or not state.process.stdout:
            return
        try:
            for line in state.process.stdout:
                clean = (line or "").rstrip("\r\n")
                if clean:
                    state.logs.append(clean)
        except Exception as exc:
            state.logs.append(f"[panel] output reader stopped: {exc}")
        finally:
            try:
                if state.process and state.process.stdout:
                    state.process.stdout.close()
            except Exception:
                pass

    def _watch_process(self, state: TeleopSessionState) -> None:
        if not state.process:
            return
        state.process.wait()
        state.return_code = state.process.returncode
        state.running = False
        state.logs.append(f"Teleop exited (code={state.return_code}).")
        with self._lock:
            if self._active_session_id == state.id:
                self._active_session_id = None

    def stop(self, leader_id: str, follower_id: str) -> tuple[bool, str, Optional[TeleopSessionState]]:
        state = self.active()
        if not state:
            return False, "No active teleop session.", None
        if state.leader_id != leader_id or state.follower_id != follower_id:
            return False, "Active teleop session does not match the requested leader/follower.", state

        if state.dry_run:
            state.running = False
            with self._lock:
                if self._active_session_id == state.id:
                    self._active_session_id = None
            return True, "Dry-run teleop stopped.", state

        proc = state.process
        if not proc or proc.poll() is not None:
            state.running = False
            state.return_code = proc.returncode if proc else state.return_code
            with self._lock:
                if self._active_session_id == state.id:
                    self._active_session_id = None
            return True, "Teleop already stopped.", state

        state.logs.append("[panel] stop requested")
        interrupted = self._send_interrupt(proc)
        if interrupted:
            state.logs.append("[panel] interrupt signal sent")

        try:
            proc.wait(timeout=2)
        except Exception:
            try:
                proc.terminate()
                state.logs.append("[panel] terminate sent")
            except Exception:
                pass
            try:
                proc.wait(timeout=2)
            except Exception:
                try:
                    proc.kill()
                    state.logs.append("[panel] kill sent")
                except Exception:
                    pass

        state.running = False
        state.return_code = proc.returncode
        with self._lock:
            if self._active_session_id == state.id:
                self._active_session_id = None
        return True, f"Stopped teleop (code={state.return_code}).", state

    def _send_interrupt(self, proc: subprocess.Popen[str]) -> bool:
        try:
            if os.name == "nt":
                proc.send_signal(signal.CTRL_BREAK_EVENT)
                return True
            os.killpg(proc.pid, signal.SIGINT)
            return True
        except Exception:
            return False

