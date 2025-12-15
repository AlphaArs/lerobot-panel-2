export type RobotRole = "leader" | "follower";

export type RobotModel = "so101";

export type JointCalibration = {
  name: string;
  min: number;
  max: number;
  current: number;
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
};

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";
const WS_BASE = API_BASE.replace(/^http/i, "ws");
export const robotsWsUrl = `${WS_BASE}/ws/robots`;
export const calibrationWsUrl = (sessionId: string) => `${WS_BASE}/ws/calibration/${sessionId}`;

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

export function getCalibrationSession(sessionId: string): Promise<CalibrationSession> {
  return request<CalibrationSession>(`/calibration/${sessionId}`);
}

export function sendCalibrationEnter(sessionId: string): Promise<{ sent: boolean; message: string }> {
  return request<{ sent: boolean; message: string }>(`/calibration/${sessionId}/enter`, {
    method: "POST",
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
  return request<{ message: string; dry_run: boolean }>("/teleop/start", {
    method: "POST",
    body: JSON.stringify({ leader_id: leaderId, follower_id: followerId }),
  });
}
