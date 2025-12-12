from __future__ import annotations

import threading
import time
from typing import Dict, Tuple

POLL_SECONDS = 2.0


class DeviceMonitor:
    """
    Lightweight COM port watcher. Uses pyserial if available; otherwise falls back
    to an empty list so the API keeps working.
    """

    def __init__(self, interval: float = POLL_SECONDS):
        self.interval = interval
        self._ports: Dict[str, str] = {}
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

    def snapshot(self) -> Dict[str, str]:
        with self._lock:
            return dict(self._ports)

    def _detect_ports(self) -> Dict[str, str]:
        try:
            from serial.tools import list_ports
        except Exception:
            return {}

        ports: Dict[str, str] = {}
        for info in list_ports.comports():
            if not info.device:
                continue
            desc = info.description or info.device
            ports[info.device] = desc
        return ports

    def _run(self) -> None:
        while not self._stop.is_set():
            ports = self._detect_ports()
            with self._lock:
                self._ports = ports
            time.sleep(self.interval)
