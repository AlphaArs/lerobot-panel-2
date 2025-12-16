from __future__ import annotations

import asyncio
import importlib.util
import json
import os
from datetime import datetime
from typing import List

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .calibration_manager import CalibrationManager
from .commands import run_teleop
from .device_monitor import DeviceMonitor
from .models import (
    Calibration,
    CalibrationSession,
    CalibrationStart,
    CalibrationInput,
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
calibration_manager = CalibrationManager()


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


@app.post("/robots/{robot_id}/calibration/start", response_model=CalibrationSession)
def start_calibration(robot_id: str, payload: CalibrationStart) -> CalibrationSession:
    robot = _require_robot(robot_id)

    dry_run = not _allow_real_commands()
    session_state = calibration_manager.start(robot, dry_run=dry_run)
    if not dry_run and not session_state.running and session_state.return_code not in (0, None):
        detail = session_state.logs[-1] if session_state.logs else "Failed to start calibration."
        raise HTTPException(status_code=500, detail=detail)

    robot_with_status = _with_status(robot)
    snapshot = session_state.snapshot()
    return CalibrationSession(
        session_id=snapshot["session_id"],
        robot=robot_with_status,
        logs=snapshot["logs"],
        running=snapshot["running"],
        dry_run=snapshot["dry_run"],
        return_code=snapshot["return_code"],
        ranges=snapshot["ranges"],
    )


@app.get("/calibration/{session_id}", response_model=CalibrationSession)
def calibration_status(session_id: str) -> CalibrationSession:
    state = calibration_manager.get(session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Calibration session not found.")

    robot = _with_status(_require_robot(state.robot_id))
    snapshot = state.snapshot()
    return CalibrationSession(
        session_id=snapshot["session_id"],
        robot=robot,
        logs=snapshot["logs"],
        running=snapshot["running"],
        dry_run=snapshot["dry_run"],
        return_code=snapshot["return_code"],
        ranges=snapshot["ranges"],
    )


@app.post("/calibration/{session_id}/enter")
def calibration_enter(session_id: str) -> dict:
    ok, message = calibration_manager.send_enter(session_id)
    if not ok:
        raise HTTPException(status_code=400, detail=message)
    return {"sent": True, "message": message}


@app.post("/calibration/{session_id}/input")
def calibration_input(session_id: str, payload: CalibrationInput) -> dict:
    ok, message = calibration_manager.send_input(session_id, payload.data)
    if not ok:
        raise HTTPException(status_code=400, detail=message)
    return {"sent": True, "message": message}


@app.post("/calibration/{session_id}/stop")
def calibration_stop(session_id: str) -> dict:
    ok, message = calibration_manager.send_stop(session_id)
    if not ok:
        raise HTTPException(status_code=400, detail=message)
    return {"sent": True, "message": message}


@app.delete("/calibration/{session_id}")
def calibration_cancel(session_id: str) -> dict:
    ok, message = calibration_manager.cancel(session_id)
    if not ok:
        raise HTTPException(status_code=400, detail=message)
    return {"cancelled": True, "message": message}


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


@app.websocket("/ws/robots")
async def robots_stream(websocket: WebSocket) -> None:
    await websocket.accept()
    last_payload: str | None = None
    try:
        while True:
            robots = [_with_status(r) for r in store.list()]
            ports = monitor.snapshot()
            payload = {
                "type": "fleet_status",
                "robots": [r.model_dump(mode="json") for r in robots],
                "ports": ports,
            }
            serialized = json.dumps(payload, sort_keys=True)
            if serialized != last_payload:
                await websocket.send_json(payload)
                last_payload = serialized
            await asyncio.sleep(2)
    except WebSocketDisconnect:
        return


@app.websocket("/ws/calibration/{session_id}")
async def calibration_stream(websocket: WebSocket, session_id: str) -> None:
    await websocket.accept()
    try:
        while True:
            state = calibration_manager.get(session_id)
            if not state:
                await websocket.send_json({"error": "not_found", "session_id": session_id})
                await websocket.close(code=4404)
                return

            try:
                robot = _with_status(_require_robot(state.robot_id))
            except HTTPException:
                await websocket.send_json({"error": "robot_missing", "session_id": session_id})
                await websocket.close(code=4404)
                return

            snapshot = state.snapshot()
            payload = {
                "session_id": snapshot["session_id"],
                "robot": robot.model_dump(mode="json"),
                "logs": snapshot["logs"],
                "running": snapshot["running"],
                "dry_run": snapshot["dry_run"],
                "return_code": snapshot["return_code"],
                "ranges": snapshot["ranges"],
            }
            await websocket.send_json(payload)
            await asyncio.sleep(0.2)
    except WebSocketDisconnect:
        return
