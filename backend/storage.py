from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime
import os
from pathlib import Path
import shutil
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
        removed: Dict | None = None
        deleted = False
        with self._lock:
            robots = self._data.get("robots", [])
            new_list = []
            for item in robots:
                if item.get("id") == robot_id:
                    removed = item.copy()
                    continue
                new_list.append(item)
            deleted = len(new_list) != len(robots)
            if deleted:
                self._data["robots"] = new_list
                self._save()
        if removed:
            self._remove_calibration_file(removed)
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
        target: Dict | None = None
        with self._lock:
            for item in self._data.get("robots", []):
                if item.get("id") == robot_id:
                    target = item.copy()
                    self._save()
                    break
        if target:
            self._remove_calibration_file(target)
            return self._to_robot(target)
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

    def update(self, robot_id: str, changes: Dict[str, str]) -> Optional[Robot]:
        prior: Dict | None = None
        updated_snapshot: Dict | None = None
        with self._lock:
            for item in self._data.get("robots", []):
                if item.get("id") == robot_id:
                    prior = item.copy()
                    for key, value in changes.items():
                        if value is None:
                            continue
                        item[key] = value
                    updated_snapshot = item.copy()
                    self._save()
                    break
        if prior and updated_snapshot:
            self._maybe_rename_calibration(prior, updated_snapshot)
            return self._to_robot(updated_snapshot)
        return None

    def _remove_calibration_file(self, data: Dict) -> bool:
        path = _calibration_path(data)
        try:
            if path.is_file():
                path.unlink()
                self._cleanup_empty_dirs(path.parent)
                return True
        except OSError:
            return False
        return False

    def _maybe_rename_calibration(self, before: Dict, after: Dict) -> bool:
        old_path = _calibration_path(before)
        new_path = _calibration_path(after)
        if old_path == new_path:
            return False
        if not old_path.exists():
            return False
        try:
            new_path.parent.mkdir(parents=True, exist_ok=True)
            if new_path.exists():
                new_path.unlink()
            shutil.move(str(old_path), str(new_path))
            self._cleanup_empty_dirs(old_path.parent)
            return True
        except OSError:
            return False

    def _cleanup_empty_dirs(self, start: Path) -> None:
        """
        Walk up from start and remove empty calibration folders to avoid clutter.
        """
        current = start
        try:
            while current != CALIB_ROOT.parent and current.exists():
                if any(current.iterdir()):
                    break
                current.rmdir()
                current = current.parent
        except OSError:
            pass
