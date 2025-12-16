"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Robot,
  deleteRobot,
  deleteCalibration,
  fetchRobot,
  fetchRobots,
  robotsWsUrl,
  startTeleop,
  updateRobot,
} from "@/lib/api";

const toMessage = (err: unknown) => (err instanceof Error ? err.message : "Request failed");

type TeleopState = { leaderId: string; followerId: string } | null;

export default function RobotDetailPage() {
  const params = useParams();
  const router = useRouter();
  const robotId = Array.isArray(params?.id) ? params?.id[0] : (params?.id as string);

  const [robot, setRobot] = useState<Robot | null>(null);
  const [fleet, setFleet] = useState<Robot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [selectedFollower, setSelectedFollower] = useState("");
  const [activeTeleop, setActiveTeleop] = useState<TeleopState>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showDeleteCalibrationModal, setShowDeleteCalibrationModal] = useState(false);

  const loadData = useCallback(async () => {
    if (!robotId) return;
    setLoading(true);
    setError(null);
    try {
      const [detail, list] = await Promise.all([fetchRobot(robotId), fetchRobots()]);
      setRobot(detail);
      setFleet(list);
      setNameInput(detail.name);
      setSelectedFollower("");
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setLoading(false);
    }
  }, [robotId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let stopped = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(robotsWsUrl);
      socket.onmessage = (event) => {
        if (stopped) return;
        try {
          const payload = JSON.parse(event.data);
          if (payload?.type === "fleet_status") {
            setFleet(payload.robots || []);
            if (robotId) {
              const updated = (payload.robots || []).find((r: Robot) => r.id === robotId);
              if (updated) {
                setRobot(updated);
                setNameInput(updated.name);
              }
            }
          }
        } catch {
          // ignore malformed payloads
        }
      };
      socket.onclose = () => {
        if (stopped) return;
        reconnectTimer = setTimeout(connect, 1500);
      };
    };

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (socket) socket.close();
    };
  }, [robotId]);

  const followerOptions = useMemo(
    () =>
      fleet.filter((r) => r.role === "follower" && r.model === robot?.model && r.id !== robot?.id),
    [fleet, robot]
  );

  useEffect(() => {
    if (!selectedFollower && followerOptions.length > 0) {
      setSelectedFollower(followerOptions[0].id);
    }
  }, [selectedFollower, followerOptions]);

  const formatLastSeen = (value?: string | null) => {
    if (!value) return "Never seen online";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "Last seen unknown";
    return `Seen ${parsed.toLocaleString()}`;
  };

  const handleRename = async () => {
    if (!robot) return;
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === robot.name) {
      setNameInput(robot.name);
      return;
    }
    setSavingName(true);
    setError(null);
    try {
      const updated = await updateRobot(robot.id, { name: trimmed });
      setRobot(updated);
      setFleet((list) => list.map((r) => (r.id === updated.id ? updated : r)));
      setMessage("Name updated and calibration file renamed.");
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setSavingName(false);
    }
  };

  const handleDelete = async () => {
    if (!robot) return;
    setLoading(true);
    setError(null);
    try {
      await deleteRobot(robot.id);
      setMessage(`${robot.name} deleted.`);
      router.push("/");
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setLoading(false);
      setShowDeleteModal(false);
    }
  };

  const startTeleopFlow = async () => {
    if (!robot) return;
    if (robot.role !== "leader") {
      setError("Teleoperation can only be started from a leader arm.");
      return;
    }
    if (!selectedFollower) {
      setError("Pick a follower to teleoperate.");
      return;
    }
    const follower = followerOptions.find((r) => r.id === selectedFollower);
    if (!follower) {
      setError("Follower not found.");
      return;
    }
    if (!follower.has_calibration) {
      setError("Follower needs a calibration before teleoperation.");
      return;
    }
    if (!robot.has_calibration) {
      setError("Leader needs a calibration before teleoperation.");
      return;
    }
    try {
      const res = await startTeleop(robot.id, follower.id);
      setActiveTeleop({ leaderId: robot.id, followerId: follower.id });
      setMessage(res.message);
    } catch (err) {
      setError(toMessage(err));
    }
  };

  const stopTeleop = () => {
    setActiveTeleop(null);
    setMessage("Teleoperation stopped.");
  };

  const handleDeleteCalibration = async () => {
    if (!robot) return;
    setLoading(true);
    setError(null);
    try {
      const updated = await deleteCalibration(robot.id);
      setRobot(updated);
      setFleet((list) => list.map((r) => (r.id === updated.id ? updated : r)));
      setMessage("Calibration deleted. You can run a new one anytime.");
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setLoading(false);
      setShowDeleteCalibrationModal(false);
    }
  };

  const statusTag = robot ? (
    <span className={`tag ${robot.status}`} style={{ textTransform: "capitalize" }}>
      {robot.status}
    </span>
  ) : null;

  return (
    <>
      <main className="page">
        <header className="panel" style={{ marginBottom: 16 }}>
          <div className="row" style={{ alignItems: "center", gap: 12 }}>
            <button className="btn" onClick={() => router.push("/")}>
              {"< Back"}
            </button>
            <div className="stack" style={{ flex: 1 }}>
              <p className="tag">Robot overview</p>
              <h1 style={{ margin: "4px 0" }}>{robot?.name || "Loading..."}</h1>
              <p className="muted" style={{ margin: 0 }}>
                Manage commands, calibration, naming, and teleoperation for this robot.
              </p>
            </div>
            <div className="stack" style={{ minWidth: 200, alignItems: "flex-end" }}>
              {loading && <span className="muted">Working...</span>}
              {error && <span className="error">{error}</span>}
              {message && <span className="success">{message}</span>}
            </div>
          </div>
        </header>

        <div className="grid">
          <div className="panel">
            <div className="row" style={{ gap: 8, marginBottom: 6 }}>
              <strong>Overview</strong>
              <div className="spacer" />
              {statusTag}
            </div>
            {robot ? (
              <div className="stack" style={{ gap: 6 }}>
                <div className="row">
                  <span className="pill">{robot.model.toUpperCase()}</span>
                  <span className="pill" style={{ textTransform: "capitalize" }}>
                    {robot.role}
                  </span>
                  <span className="pill">COM {robot.com_port}</span>
                  {robot.has_calibration && <span className="tag">calibrated</span>}
                </div>
                <p className="muted" style={{ margin: 0 }}>{formatLastSeen(robot.last_seen || null)}</p>
                <p className="muted" style={{ margin: 0 }}>
                  Calibration files live under your lerobot cache and follow the robot name.
                </p>
              </div>
            ) : (
              <p className="muted">Loading robot details...</p>
            )}
          </div>

          <div className="panel">
            <div className="row" style={{ marginBottom: 8 }}>
              <strong>Commands</strong>
              <div className="spacer" />
              {statusTag}
            </div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {!robot?.has_calibration && (
                <button className="btn btn-primary" onClick={() => router.push(`/calibration?robot=${robotId}`)}>
                  Calibrate
                </button>
              )}
              <button className="btn" onClick={() => void loadData()}>
                Refresh status
              </button>
              <button className="btn btn-ghost" onClick={() => router.push("/")}>
                Back to list
              </button>
            </div>
            <p className="muted" style={{ marginTop: 6 }}>
              Calibration opens in a dedicated flow. Teleoperation controls are below.
            </p>
          </div>

          <div className="panel">
            <div className="row" style={{ marginBottom: 8 }}>
              <strong>Edit name</strong>
              <div className="spacer" />
              {savingName && <span className="muted">Saving...</span>}
            </div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Robot name"
              />
              <button className="btn btn-primary" onClick={handleRename} disabled={!robot || savingName}>
                Save
              </button>
            </div>
            <p className="muted" style={{ marginTop: 6 }}>
              Updating the name also renames the calibration file inside your lerobot cache.
            </p>
          </div>

          <div className="panel">
            <div className="row" style={{ marginBottom: 8 }}>
              <strong>Teleoperation</strong>
              <div className="spacer" />
              {activeTeleop && <span className="tag">Live</span>}
            </div>
            {robot?.role !== "leader" ? (
              <p className="muted">Teleoperation can only start from a leader arm.</p>
            ) : (
              <>
                <p className="muted" style={{ marginTop: 0 }}>
                  Pick a calibrated follower of the same model to drive from this leader.
                </p>
                <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                  <select value={selectedFollower} onChange={(e) => setSelectedFollower(e.target.value)}>
                    <option value="">Select follower</option>
                    {followerOptions.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name} {f.has_calibration ? "" : "(needs calibration)"}
                      </option>
                    ))}
                  </select>
                  <button className="btn" onClick={startTeleopFlow} disabled={!robot}>
                    Start teleop
                  </button>
                  <button className="btn btn-ghost" onClick={stopTeleop}>
                    Stop
                  </button>
                </div>
                {activeTeleop && (
                  <p className="success" style={{ marginTop: 6 }}>
                    Controlling {followerOptions.find((f) => f.id === activeTeleop.followerId)?.name || "follower"}.
                  </p>
                )}
              </>
            )}
          </div>

          <div className="panel" style={{ borderColor: "rgba(255, 107, 107, 0.3)" }}>
            <div className="row" style={{ marginBottom: 8 }}>
              <strong>Danger zone</strong>
              <div className="spacer" />
              <span className="tag">Destructive</span>
            </div>
            <p className="muted" style={{ marginTop: 0 }}>
              These actions are optional. Delete the calibration if you need to reset it, or delete the robot entirely.
            </p>
            {robot?.has_calibration && (
              <button
                className="btn btn-danger"
                style={{ marginBottom: 10 }}
                onClick={() => setShowDeleteCalibrationModal(true)}
              >
                Delete calibration
              </button>
            )}
            <button className="btn btn-danger" onClick={() => setShowDeleteModal(true)} disabled={!robot}>
              Delete robot
            </button>
          </div>
        </div>
      </main>

      {showDeleteModal && (
        <div className="modal">
          <div className="panel" style={{ maxWidth: 420, width: "100%" }}>
            <h3>Delete {robot?.name || "this robot"}?</h3>
            <p className="notice" style={{ marginTop: 6 }}>
              This action removes the robot entry and its calibration file. You will need to recreate
              and recalibrate it to use it again.
            </p>
            <div className="divider" />
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => setShowDeleteModal(false)}>
                Cancel
              </button>
              <div className="spacer" />
              <button className="btn btn-danger" onClick={handleDelete} disabled={loading}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteCalibrationModal && (
        <div className="modal">
          <div className="panel" style={{ maxWidth: 420, width: "100%" }}>
            <h3>Delete calibration?</h3>
            <p className="notice" style={{ marginTop: 6 }}>
              Remove the calibration file for this robot. You can recalibrate later if needed.
            </p>
            <div className="divider" />
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => setShowDeleteCalibrationModal(false)}>
                Cancel
              </button>
              <div className="spacer" />
              <button className="btn btn-danger" onClick={handleDeleteCalibration} disabled={loading}>
                Delete calibration
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
