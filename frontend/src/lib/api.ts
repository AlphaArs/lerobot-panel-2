export type RobotRole = "leader" | "follower";

export type RobotModel = "so101";

export type JointCalibration = {
  name: string;
  min: number;
  max: number;
  current: number;
};

export type CameraMode = {
  width: number;
  height: number;
  fps: number;
};

export type CameraDevice = {
  id: string;
  label: string;
  kind: "opencv" | "realsense";
  index?: number | null;
  path?: string | null;
  serial_number?: string | null;
  vendor_id?: string | null;
  product_id?: string | null;
  suggested?: CameraMode | null;
};

export type CameraProbe = {
  device: CameraDevice;
  modes: CameraMode[];
  suggested?: CameraMode | null;
};

export type RobotCamera = {
  id: string;
  name: string;
  device_id: string;
  kind: "opencv" | "realsense";
  path?: string | null;
  serial_number?: string | null;
  width: number;
  height: number;
  fps: number;
  index?: number | null;
  created_at?: string;
};

export type Calibration = {
  joints: JointCalibration[];
  updated_at?: string;
};

export type CalibrationSession = {
  session_id: string;
  robot: Robot;
  logs: string[];
  running: boolean;
  dry_run: boolean;
  return_code?: number | null;
  ranges: { name: string; min: number; pos: number; max: number }[];
};

export type Robot = {
  id: string;
  name: string;
  model: RobotModel;
  role: RobotRole;
  com_port: string;
  status: "online" | "offline";
  has_calibration: boolean;
  calibration?: Calibration | null;
  cameras: RobotCamera[];
  last_seen?: string | null;
};

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";
const WS_BASE = API_BASE.replace(/^http/i, "ws");
export const robotsWsUrl = `${WS_BASE}/ws/robots`;
export const camerasWsUrl = `${WS_BASE}/ws/cameras`;
export const calibrationWsUrl = (sessionId: string) => `${WS_BASE}/ws/calibration/${sessionId}`;
export const teleopWsUrl = (sessionId: string) => `${WS_BASE}/ws/teleop/${sessionId}`;

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    cache: "no-store",
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = data.detail || detail;
    } catch {
      // ignore parse errors
    }
    throw new Error(detail || "Request failed");
  }

  if (res.status === 204) {
    return {} as T;
  }
  return res.json() as Promise<T>;
}

export function fetchRobots(): Promise<Robot[]> {
  return request<Robot[]>("/robots");
}

export function fetchPorts(): Promise<Record<string, string>> {
  return request<{ ports: Record<string, string> }>("/ports").then((r) => r.ports);
}

export function fetchCameras(): Promise<CameraDevice[]> {
  return request<CameraDevice[]>("/cameras");
}

export function probeCameraDevice(id: string): Promise<CameraProbe> {
  return request<CameraProbe>(`/cameras/${id}/probe`);
}

export async function fetchCameraSnapshot(
  id: string,
  opts: { width?: number; height?: number; fps?: number } = {}
): Promise<Blob> {
  const params = new URLSearchParams();
  if (opts.width) params.set("width", String(opts.width));
  if (opts.height) params.set("height", String(opts.height));
  if (opts.fps) params.set("fps", String(opts.fps));
  const res = await fetch(`${API_BASE}/cameras/${encodeURIComponent(id)}/snapshot?${params.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error("Could not fetch camera snapshot.");
  }
  return res.blob();
}

export function createRobot(payload: {
  name: string;
  model: RobotModel;
  role: RobotRole;
  com_port: string;
}): Promise<Robot> {
  return request<Robot>("/robots", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteRobot(id: string): Promise<void> {
  return request(`/robots/${id}`, { method: "DELETE" });
}

export function updateRobot(
  id: string,
  payload: Partial<{ name: string; com_port: string }>
): Promise<Robot> {
  return request<Robot>(`/robots/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function fetchRobot(id: string): Promise<Robot> {
  return request<Robot>(`/robots/${id}`);
}

export function addRobotCamera(
  robotId: string,
  payload: {
    device_id: string;
    name: string;
    width: number;
    height: number;
    fps: number;
    serial_number?: string;
    path?: string;
    kind?: string;
    index?: number | null;
  }
): Promise<Robot> {
  return request<Robot>(`/robots/${robotId}/cameras`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteRobotCamera(robotId: string, cameraId: string): Promise<Robot> {
  return request<Robot>(`/robots/${robotId}/cameras/${cameraId}`, { method: "DELETE" });
}

export function startCalibration(id: string, override = false): Promise<CalibrationSession> {
  return request<CalibrationSession>(`/robots/${id}/calibration/start`, {
    method: "POST",
    body: JSON.stringify({ override }),
  });
}

export function saveCalibration(id: string, calibration: Calibration): Promise<Robot> {
  return request<Robot>(`/robots/${id}/calibration`, {
    method: "POST",
    body: JSON.stringify(calibration),
  });
}

export function deleteCalibration(id: string): Promise<Robot> {
  return request<Robot>(`/robots/${id}/calibration`, {
    method: "DELETE",
  });
}

export function getCalibrationSession(sessionId: string): Promise<CalibrationSession> {
  return request<CalibrationSession>(`/calibration/${sessionId}`);
}

export function sendCalibrationEnter(sessionId: string): Promise<{ sent: boolean; message: string }> {
  return request<{ sent: boolean; message: string }>(`/calibration/${sessionId}/enter`, {
    method: "POST",
  });
}

export function sendCalibrationInput(
  sessionId: string,
  data: string
): Promise<{ sent: boolean; message: string }> {
  return request<{ sent: boolean; message: string }>(`/calibration/${sessionId}/input`, {
    method: "POST",
    body: JSON.stringify({ data }),
  });
}

export function stopCalibration(sessionId: string): Promise<{ sent: boolean; message: string }> {
  return request<{ sent: boolean; message: string }>(`/calibration/${sessionId}/stop`, {
    method: "POST",
  });
}

export function cancelCalibration(sessionId: string): Promise<{ cancelled: boolean; message: string }> {
  return request<{ cancelled: boolean; message: string }>(`/calibration/${sessionId}`, {
    method: "DELETE",
  });
}

export function startTeleop(leaderId: string, followerId: string) {
  return request<{
    message: string;
    dry_run: boolean;
    session_id?: string | null;
    command?: string | null;
    pid?: number | null;
  }>("/teleop/start", {
    method: "POST",
    body: JSON.stringify({ leader_id: leaderId, follower_id: followerId }),
  });
}

export function stopTeleop(leaderId: string, followerId: string) {
  return request<{ message: string; session_id?: string | null; return_code?: number | null }>("/teleop/stop", {
    method: "POST",
    body: JSON.stringify({ leader_id: leaderId, follower_id: followerId }),
  });
}
