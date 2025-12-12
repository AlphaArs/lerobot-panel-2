from __future__ import annotations

import importlib.util
import os
from datetime import datetime
from typing import List

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .commands import run_calibration, run_teleop
from .device_monitor import DeviceMonitor
from .models import (
    Calibration,
    CalibrationStart,
    JointCalibration,
    Robot,
    RobotCreate,
    SUPPORTED_MODELS,
    TeleopRequest,
)
from .storage import RobotStore

app = FastAPI(title="LeRobot control backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

store = RobotStore()
monitor = DeviceMonitor()


@app.on_event("startup")
async def _startup() -> None:
    monitor.start()


def _allow_real_commands() -> bool:
    env_flag = os.environ.get("LEROBOT_DRY_RUN")
    if env_flag is not None:
        return env_flag.lower() in ("0", "false", "no")
    try:
        return importlib.util.find_spec("lerobot") is not None
    except Exception:
        return False


def _with_status(robot: Robot) -> Robot:
    ports = monitor.snapshot()
    status = "online" if robot.com_port in ports else "offline"
    last_seen = robot.last_seen
    if status == "online":
        last_seen = datetime.utcnow()
        store.mark_seen(robot.id, last_seen)
    return robot.model_copy(update={"status": status, "last_seen": last_seen})


def _validate_model_role(payload: RobotCreate) -> None:
    model_info = SUPPORTED_MODELS.get(payload.model)
    if not model_info:
        raise HTTPException(status_code=400, detail=f"Unsupported model: {payload.model}")
    if payload.role not in model_info.get("roles", []):
        raise HTTPException(status_code=400, detail=f"Unsupported role: {payload.role}")


def _require_robot(robot_id: str) -> Robot:
    robot = store.get(robot_id)
    if not robot:
        raise HTTPException(status_code=404, detail="Robot not found")
    return robot


def _default_joints(robot: Robot) -> list[JointCalibration]:
    names = [
        "base",
        "shoulder",
        "elbow",
        "wrist_pitch",
        "wrist_roll",
        "gripper",
    ]
    return [
        JointCalibration(name=name, min=-180.0, max=180.0, current=0.0) for name in names
    ]


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/ports")
def list_ports() -> dict:
    return {"ports": monitor.snapshot()}


@app.get("/robots", response_model=List[Robot])
def list_robots() -> List[Robot]:
    return [_with_status(r) for r in store.list()]


@app.post("/robots", response_model=Robot)
def create_robot(payload: RobotCreate) -> Robot:
    _validate_model_role(payload)
    existing_names = {r.name.lower() for r in store.list()}
    if payload.name.lower() in existing_names:
        raise HTTPException(status_code=400, detail="A robot with that name already exists.")
    robot = store.add(payload)
    return _with_status(robot)


@app.get("/robots/{robot_id}", response_model=Robot)
def get_robot(robot_id: str) -> Robot:
    robot = _require_robot(robot_id)
    return _with_status(robot)


@app.delete("/robots/{robot_id}")
def delete_robot(robot_id: str) -> dict:
    deleted = store.delete(robot_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Robot not found")
    return {"deleted": True}


@app.post("/robots/{robot_id}/calibration/start", response_model=Robot)
def start_calibration(robot_id: str, payload: CalibrationStart) -> Robot:
    robot = _require_robot(robot_id)
    if robot.has_calibration and not payload.override:
        raise HTTPException(status_code=409, detail="Calibration exists. Pass override=true to replace it.")

    dry_run = not _allow_real_commands()
    ok, message = run_calibration(robot, dry_run=dry_run)
    if not ok:
        raise HTTPException(status_code=500, detail=message)

    updated = store.set_calibration(robot.id, Calibration(joints=_default_joints(robot)))
    return _with_status(updated or robot)


@app.post("/robots/{robot_id}/calibration", response_model=Robot)
def save_calibration(robot_id: str, calibration: Calibration) -> Robot:
    robot = _require_robot(robot_id)
    updated = store.set_calibration(robot.id, calibration)
    return _with_status(updated or robot)


@app.get("/robots/{robot_id}/calibration", response_model=Calibration | None)
def get_calibration(robot_id: str) -> Calibration | None:
    robot = _require_robot(robot_id)
    return robot.calibration


@app.post("/teleop/start")
def start_teleop(payload: TeleopRequest) -> dict:
    leader = _with_status(_require_robot(payload.leader_id))
    follower = _with_status(_require_robot(payload.follower_id))

    if leader.model != follower.model:
        raise HTTPException(status_code=400, detail="Leader and follower must be the same model.")
    if not follower.has_calibration:
        raise HTTPException(status_code=400, detail="Follower needs calibration first.")
    if not leader.has_calibration:
        raise HTTPException(status_code=400, detail="Leader needs calibration first.")
    if follower.role != "follower":
        raise HTTPException(status_code=400, detail="Select a follower arm to control.")
    if leader.role != "leader":
        raise HTTPException(status_code=400, detail="Teleop must start from a leader arm.")

    dry_run = not _allow_real_commands()
    ok, message = run_teleop(leader, follower, dry_run=dry_run)
    if not ok:
        raise HTTPException(status_code=500, detail=message)

    return {"message": message, "dry_run": dry_run}
