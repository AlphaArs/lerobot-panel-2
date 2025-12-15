from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime
import os
from pathlib import Path
from typing import Dict, List, Optional

from .models import Robot, RobotCreate, SUPPORTED_MODELS

DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "robots.json"
CALIB_ROOT = Path(
    os.getenv(
        "HF_LEROBOT_CALIBRATION",
        Path.home() / ".cache" / "huggingface" / "lerobot" / "calibration",
    )
).expanduser()


def _device_type(data: Dict) -> str:
    model_info = SUPPORTED_MODELS.get(data.get("model"), {})
    mapping = model_info.get("device_types", {})
    role = data.get("role", "")
    return mapping.get(role, f"{data.get('model', 'unknown')}_{role}")


def _calibration_path(data: Dict) -> Path:
    device_type = _device_type(data)
    scope = "teleoperators" if data.get("role") == "leader" else "robots"
    # Calibration files are keyed by the user-friendly id used in lerobot CLI (we map to the robot name).
    name = data.get("name") or data.get("id")
    return CALIB_ROOT / scope / device_type / f"{name}.json"


def _parse_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except Exception:
        return None


class RobotStore:
    def __init__(self, path: Path = DATA_PATH):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._data = self._load()

    def _clean_record(self, item: Dict) -> Dict:
        return {
            "id": item.get("id"),
            "name": item.get("name"),
            "model": item.get("model"),
            "role": item.get("role"),
            "com_port": item.get("com_port"),
            "last_seen": item.get("last_seen"),
        }

    def _load(self) -> Dict:
        if self.path.exists():
            try:
                with self.path.open("r", encoding="utf-8") as fp:
                    data = json.load(fp)
                    cleaned = {"robots": []}
                    for item in data.get("robots", []):
                        cleaned["robots"].append(self._clean_record(item))
                    return cleaned
            except Exception:
                pass
        return {"robots": []}

    def _save(self) -> None:
        serializable = {"robots": [self._clean_record(item) for item in self._data.get("robots", [])]}
        with self.path.open("w", encoding="utf-8") as fp:
            json.dump(serializable, fp, indent=2, default=str)

    def list(self) -> List[Robot]:
        with self._lock:
            return [self._to_robot(item) for item in self._data.get("robots", [])]

    def get(self, robot_id: str) -> Optional[Robot]:
        with self._lock:
            for item in self._data.get("robots", []):
                if item.get("id") == robot_id:
                    return self._to_robot(item)
        return None

    def add(self, payload: RobotCreate) -> Robot:
        record = payload.model_dump()
        record["id"] = str(uuid.uuid4())
        record["last_seen"] = None
        with self._lock:
            self._data.setdefault("robots", []).append(record)
            self._save()
        return self._to_robot(record)

    def delete(self, robot_id: str) -> bool:
        with self._lock:
            robots = self._data.get("robots", [])
            new_list = [item for item in robots if item.get("id") != robot_id]
            deleted = len(new_list) != len(robots)
            if deleted:
                self._data["robots"] = new_list
                self._save()
            return deleted

    def set_calibration(self, robot_id: str, calibration) -> Optional[Robot]:
        with self._lock:
            for item in self._data.get("robots", []):
                if item.get("id") == robot_id:
                    # No calibration data persisted to robots.json
                    self._save()
                    return self._to_robot(item)
        return None

    def clear_calibration(self, robot_id: str) -> Optional[Robot]:
        with self._lock:
            for item in self._data.get("robots", []):
                if item.get("id") == robot_id:
                    # No calibration data persisted to robots.json
                    self._save()
                    return self._to_robot(item)
        return None

    def mark_seen(self, robot_id: str, at: datetime) -> None:
        with self._lock:
            for item in self._data.get("robots", []):
                if item.get("id") == robot_id:
                    item["last_seen"] = at.isoformat()
                    self._save()
                    break

    def _to_robot(self, data: Dict) -> Robot:
        calib_path = _calibration_path(data)
        return Robot(
            id=data["id"],
            name=data["name"],
            model=data["model"],
            role=data["role"],
            com_port=data["com_port"],
            has_calibration=calib_path.is_file(),
            calibration=None,
            last_seen=_parse_datetime(data.get("last_seen")),
        )
