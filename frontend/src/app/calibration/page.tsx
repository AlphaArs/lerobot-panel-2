"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  Calibration,
  JointCalibration,
  Robot,
  calibrationWsUrl,
  robotsWsUrl,
  cancelCalibration,
  fetchRobots,
  saveCalibration,
  sendCalibrationEnter,
  sendCalibrationInput,
  startCalibration,
  stopCalibration,
} from "@/lib/api";

const toMessage = (err: unknown) => (err instanceof Error ? err.message : "Request failed");

const seedJoints = (): JointCalibration[] => [
  { name: "base", min: -180, max: 180, current: 0 },
  { name: "shoulder", min: -180, max: 180, current: 0 },
  { name: "elbow", min: -180, max: 180, current: 0 },
  { name: "wrist_pitch", min: -180, max: 180, current: 0 },
  { name: "wrist_roll", min: -180, max: 180, current: 0 },
  { name: "gripper", min: -180, max: 180, current: 0 },
];

export default function CalibrationPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialRobotId = searchParams.get("robot");

  const [robots, setRobots] = useState<Robot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedRobotId] = useState<string | null>(initialRobotId);
  const [autoStarted, setAutoStarted] = useState(false);

  const [calibrationTarget, setCalibrationTarget] = useState<Robot | null>(null);
  const [calibrationReady, setCalibrationReady] = useState(false);
  const [calibrationSessionId, setCalibrationSessionId] = useState<string | null>(null);
  const [calibrationLogs, setCalibrationLogs] = useState<string[]>([]);
  const [calibrationRunning, setCalibrationRunning] = useState(false);
  const [calibrationStarted, setCalibrationStarted] = useState(false);
  const [calibrationStarting, setCalibrationStarting] = useState(false);
  const [calibrationSaving, setCalibrationSaving] = useState(false);
  const [calibrationWaitingForOutput, setCalibrationWaitingForOutput] = useState(false);
  const [completionOverlay, setCompletionOverlay] = useState(false);
  const [introVisible, setIntroVisible] = useState(true);
  const [showConsole, setShowConsole] = useState(false);
  const [consoleMounted, setConsoleMounted] = useState(false);
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

  const displayedCalibrationLogs = useMemo(() => calibrationLogs, [calibrationLogs]);

  const refreshRobots = useCallback(async () => {
    setError(null);
    try {
      const r = await fetchRobots();
      setRobots(r);
      return r;
    } catch (err) {
      setError(toMessage(err));
      return [];
    }
  }, []);

  useEffect(() => {
    refreshRobots();
  }, [refreshRobots]);

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

  useEffect(() => {
    if (!selectedRobotId) {
      setCalibrationTarget(null);
      return;
    }
    const target = robots.find((r) => r.id === selectedRobotId) || null;
    setCalibrationTarget(target);
  }, [robots, selectedRobotId]);

  useEffect(() => {
    if (!selectedRobotId) return;
    if (robots.length === 0) return;
    if (!calibrationTarget) {
      setError("Robot not found. Return home and start calibration from a listed robot.");
    }
  }, [selectedRobotId, robots, calibrationTarget]);
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
    setCalibrationSaving(false);
    setCalibrationWaitingForOutput(false);
    setCompletionOverlay(false);
    setIntroVisible(false);
    setShowConsole(false);
    setConsoleMounted(false);
  };

  const handleCalibrate = async () => {
    if (!calibrationTarget) {
      setError("No robot selected for calibration.");
      return;
    }
    if (calibrationSessionId) {
      try {
        await cancelCalibration(calibrationSessionId);
      } catch {
        // ignore
      }
    }
    cleanupCalibrationSession();
    setIntroVisible(true);
    setShowConsole(false);
    setCalibrationStarting(true);
    setCalibrationWaitingForOutput(true);
    setCalibrationReady(false);
    setCalibrationSaving(false);
    setCalibrationJoints(
      calibrationTarget.calibration?.joints?.length ? calibrationTarget.calibration.joints : seedJoints()
    );
    setCalibrationLogs([`Requesting calibration session for ${calibrationTarget.name}...`]);
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
      const res = await startCalibration(calibrationTarget.id, false);
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
      setCalibrationWaitingForOutput(false);
    } finally {
      setCalibrationStarting(false);
      setLoading(false);
    }
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
            setCalibrationWaitingForOutput(false);
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
    if (calibrationOverridePrompt) {
      setIntroVisible(false);
    }
  }, [calibrationOverridePrompt]);

  useEffect(() => {
    if (!calibrationWaitingForOutput) return;
    const placeholderTokens = [
      "requesting calibration session",
      "session created. waiting for device output",
      "calibration process started. waiting for device output",
    ];
    const hasRealOutput = calibrationLogs.some((line) => {
      const lower = line.toLowerCase();
      return !placeholderTokens.some((token) => lower.includes(token));
    });
    if (hasRealOutput) {
      setCalibrationWaitingForOutput(false);
    }
  }, [calibrationLogs, calibrationWaitingForOutput]);

  useEffect(() => {
    if (showConsole) {
      setConsoleMounted(true);
      return;
    }
    const timer = setTimeout(() => setConsoleMounted(false), 180);
    return () => clearTimeout(timer);
  }, [showConsole]);

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
    setMessage("Calibration stopped. Saving calibration...");
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
      const stuckFromLogs = extractUnmovedJoints(displayedCalibrationLogs);
      const zeroSpanJoints = Object.values(calibrationRanges)
        .filter((row) => Math.abs(row.max - row.min) < 1)
        .map((row) => row.name);
      const combined = Array.from(new Set([...stuckFromLogs, ...zeroSpanJoints]));
      setCalibrationErrorJoints(combined);
      setCalibrationSaving(false);
      setCompletionOverlay(false);
      setCalibrationErrorModal(true);
    }
  }, [calibrationFailed, displayedCalibrationLogs, calibrationRanges]);

  const saveCalibrationFlow = useCallback(async () => {
    if (!calibrationTarget) return;
    if (completionOverlay) return;
    const payload: Calibration = { joints: calibrationJoints };
    setLoading(true);
    try {
      const updated = await saveCalibration(calibrationTarget.id, payload);
      setRobots((list) => list.map((r) => (r.id === updated.id ? updated : r)));
      cleanupCalibrationSession();
      setCalibrationTarget(updated);
      setCalibrationReady(false);
      setMessage("Calibration saved.");
      setCompletionOverlay(true);
      setTimeout(() => {
        router.push("/");
      }, 5000);
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setLoading(false);
      setCalibrationSaving(false);
    }
  }, [calibrationTarget, calibrationJoints, completionOverlay, router]);

  useEffect(() => {
    if (calibrationReady && calibrationSaving && calibrationTarget && !completionOverlay && !calibrationFailed) {
      void saveCalibrationFlow();
    }
  }, [calibrationReady, calibrationSaving, calibrationTarget, completionOverlay, calibrationFailed, saveCalibrationFlow]);
  const sendEnterToCalibration = async () => {
    if (calibrationOverridePrompt) {
      setMessage("Resolve the override prompt first.");
      return false;
    }
    if (!calibrationSessionId) {
      setError("No calibration session is active.");
      return false;
    }
    try {
      await sendCalibrationEnter(calibrationSessionId);
      setCalibrationStarted(true);
      setMessage("Calibration started. Move each joint, then hit End calibration to finish.");
      return true;
    } catch (err) {
      setError(toMessage(err));
    }
    return false;
  };

  const startSweepFromIntro = async () => {
    const ok = await sendEnterToCalibration();
    if (ok) {
      setIntroVisible(false);
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
      router.push("/");
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
      setCalibrationWaitingForOutput(false);
      router.push("/");
    }
  };

  const stopCalibrationSweep = async () => {
    if (!calibrationSessionId) {
      setError("No calibration session is active.");
      return;
    }
    setCalibrationSaving(true);
    try {
      await stopCalibration(calibrationSessionId);
      setMessage("Stop ENTER sent. Waiting for calibration to finish...");
    } catch {
      try {
        await sendCalibrationEnter(calibrationSessionId);
        setMessage("Stop request retried via ENTER. Waiting for calibration to finish...");
      } catch (fallbackErr) {
        setError(toMessage(fallbackErr));
        setCalibrationSaving(false);
      }
    }
  };

  const cancelCalibrationFlow = async () => {
    if (!calibrationSessionId) {
      cleanupCalibrationSession();
      setCalibrationReady(false);
      setCalibrationWaitingForOutput(false);
      router.push("/");
      return;
    }
    try {
      await cancelCalibration(calibrationSessionId);
      setMessage("Calibration cancelled.");
    } catch (err) {
      setError(toMessage(err));
    } finally {
      cleanupCalibrationSession();
      setCalibrationReady(false);
      setCalibrationWaitingForOutput(false);
      router.push("/");
    }
  };


  const calibrationSteps = [
    { title: "Set neutral pose", detail: "Place the arm in its neutral position before starting.", index: 1 },
    { title: "Sweep joints", detail: "Move each joint through its range and record min/current/max.", index: 2 },
    { title: "Save calibration", detail: "Confirm values and save to store the calibration.", index: 3 },
  ];


  const activeRobotName = calibrationTarget?.name || "Select a robot";

  useEffect(() => {
    if (calibrationTarget && !autoStarted) {
      setAutoStarted(true);
      void handleCalibrate();
    }
    // We intentionally only react to the initial target to avoid restarting calibration mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calibrationTarget, autoStarted]);
  return (
    <>
      <main className="page">
        <header className="panel" style={{ marginBottom: 16 }}>
          <div className="row" style={{ alignItems: "center", gap: 12 }}>
            <button className="btn" onClick={() => router.push("/")}>
              {"< Back"}
            </button>
            <div className="stack" style={{ flex: 1 }}>
              <p className="tag">Calibration</p>
              <h1 style={{ margin: "4px 0 2px" }}>Calibrate your robot</h1>
              <p className="muted" style={{ margin: 0 }}>
                We launch the calibration session right away. Line up the arm during the intro step, then
                end the sweep once you have moved every joint.
              </p>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button
                className={`btn ${showConsole ? "btn-primary" : ""}`}
                onClick={() => setShowConsole((v) => !v)}
                title="Toggle process output"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 6h16v12H4z" />
                  <path d="M8 10l3 2-3 2" />
                  <path d="M12 14h4" />
                </svg>
                <span>{showConsole ? "Hide output" : "Show output"}</span>
              </button>
            </div>
            <div className="stack" style={{ alignItems: "flex-end" }}>
              {error && <span className="error">{error}</span>}
              {message && <span className="success">{message}</span>}
            </div>
          </div>
        </header>

        <section className="panel" style={{ marginBottom: 12 }}>
          {calibrationTarget ? (
            <div className="row" style={{ alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div className="stack" style={{ minWidth: 260 }}>
                <p className="tag">Target robot</p>
                <h2 style={{ margin: "4px 0" }}>{activeRobotName}</h2>
                <p className="muted" style={{ margin: 0 }}>
                  COM {calibrationTarget.com_port} | {calibrationTarget.role} | {calibrationTarget.status}
                </p>
              </div>
              <div className="spacer" />
              <div className="row" style={{ gap: 8 }}>
                <button className="btn" onClick={() => refreshRobots()} disabled={loading}>
                  Refresh status
                </button>
                <button className="btn btn-ghost" onClick={cancelCalibrationFlow}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="row" style={{ alignItems: "center" }}>
              <p className="muted" style={{ margin: 0 }}>No robot provided. Return to home and start calibration from there.</p>
              <div className="spacer" />
              <button className="btn" onClick={() => router.push("/")}>Back home</button>
            </div>
          )}
        </section>

        {!calibrationTarget ? (
          <div className="panel">
            <p className="muted">No robot selected. Choose one above to start calibrating.</p>
          </div>
        ) : (
          <div className="stack" style={{ gap: 12 }}>
            <div className="panel" style={{ padding: 12 }}>
              <div className="row">
                <strong>Calibration steps</strong>
                <div className="spacer" />
                <span className="tag">{calibrationReady ? "ready to save" : "in progress"}</span>
              </div>
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
                      <div className="pill" style={{ minWidth: 28, textAlign: "center" }}>{step.index}</div>
                      <div className="stack" style={{ flex: 1 }}>
                        <span>{step.title}</span>
                        <span className="muted" style={{ fontSize: 13 }}>{step.detail}</span>
                      </div>
                      {isActive && <span className="tag">Now</span>}
                      {isDone && <span className="tag">Done</span>}
                    </div>
                  );
                })}
              </div>
            </div>

            {consoleMounted && (
              <div
                className="panel"
                style={{
                  padding: 12,
                  opacity: showConsole ? 1 : 0,
                  transform: showConsole ? "translateY(0)" : "translateY(-6px)",
                  pointerEvents: showConsole ? "auto" : "none",
                  transition: "opacity 0.2s ease, transform 0.2s ease",
                }}
              >
                <div className="row">
                  <strong>Process output</strong>
                  <div className="spacer" />
                  <span className="tag">
                    {calibrationSessionId ? (calibrationRunning ? "running" : "waiting") : "idle"}
                  </span>
                </div>
                <p className="muted" style={{ marginTop: 6 }}>
                  {calibrationSessionId
                    ? "Mirrors the calibration script output. Hidden by default to keep the interface clean."
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
                    Calibration failed. {(() => {
                      const stuck = extractUnmovedJoints(displayedCalibrationLogs);
                      if (stuck.length === 0) return "One or more joints did not move.";
                      return `These joints did not move: ${stuck.join(", ")}.`;
                    })()} Move them through their range and restart.
                  </div>
                )}
              </div>
            )}

            <div className="panel" style={{ padding: 12 }}>
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
                                <span>range {delta.toFixed(0)}</span>
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
                    disabled={
                      !calibrationSessionId ||
                      calibrationFailed ||
                      Boolean(calibrationOverridePrompt) ||
                      calibrationSaving ||
                      (introVisible && !calibrationStarted)
                    }
                  >
                    {calibrationSaving ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <span
                          style={{
                            width: 16,
                            height: 16,
                            borderRadius: "50%",
                            border: "2px solid rgba(255,255,255,0.3)",
                            borderTopColor: "white",
                            animation: "spin 0.8s linear infinite",
                          }}
                        />
                        Ending...
                      </span>
                    ) : calibrationStarted ? (
                      "End calibration"
                    ) : (
                      "Start sweep"
                    )}
                  </button>
                  <button className="btn btn-ghost" onClick={cancelCalibrationFlow}>
                    Cancel
                  </button>
                </div>
                <p className="muted">
                  {calibrationStarted
                    ? "End sends a second ENTER to stop the sweep and capture ranges."
                    : "Press Next on the intro screen to send the first ENTER and begin sweeping joints."}
                </p>
                {introVisible && !calibrationStarted && (
                  <span className="muted">Complete the intro step to start the sweep.</span>
                )}
                {!calibrationRunning && !calibrationReady && (
                  <span className="muted">
                    {calibrationStarted ? "Waiting for live data..." : "Calibration process not running."}
                  </span>
                )}
                {calibrationFailed && (
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <button className="btn" onClick={() => handleCalibrate()}>
                      Restart calibration
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="stack" style={{ marginTop: 12, gap: 8 }}>
                <p className="muted">Sweep complete. Saving calibration and returning home...</p>
              </div>
            )}
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
                override it (send c + ENTER) or cancel to keep the existing file (send ENTER).
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
                  ? `These joints need attention: ${calibrationErrorJoints.join(", ")}.`
                  : "One or more joints did not move during the sweep."}
              </p>
              <p className="muted">
                Make sure each joint starts near its mid-range, then move it fully to both extremes before ending calibration.
              </p>
              <div className="divider" />
              <div className="row" style={{ gap: 8 }}>
                <button
                  className="btn"
                  onClick={() => {
                    setCalibrationErrorModal(false);
                    handleCalibrate();
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

      {introVisible && calibrationTarget && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(5, 10, 20, 0.9)",
            backdropFilter: "blur(10px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            zIndex: 60,
          }}
        >
          <div className="panel" style={{ maxWidth: 640, width: "100%", textAlign: "center" }}>
            <p className="tag" style={{ display: "inline-flex", marginBottom: 8 }}>
              Step 1 - Position the arm
            </p>
            <div className="robot-placeholder">
              <svg width="220" height="140" viewBox="0 0 220 140" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="30" y="90" width="160" height="24" rx="8" fill="rgba(127, 232, 195, 0.08)" />
                <circle cx="62" cy="82" r="12" fill="rgba(127, 232, 195, 0.2)" />
                <circle cx="158" cy="82" r="12" fill="rgba(127, 232, 195, 0.2)" />
                <path d="M110 50 L150 70 L158 82" stroke="currentColor" />
                <path d="M110 50 L70 70 L62 82" stroke="currentColor" />
                <circle cx="110" cy="50" r="14" fill="rgba(127, 232, 195, 0.16)" />
                <rect x="96" y="28" width="28" height="10" rx="5" fill="rgba(255, 179, 107, 0.35)" stroke="none" />
              </svg>
            </div>
            <h2 style={{ margin: "10px 0 6px" }}>Put the robot in neutral</h2>
            <p className="muted" style={{ margin: 0 }}>
              Center the joints and keep the gripper relaxed. We will start the sweep as soon as the
              calibration script is ready.
            </p>
            <div className="row" style={{ justifyContent: "center", gap: 10, marginTop: 14 }}>
              <button className="btn btn-ghost" onClick={cancelCalibrationFlow}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={startSweepFromIntro}
                disabled={calibrationWaitingForOutput || !calibrationSessionId}
              >
                {calibrationWaitingForOutput ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: "50%",
                        border: "2px solid rgba(255,255,255,0.3)",
                        borderTopColor: "white",
                        animation: "spin 0.8s linear infinite",
                      }}
                    />
                    Waiting for output...
                  </span>
                ) : (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    Next
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M5 12h14" />
                      <path d="M13 6l6 6-6 6" />
                    </svg>
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0, 0, 0, 0.6)",
          backdropFilter: "blur(8px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          zIndex: 30,
          opacity: calibrationWaitingForOutput && !introVisible ? 1 : 0,
          pointerEvents: calibrationWaitingForOutput && !introVisible ? "auto" : "none",
          transition: calibrationWaitingForOutput ? "none" : "opacity 0.2s ease",
        }}
      >
        <div style={{ color: "white", fontSize: 18, fontWeight: 600, marginBottom: 10 }}>
          Setting things up...
        </div>
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: "50%",
            border: "4px solid rgba(255,255,255,0.25)",
            borderTopColor: "white",
            animation: "spin 1s linear infinite",
            marginBottom: 12,
          }}
        />
        <button
          className="btn"
          style={{
            background: "rgba(255,255,255,0.12)",
            color: "white",
            border: "1px solid rgba(255,255,255,0.3)",
            minWidth: 140,
          }}
          onClick={cancelCalibrationFlow}
        >
          Cancel
        </button>
      </div>

      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0, 0, 0, 0.6)",
          backdropFilter: "blur(8px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          zIndex: 40,
          opacity: completionOverlay ? 1 : 0,
          pointerEvents: completionOverlay ? "auto" : "none",
          transition: "opacity 0.3s ease",
        }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: "50%",
            border: "5px solid rgba(255,255,255,0.25)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 14,
            background: "rgba(255,255,255,0.08)",
          }}
        >
          <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" className="checkmark-svg">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
        <div style={{ color: "white", fontSize: 18, fontWeight: 600 }}>Calibration saved</div>
      </div>

      <style jsx global>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .checkmark-svg path {
          stroke-dasharray: 40;
          stroke-dashoffset: 40;
          animation: draw 0.5s ease forwards;
        }
        @keyframes draw {
          to { stroke-dashoffset: 0; }
        }
      `}</style>
    </>
  );
}
