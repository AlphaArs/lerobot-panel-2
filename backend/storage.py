from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

from .models import Calibration, Robot, RobotCreate

DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "robots.json"


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

    def _load(self) -> Dict:
        if self.path.exists():
            try:
                with self.path.open("r", encoding="utf-8") as fp:
                    return json.load(fp)
            except Exception:
                pass
        return {"robots": []}

    def _save(self) -> None:
        with self.path.open("w", encoding="utf-8") as fp:
            json.dump(self._data, fp, indent=2, default=str)

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
        record["has_calibration"] = False
        record["calibration"] = None
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

    def set_calibration(self, robot_id: str, calibration: Calibration) -> Optional[Robot]:
        with self._lock:
            for item in self._data.get("robots", []):
                if item.get("id") == robot_id:
                    item["calibration"] = calibration.model_dump()
                    item["has_calibration"] = True
                    item["last_seen"] = item.get("last_seen")
                    self._save()
                    return self._to_robot(item)
        return None

    def clear_calibration(self, robot_id: str) -> Optional[Robot]:
        with self._lock:
            for item in self._data.get("robots", []):
                if item.get("id") == robot_id:
                    item["calibration"] = None
                    item["has_calibration"] = False
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
        calibration = data.get("calibration")
        calibration_obj = Calibration(**calibration) if calibration else None
        return Robot(
            id=data["id"],
            name=data["name"],
            model=data["model"],
            role=data["role"],
            com_port=data["com_port"],
            has_calibration=data.get("has_calibration", False),
            calibration=calibration_obj,
            last_seen=_parse_datetime(data.get("last_seen")),
        )
