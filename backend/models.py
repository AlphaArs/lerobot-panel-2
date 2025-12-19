from __future__ import annotations

from datetime import datetime
from typing import List, Optional, Literal

from pydantic import BaseModel, Field


SUPPORTED_MODELS = {
    "so101": {
        "roles": ["leader", "follower"],
        "device_types": {
            "leader": "so101_leader",
            "follower": "so101_follower",
        },
    }
}


class JointCalibration(BaseModel):
    name: str
    min: float
    max: float
    current: float


class Calibration(BaseModel):
    joints: List[JointCalibration]
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class RobotBase(BaseModel):
    name: str = Field(..., description="Friendly name chosen by the user")
    model: str = Field(..., description="Robot model, e.g. so101")
    role: str = Field(..., description="leader or follower")
    com_port: str = Field(..., description="Windows COM port such as COM13")

    def device_type(self) -> str:
        model_info = SUPPORTED_MODELS.get(self.model, {})
        mapping = model_info.get("device_types", {})
        return mapping.get(self.role, f"{self.model}_{self.role}")


class RobotCreate(RobotBase):
    pass


class RobotUpdate(BaseModel):
    name: Optional[str] = None
    com_port: Optional[str] = None


class Robot(RobotBase):
    id: str
    status: str = Field(default="offline", description="online if COM is present")
    has_calibration: bool = False
    calibration: Optional[Calibration] = None
    cameras: List["RobotCamera"] = Field(default_factory=list)
    last_seen: Optional[datetime] = None


class TeleopRequest(BaseModel):
    leader_id: str
    follower_id: str


class CalibrationStart(BaseModel):
    override: bool = False


class CalibrationInput(BaseModel):
    data: str = ""


class CalibrationSession(BaseModel):
    session_id: str
    robot: Robot
    logs: List[str] = Field(default_factory=list)
    running: bool = False
    dry_run: bool = False
    return_code: Optional[int] = None
    ranges: List[dict] = Field(default_factory=list)


class CameraMode(BaseModel):
    width: int
    height: int
    fps: float


class CameraDevice(BaseModel):
    id: str
    label: str
    kind: Literal["opencv", "realsense"]
    index: Optional[int] = None
    path: Optional[str] = None
    serial_number: Optional[str] = None
    vendor_id: Optional[str] = None
    product_id: Optional[str] = None
    suggested: Optional[CameraMode] = None


class CameraProbe(BaseModel):
    device: CameraDevice
    modes: List[CameraMode] = Field(default_factory=list)
    suggested: Optional[CameraMode] = None


class RobotCamera(BaseModel):
    id: str
    name: str
    device_id: str
    kind: Literal["opencv", "realsense"]
    path: Optional[str] = None
    serial_number: Optional[str] = None
    width: int
    height: int
    fps: float
    index: Optional[int] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class CameraCreate(BaseModel):
    device_id: str
    name: str
    width: int
    height: int
    fps: float
    serial_number: Optional[str] = None
    path: Optional[str] = None
    kind: Optional[str] = None
    index: Optional[int] = None


Robot.model_rebuild()
CalibrationSession.model_rebuild()
