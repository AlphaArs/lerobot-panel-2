"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Calibration,
  JointCalibration,
  Robot,
  calibrationWsUrl,
  robotsWsUrl,
  cancelCalibration,
  createRobot,
  deleteRobot,
  fetchPorts,
  fetchRobots,
  stopCalibration,
  sendCalibrationEnter,
  sendCalibrationInput,
  saveCalibration,
  startCalibration,
  startTeleop,
} from "@/lib/api";

type WizardForm = {
  com_port: string;
  model: "so101";
  role: "leader" | "follower";
  name: string;
};

const defaultWizard: WizardForm = {
  com_port: "",
  model: "so101",
  role: "leader",
  name: "",
};

const toMessage = (err: unknown) => (err instanceof Error ? err.message : "Request failed");

export default function Home() {
  const [robots, setRobots] = useState<Robot[]>([]);
  const [ports, setPorts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardForm, setWizardForm] = useState<WizardForm>(defaultWizard);
  const [calibrationTarget, setCalibrationTarget] = useState<Robot | null>(null);
  const [calibrationReady, setCalibrationReady] = useState(false);
  const [calibrationSessionId, setCalibrationSessionId] = useState<string | null>(null);
  const [calibrationLogs, setCalibrationLogs] = useState<string[]>([]);
  const [calibrationRunning, setCalibrationRunning] = useState(false);
  const [calibrationStarted, setCalibrationStarted] = useState(false);
  const [calibrationStarting, setCalibrationStarting] = useState(false);
  const [calibrationReturnCode, setCalibrationReturnCode] = useState<number | null>(null);
  const [calibrationOverridePrompt, setCalibrationOverridePrompt] = useState<{
    sessionId: string;
    line: string;
    ready: boolean;
  } | null>(null);
  const [calibrationOverrideHandled, setCalibrationOverrideHandled] = useState(false);
  const [calibrationErrorModal, setCalibrationErrorModal] = useState(false);
  const [calibrationErrorJoints, setCalibrationErrorJoints] = useState<string[]>([]);
  const [calibrationJoints, setCalibrationJoints] = useState<JointCalibration[]>([]);
  const [calibrationRanges, setCalibrationRanges] = useState<
    Record<string, { name: string; min: number; pos: number; max: number }>
  >({});
  const [teleopSelection, setTeleopSelection] = useState<Record<string, string>>({});
  const [activeTeleop, setActiveTeleop] = useState<{ leaderId: string; followerId: string } | null>(
    null
  );
  const displayedCalibrationLogs = useMemo(() => calibrationLogs, [calibrationLogs]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, p] = await Promise.all([fetchRobots(), fetchPorts()]);
      setRobots(r);
      setPorts(p);
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

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
            setRobots(payload.robots || []);
            setPorts(payload.ports || {});
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
  }, []);

  const refreshRobots = async () => {
    try {
      const r = await fetchRobots();
      setRobots(r);
    } catch (err) {
      setError(toMessage(err));
    }
  };

  const refreshPorts = async () => {
    try {
      const p = await fetchPorts();
      setPorts(p);
    } catch (err) {
      setError(toMessage(err));
    }
  };

  const openWizard = () => {
    setWizardForm(defaultWizard);
    setWizardStep(1);
    setWizardOpen(true);
    refreshPorts();
  };

  const handleWizardNext = () => {
    if (wizardStep === 1 && !wizardForm.com_port) {
      setError("Pick a COM port before continuing.");
      return;
    }
    if (wizardStep === 3) {
      handleCreateRobot();
      return;
    }
    setWizardStep((s) => s + 1);
    setError(null);
  };

  const handleCreateRobot = async () => {
    if (!wizardForm.name.trim()) {
      setError("Give the robot a name.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const robot = await createRobot(wizardForm);
      setRobots((list) => [...list, robot]);
      setWizardOpen(false);
      setMessage(`Added ${robot.name}.`);
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleCalibrate = async (robot: Robot) => {
    if (calibrationSessionId) {
      try {
        await cancelCalibration(calibrationSessionId);
      } catch {
        // ignore cleanup errors here
      }
    }
    cleanupCalibrationSession();
    setCalibrationStarting(true);
    setCalibrationReady(false);
    setCalibrationTarget(robot);
    setCalibrationJoints(
      robot.calibration?.joints?.length ? robot.calibration.joints : seedJoints()
    );
    setCalibrationLogs([`Requesting calibration session for ${robot.name}...`]);
    setCalibrationRanges({});
    setCalibrationRunning(false);
    setCalibrationStarted(false);
    setCalibrationReturnCode(null);
    setCalibrationOverridePrompt(null);
    setCalibrationOverrideHandled(false);
    setMessage("Preparing calibration session...");
    setLoading(true);
    setError(null);
    try {
      const res = await startCalibration(robot.id, false);
      setCalibrationSessionId(res.session_id);
      const initialLogs =
        res.logs && res.logs.length > 0
          ? res.logs
          : ["Session created. Waiting for device output..."];
      setCalibrationLogs(initialLogs);
      setCalibrationRunning(res.running);
      setCalibrationReturnCode(res.return_code ?? null);
      setCalibrationRanges(
        (res.ranges || []).reduce((acc, row) => {
          acc[row.name] = row;
          return acc;
        }, {} as Record<string, { name: string; min: number; pos: number; max: number }>)
      );
      setCalibrationTarget(res.robot);
      setCalibrationReady(res.dry_run);
      const joints =
        res.robot.calibration?.joints?.length
          ? res.robot.calibration.joints
          : seedJoints();
      setCalibrationJoints(joints);
      await refreshRobots();
      const statusMessage = res.dry_run
        ? "Calibration dry-run: nothing executed, but you can inspect joints."
        : "Calibration routine kicked off. Set the arm to neutral, then press Start calibration.";
      setMessage(statusMessage);
      setCalibrationStarted(false);
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setCalibrationStarting(false);
      setLoading(false);
    }
  };

  const seedJoints = (): JointCalibration[] => [
    { name: "base", min: -180, max: 180, current: 0 },
    { name: "shoulder", min: -180, max: 180, current: 0 },
    { name: "elbow", min: -180, max: 180, current: 0 },
    { name: "wrist_pitch", min: -180, max: 180, current: 0 },
    { name: "wrist_roll", min: -180, max: 180, current: 0 },
    { name: "gripper", min: -180, max: 180, current: 0 },
  ];

  const cleanupCalibrationSession = () => {
    setCalibrationSessionId(null);
    setCalibrationLogs([]);
    setCalibrationRunning(false);
    setCalibrationRanges({});
    setCalibrationStarted(false);
    setCalibrationReturnCode(null);
    setCalibrationErrorModal(false);
    setCalibrationErrorJoints([]);
    setCalibrationOverridePrompt(null);
    setCalibrationOverrideHandled(false);
    setCalibrationStarting(false);
  };

  useEffect(() => {
    if (!calibrationTarget) return;
    const joints =
      calibrationTarget.calibration?.joints?.length
        ? calibrationTarget.calibration.joints
        : seedJoints();
    if (!calibrationSessionId && !calibrationStarting) {
      setCalibrationReady(Boolean(calibrationTarget.calibration?.joints?.length));
    }
    setCalibrationJoints(joints);
  }, [calibrationTarget, calibrationSessionId, calibrationStarting]);

  useEffect(() => {
    if (!calibrationSessionId) return;
    let stopped = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let socket: WebSocket | null = null;

    const connect = () => {
      if (stopped || !calibrationSessionId) return;
      socket = new WebSocket(calibrationWsUrl(calibrationSessionId));

      socket.onmessage = (event) => {
        if (stopped) return;
        try {
          const payload = JSON.parse(event.data);
          if (payload?.error) {
            const friendly =
              payload.error === "not_found"
                ? "Calibration session closed."
                : payload.error === "robot_missing"
                  ? "Robot disappeared during calibration."
                  : "Calibration stream error.";
            setError(friendly);
            setCalibrationSessionId(null);
            setCalibrationRunning(false);
            setCalibrationRanges({});
            setCalibrationLogs([]);
            setCalibrationStarted(false);
            setCalibrationReady(false);
            setCalibrationTarget(null);
            return;
          }
          const incomingLogs = payload.logs || [];
          setCalibrationLogs((prev) => (incomingLogs.length ? incomingLogs : prev));
          setCalibrationRunning(Boolean(payload.running));
          setCalibrationReturnCode(
            typeof payload.return_code === "number" ? payload.return_code : null
          );
          setCalibrationRanges(
            (payload.ranges || []).reduce((acc, row) => {
              acc[row.name] = row;
              return acc;
            }, {} as Record<string, { name: string; min: number; pos: number; max: number }>)
          );
          if (payload.robot) {
            setCalibrationTarget(payload.robot as Robot);
          }
        } catch (err) {
          if (stopped) return;
          setError(toMessage(err));
        }
      };

      socket.onclose = () => {
        if (stopped) return;
        reconnectTimer = setTimeout(connect, 1000);
      };
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (socket) socket.close();
    };
  }, [calibrationSessionId]);

  useEffect(() => {
    if (!calibrationSessionId) {
      setCalibrationOverridePrompt(null);
      return;
    }
    if (
      calibrationOverridePrompt &&
      calibrationOverridePrompt.sessionId !== calibrationSessionId
    ) {
      setCalibrationOverridePrompt(null);
    }
    const promptLine = calibrationLogs.find((line) =>
      line.toLowerCase().includes("press enter to use provided calibration file associated with the id")
    );
    if (
      promptLine &&
      !calibrationOverrideHandled &&
      (!calibrationOverridePrompt || !calibrationOverridePrompt.ready)
    ) {
      setCalibrationOverridePrompt({
        sessionId: calibrationSessionId,
        line: promptLine,
        ready: true,
      });
      setCalibrationStarted(false);
    }
  }, [calibrationSessionId, calibrationLogs, calibrationOverrideHandled, calibrationOverridePrompt]);

  useEffect(() => {
    if (!calibrationSessionId) return;
    if (!calibrationStarted || calibrationReady) return;
    if (calibrationRunning) return;
    const ranges = Object.values(calibrationRanges);
    if (ranges.length) {
      setCalibrationJoints(
        ranges.map((row) => ({
          name: row.name,
          min: row.min,
          max: row.max,
          current: row.pos,
        }))
      );
    }
    setCalibrationReady(true);
    setCalibrationStarted(false);
    setMessage("Calibration stopped. Review the captured ranges and save.");
  }, [calibrationSessionId, calibrationStarted, calibrationRunning, calibrationRanges, calibrationReady]);

  const calibrationFailed =
    !calibrationRunning && calibrationReturnCode !== null && calibrationReturnCode !== 0;

  const extractUnmovedJoints = (logs: string[]): string[] => {
    const idx = logs.findIndex((line) => line.includes("Some motors have the same min and max values"));
    if (idx === -1) return [];
    const slice = logs.slice(idx, idx + 6).join(" ");
    const match = slice.match(/\[([^\]]+)\]/);
    if (!match) return [];
    return match[1]
      .replace(/['"]/g, "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  };

  useEffect(() => {
    if (calibrationFailed) {
      const stuck = extractUnmovedJoints(displayedCalibrationLogs);
      setCalibrationErrorJoints(stuck);
      setCalibrationErrorModal(true);
    }
  }, [calibrationFailed, displayedCalibrationLogs]);

  const calibrationSteps = [
    {
      title: "Set neutral pose",
      detail: "Place the arm in its neutral position before starting.",
      index: 1,
    },
    {
      title: "Sweep joints",
      detail: "Move each joint through its range and record min/current/max.",
      index: 2,
    },
    {
      title: "Save calibration",
      detail: "Confirm values and save to store the calibration.",
      index: 3,
    },
  ];

  const sendEnterToCalibration = async () => {
    if (calibrationOverridePrompt) {
      setMessage("Resolve the override prompt first.");
      return;
    }
    if (!calibrationSessionId) {
      setError("No calibration session is active.");
      return;
    }
    try {
      await sendCalibrationEnter(calibrationSessionId);
      setCalibrationStarted(true);
      setMessage("Calibration started. Move each joint, then hit End calibration to finish.");
    } catch (err) {
      setError(toMessage(err));
    }
  };

  const continueCalibrationOverride = async () => {
    if (!calibrationSessionId) return;
    if (!calibrationOverridePrompt?.ready) {
      setMessage("Waiting for calibration prompt before continuing...");
      return;
    }
    try {
      await sendCalibrationInput(calibrationSessionId, "c");
      setCalibrationOverridePrompt(null);
      setCalibrationOverrideHandled(true);
      setCalibrationStarted(false);
      setMessage("Override confirmed. Now press Start to begin calibration sweep.");
    } catch (err) {
      setError(toMessage(err));
    }
  };

  const cancelCalibrationOverride = async () => {
    if (!calibrationSessionId) {
      setCalibrationOverridePrompt(null);
      setCalibrationOverrideHandled(true);
      return;
    }
    try {
      await sendCalibrationEnter(calibrationSessionId);
      setMessage("Keeping existing calibration file.");
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setCalibrationOverridePrompt(null);
      setCalibrationOverrideHandled(true);
      cleanupCalibrationSession();
      setCalibrationTarget(null);
      setCalibrationReady(false);
    }
  };

  const stopCalibrationSweep = async () => {
    if (!calibrationSessionId) {
      setError("No calibration session is active.");
      return;
    }
    try {
      await stopCalibration(calibrationSessionId);
      setMessage("Stop ENTER sent. Waiting for calibration to finish...");
    } catch (err) {
      // Try a plain ENTER as a fallback if the dedicated stop call fails.
      try {
        await sendCalibrationEnter(calibrationSessionId);
        setMessage("Stop request retried via ENTER. Waiting for calibration to finish...");
      } catch (fallbackErr) {
        setError(toMessage(fallbackErr));
      }
    }
  };

  const cancelCalibrationFlow = async () => {
    if (!calibrationSessionId) {
      setCalibrationTarget(null);
      setCalibrationReady(false);
      return;
    }
    try {
      await cancelCalibration(calibrationSessionId);
      setMessage("Calibration cancelled.");
    } catch (err) {
      setError(toMessage(err));
    } finally {
      cleanupCalibrationSession();
      setCalibrationTarget(null);
      setCalibrationReady(false);
    }
  };

  const saveCalibrationFlow = async () => {
    if (!calibrationTarget) return;
    const payload: Calibration = { joints: calibrationJoints };
    setLoading(true);
    try {
      const updated = await saveCalibration(calibrationTarget.id, payload);
      setRobots((list) => list.map((r) => (r.id === updated.id ? updated : r)));
      cleanupCalibrationSession();
      setCalibrationTarget(null);
      setCalibrationReady(false);
      setMessage("Calibration saved.");
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (robot: Robot) => {
    const ok = confirm(
      `Delete ${robot.name}? This will also remove any calibration data.`
    );
    if (!ok) return;
    setLoading(true);
    try {
      await deleteRobot(robot.id);
      setRobots((list) => list.filter((r) => r.id !== robot.id));
      setMessage(`${robot.name} removed.`);
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const followerOptions = useMemo(() => {
    const grouped: Record<string, Robot[]> = {};
    robots.forEach((r) => {
      if (r.role === "follower") {
        const key = r.model;
        grouped[key] = grouped[key] || [];
        grouped[key].push(r);
      }
    });
    return grouped;
  }, [robots]);

  const startTeleopFlow = async (leader: Robot) => {
    const followerId = teleopSelection[leader.id];
    if (!followerId) {
      setError("Pick a follower to teleoperate.");
      return;
    }
    const follower = robots.find((r) => r.id === followerId);
    if (!follower) {
      setError("Follower not found.");
      return;
    }
    if (!follower.has_calibration) {
      alert("This follower needs a calibration before teleoperation.");
      return;
    }

    const ok = confirm(
      "Set both arms in roughly the same pose to avoid strain. Ready to start?"
    );
    if (!ok) return;

    try {
      const res = await startTeleop(leader.id, followerId);
      setActiveTeleop({ leaderId: leader.id, followerId });
      setMessage(res.message);
    } catch (err) {
      setError(toMessage(err));
    }
  };

  const stopTeleop = () => {
    setActiveTeleop(null);
    setMessage("Teleoperation stopped.");
  };

  const activeFollowerName = (leaderId: string) => {
    if (!activeTeleop || activeTeleop.leaderId !== leaderId) return "";
    const follower = robots.find((r) => r.id === activeTeleop.followerId);
    return follower?.name || "";
  };

  return (
    <main className="page">
      <header className="panel" style={{ marginBottom: 16 }}>
        <div className="row">
          <div>
            <p className="tag">LeRobot control stack</p>
            <h1 style={{ margin: "8px 0 4px" }}>SO101 fleet manager</h1>
            <p className="muted">
              Add arms, map COM ports, calibrate joints, and kick off leader-to-follower
              teleoperation from one screen.
            </p>
          </div>
          <div className="spacer" />
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" onClick={refreshAll} disabled={loading}>
              Refresh
            </button>
            <button className="btn btn-primary" onClick={openWizard}>
              Add robot
            </button>
          </div>
        </div>
        <div className="divider" />
        <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
          <div className="pill">
            <strong>Ports now:</strong>{" "}
            {Object.keys(ports).length === 0 ? (
              <span className="muted">Plug a device and hit refresh.</span>
            ) : (
              Object.entries(ports).map(([port, label]) => (
                <span key={port} style={{ marginRight: 10 }}>
                  {port} <span className="muted">({label})</span>
                </span>
              ))
            )}
          </div>
          <button className="btn btn-ghost" onClick={refreshPorts}>
            Refresh COM list
          </button>
          {loading && <span className="muted">Working...</span>}
          {error && <span className="error">{error}</span>}
          {message && <span className="success">{message}</span>}
        </div>
      </header>

      <section>
        <div className="row" style={{ marginBottom: 10 }}>
          <h2>Robots</h2>
          <div className="spacer" />
          <span className="muted">{robots.length} device(s)</span>
        </div>
        {robots.length === 0 ? (
          <div className="panel">
            <p className="muted">
              No robots yet. Add a robot to map its COM port and begin calibration.
            </p>
          </div>
        ) : (
          <div className="grid">
            {robots.map((robot) => {
              const followers = followerOptions[robot.model] || [];
              return (
                <div className="card" key={robot.id}>
                  <div className="row">
                    <h3 style={{ margin: 0 }}>{robot.name}</h3>
                    <div className="spacer" />
                    <span className={`tag ${robot.status}`}>
                      ● {robot.status === "online" ? "online" : "offline"}
                    </span>
                  </div>
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <span className="tag">{robot.model.toUpperCase()}</span>
                    <span className="tag">{robot.role}</span>
                    <span className="tag">COM {robot.com_port}</span>
                    {robot.has_calibration && <span className="tag">calibrated</span>}
                  </div>
                  <p className="muted">
                    {robot.has_calibration
                      ? "Calibration ready. Override if hardware changes."
                      : "Needs calibration before use."}
                  </p>
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <button className="btn btn-primary" onClick={() => handleCalibrate(robot)}>
                      {robot.has_calibration ? "Recalibrate" : "Calibrate"}
                    </button>
                    <button className="btn" onClick={() => setCalibrationTarget(robot)}>
                      Inspect
                    </button>
                    <button className="btn btn-danger" onClick={() => handleDelete(robot)}>
                      Delete
                    </button>
                  </div>

                  {robot.role === "leader" && (
                    <div className="panel" style={{ padding: 12, marginTop: 8 }}>
                      <div className="row">
                        <strong>Teleoperate</strong>
                        <div className="spacer" />
                        {activeTeleop?.leaderId === robot.id && (
                          <span className="tag">
                            Controlling {activeFollowerName(robot.id)}
                          </span>
                        )}
                      </div>
                      <p className="muted" style={{ marginTop: 6 }}>
                        Pick a calibrated follower of the same model.
                      </p>
                      <div className="row" style={{ gap: 8, marginTop: 8, alignItems: "center" }}>
                        <select
                          value={teleopSelection[robot.id] || ""}
                          onChange={(e) =>
                            setTeleopSelection({
                              ...teleopSelection,
                              [robot.id]: e.target.value,
                            })
                          }
                        >
                          <option value="">Select follower</option>
                          {followers.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name} {f.has_calibration ? "" : "(needs calibration)"}
                            </option>
                          ))}
                        </select>
                        <button className="btn" onClick={() => startTeleopFlow(robot)}>
                          Start teleop
                        </button>
                        <button className="btn btn-ghost" onClick={stopTeleop}>
                          Stop
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {wizardOpen && (
        <div className="modal">
          <div className="panel" style={{ maxWidth: 520, width: "100%" }}>
            <div className="row">
              <h3>Add a robot</h3>
              <div className="spacer" />
              <button className="btn btn-ghost" onClick={() => setWizardOpen(false)}>
                Close
              </button>
            </div>
            <p className="muted">Guide: identify COM → choose model/type → name it.</p>
            <div className="divider" />
            {wizardStep === 1 && (
              <div className="stack">
                <label>COM port</label>
                <select
                  value={wizardForm.com_port}
                  onChange={(e) => setWizardForm({ ...wizardForm, com_port: e.target.value })}
                >
                  <option value="">Select COM</option>
                  {Object.entries(ports).map(([port, label]) => (
                    <option key={port} value={port}>
                      {port} {label ? `(${label})` : ""}
                    </option>
                  ))}
                </select>
                <p className="notice">
                  Plug/unplug the robot so the port list changes. If you know the port, you can type
                  it manually.
                </p>
                <input
                  placeholder="Type a COM port manually (e.g. COM13)"
                  value={wizardForm.com_port}
                  onChange={(e) => setWizardForm({ ...wizardForm, com_port: e.target.value })}
                />
                <button className="btn btn-ghost" onClick={refreshPorts}>
                  Refresh COM list
                </button>
              </div>
            )}

            {wizardStep === 2 && (
              <div className="stack">
                <label>Model</label>
                <select
                  value={wizardForm.model}
                  onChange={(e) => setWizardForm({ ...wizardForm, model: e.target.value as "so101" })}
                >
                  <option value="so101">SO101</option>
                </select>
                <label>Role</label>
                <div className="row" style={{ gap: 8 }}>
                  <button
                    className={`btn ${wizardForm.role === "leader" ? "btn-primary" : ""}`}
                    onClick={() => setWizardForm({ ...wizardForm, role: "leader" })}
                  >
                    Leader arm
                  </button>
                  <button
                    className={`btn ${wizardForm.role === "follower" ? "btn-primary" : ""}`}
                    onClick={() => setWizardForm({ ...wizardForm, role: "follower" })}
                  >
                    Follower arm
                  </button>
                </div>
              </div>
            )}

            {wizardStep === 3 && (
              <div className="stack">
                <label>Name</label>
                <input
                  placeholder="Friendly name (e.g. Lab Leader)"
                  value={wizardForm.name}
                  onChange={(e) => setWizardForm({ ...wizardForm, name: e.target.value })}
                />
                <p className="muted">
                  We will bind this name, model, type, and COM port when calling calibration commands.
                </p>
              </div>
            )}

            <div className="divider" />
            <div className="row">
              <span className="muted">Step {wizardStep} of 3</span>
              <div className="spacer" />
              {wizardStep > 1 && (
                <button className="btn" onClick={() => setWizardStep((s) => s - 1)}>
                  Back
                </button>
              )}
              <button className="btn btn-primary" onClick={handleWizardNext}>
                {wizardStep === 3 ? "Finish" : "Next"}
              </button>
            </div>
          </div>
        </div>
      )}

      {calibrationTarget && (
        <div className="modal">
          <div className="panel" style={{ maxWidth: 720, width: "100%" }}>
            <div className="row">
              <h3>Calibrate {calibrationTarget.name}</h3>
              <div className="spacer" />
              <button className="btn btn-ghost" onClick={cancelCalibrationFlow}>
                Close
              </button>
            </div>
            <p className="notice">
              Place the arm in the neutral pose first. When you are ready, hit Start calibration to send ENTER,
              move through each joint range, then use End calibration to finish the sweep.
            </p>
            <div className="grid" style={{ marginTop: 12 }}>
              <div className="panel" style={{ padding: 12 }}>
                <strong>Calibration steps</strong>
                <div className="stack" style={{ marginTop: 10 }}>
                  {calibrationSteps.map((step) => {
                    const currentStep = calibrationReady ? 2 : 1;
                    const isActive = currentStep === step.index || (calibrationReady && step.index === 2);
                    const isDone = step.index < currentStep;
                    return (
                      <div
                        key={step.index}
                        className="row"
                        style={{
                          border: "1px solid var(--border)",
                          borderRadius: 10,
                          padding: "10px 12px",
                          background: isActive ? "rgba(127, 232, 195, 0.08)" : "rgba(255, 255, 255, 0.03)",
                          opacity: isDone ? 0.7 : 1,
                        }}
                      >
                        <div className="pill" style={{ minWidth: 28, textAlign: "center" }}>
                          {step.index}
                        </div>
                        <div className="stack" style={{ flex: 1 }}>
                          <span>{step.title}</span>
                          <span className="muted" style={{ fontSize: 13 }}>
                            {step.detail}
                          </span>
                        </div>
                        {isActive && <span className="tag">Now</span>}
                        {isDone && <span className="tag">Done</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="panel" style={{ padding: 12, marginTop: 10 }}>
              <div className="row">
                <strong>Process output</strong>
                <div className="spacer" />
                <span className="tag">
                  {calibrationSessionId ? (calibrationRunning ? "running" : "waiting") : "idle"}
                </span>
              </div>
            <p className="muted" style={{ marginTop: 6 }}>
              {calibrationSessionId
                ? "Prompts mirrored from the backend. Use Start calibration for the first ENTER and End calibration once you're done sweeping joints."
                : "No calibration process is active. Launch calibration to see live prompts here."}
            </p>
            <div
                style={{
                  background: "rgba(0, 0, 0, 0.08)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 10,
                  maxHeight: 180,
                  overflowY: "auto",
                  fontFamily: "SFMono-Regular, Consolas, Menlo, monospace",
                  fontSize: 13,
                  marginTop: 6,
                }}
              >
                {!calibrationSessionId ? (
                  <span className="muted">No session yet.</span>
                ) : displayedCalibrationLogs.length === 0 ? (
                  <span className="muted">Waiting for logs...</span>
                ) : (
                  displayedCalibrationLogs.map((line, idx) => <div key={`${idx}-${line}`}>{line}</div>)
                )}
              </div>
              {calibrationFailed && (
                <div className="notice" style={{ marginTop: 8 }}>
                  Calibration failed.{" "}
                  {(() => {
                    const stuck = extractUnmovedJoints(displayedCalibrationLogs);
                    if (stuck.length === 0) return "One or more joints did not move.";
                    return `These joints did not move: ${stuck.join(", ")}.`;
                  })()}
                  {" "}Move them through their range and restart.
                </div>
              )}
            </div>

            <div className="panel" style={{ padding: 12, marginTop: 10 }}>
              <div className="row">
                <strong>Live ranges</strong>
                <div className="spacer" />
                <span className="muted">{Object.keys(calibrationRanges).length} motors</span>
              </div>
              <p className="muted" style={{ marginTop: 6 }}>
                Min/pos/max streamed from the calibration loop. Move joints by hand to update.
              </p>
              <table style={{ marginTop: 8 }}>
                <thead>
                  <tr>
                    <th>Motor</th>
                    <th>Min</th>
                    <th>Current</th>
                    <th>Max</th>
                    <th>Range / position</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.values(calibrationRanges).length === 0 ? (
                    <tr>
                      <td colSpan={5}>
                        <span className="muted">Waiting for readings...</span>
                      </td>
                    </tr>
                  ) : (
                    Object.values(calibrationRanges).map((row) => {
                      const span = row.max - row.min;
                      const safeSpan = span === 0 ? 1 : span;
                      const percent = Math.max(0, Math.min(100, ((row.pos - row.min) / safeSpan) * 100));
                      const delta = Math.abs(span);
                      return (
                        <tr key={row.name}>
                          <td>{row.name}</td>
                          <td>{row.min.toFixed(0)}</td>
                          <td>{row.pos.toFixed(0)}</td>
                          <td>{row.max.toFixed(0)}</td>
                          <td>
                            <div className="range-meter">
                              <div className="range-meter__track">
                                <div className="range-meter__marker" style={{ left: `${percent}%` }} />
                              </div>
                              <div
                                className="row"
                                style={{ justifyContent: "space-between", fontSize: 12, color: "var(--muted)" }}
                              >
                                <span>Δ {delta.toFixed(0)}</span>
                                <span>{percent.toFixed(0)}%</span>
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {!calibrationReady ? (
              <div className="stack" style={{ marginTop: 12, gap: 8 }}>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <button
                    className="btn btn-primary"
                    onClick={calibrationStarted ? stopCalibrationSweep : sendEnterToCalibration}
                    disabled={!calibrationSessionId || calibrationFailed || Boolean(calibrationOverridePrompt)}
                  >
                    {calibrationStarted ? "End calibration" : "Start calibration"}
                  </button>
                  <button className="btn btn-ghost" onClick={cancelCalibrationFlow}>
                    Cancel
                  </button>
                </div>
                <p className="muted">
                  {calibrationStarted
                    ? "End sends a second ENTER to stop the sweep and capture ranges."
                    : "Start sends the first ENTER. Move every joint, then hit End to stop the sweep."}
                </p>
                {!calibrationRunning && !calibrationReady && (
                  <span className="muted">Calibration process not running.</span>
                )}
                {calibrationFailed && (
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <button
                      className="btn"
                      onClick={() => {
                        if (calibrationTarget) {
                          handleCalibrate(calibrationTarget);
                        }
                      }}
                    >
                      Restart calibration
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="stack" style={{ marginTop: 12, gap: 8 }}>
                <p className="muted">
                  Sweep complete. The captured live ranges above will be used for saving.
                </p>
                <div className="row">
                  <button className="btn btn-ghost" onClick={cancelCalibrationFlow}>
                    Cancel
                  </button>
                  <div className="spacer" />
                  <button className="btn btn-primary" onClick={saveCalibrationFlow}>
                    End & save
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {calibrationOverridePrompt && (
        <div className="modal">
          <div className="panel" style={{ maxWidth: 520, width: "100%" }}>
            <div className="row">
              <h3>Existing calibration detected</h3>
              <div className="spacer" />
              <button className="btn btn-ghost" onClick={cancelCalibrationOverride}>
                Cancel
              </button>
            </div>
            <p className="notice" style={{ marginTop: 6 }}>
              {calibrationTarget?.name || "This robot"} already has a calibration file. Continue to
              override it (send <code>c</code> + ENTER) or cancel to keep the existing file (send ENTER).
            </p>
            <p className="muted" style={{ marginTop: 8 }}>
              Prompt: {calibrationOverridePrompt.ready ? calibrationOverridePrompt.line : "Waiting for prompt..."}
            </p>
            <div className="divider" />
            <div className="row" style={{ gap: 8 }}>
              <button
                className="btn btn-primary"
                onClick={continueCalibrationOverride}
                disabled={!calibrationOverridePrompt.ready}
              >
                Continue calibration
              </button>
              <button className="btn" onClick={cancelCalibrationOverride}>
                Cancel calibration
              </button>
            </div>
          </div>
        </div>
      )}

      {calibrationErrorModal && (
        <div className="modal">
          <div className="panel" style={{ maxWidth: 480, width: "100%" }}>
            <div className="row">
              <h3>Calibration failed</h3>
              <div className="spacer" />
              <button className="btn btn-ghost" onClick={() => setCalibrationErrorModal(false)}>
                Close
              </button>
            </div>
            <p className="notice" style={{ marginTop: 8 }}>
              The calibration process exited with an error.{" "}
              {calibrationErrorJoints.length > 0
                ? `These joints did not move: ${calibrationErrorJoints.join(", ")}.`
                : "One or more joints did not move during the sweep."}
            </p>
            <p className="muted">
              Move all joints through their full range, then restart the calibration sweep.
            </p>
            <div className="divider" />
            <div className="row" style={{ gap: 8 }}>
              <button
                className="btn"
                onClick={() => {
                  setCalibrationErrorModal(false);
                  if (calibrationTarget) {
                    cleanupCalibrationSession();
                    handleCalibrate(calibrationTarget);
                  }
                }}
              >
                Restart calibration
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setCalibrationErrorModal(false);
                  cancelCalibrationFlow();
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
