"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Robot, fetchRobots, robotsWsUrl, startTeleop, stopTeleop, teleopWsUrl } from "@/lib/api";

const toMessage = (err: unknown) => (err instanceof Error ? err.message : "Request failed");

export default function TeleopPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const leaderId = searchParams.get("leader");
  const followerId = searchParams.get("follower");

  const [robots, setRobots] = useState<Robot[]>([]);
  const [leader, setLeader] = useState<Robot | null>(null);
  const [follower, setFollower] = useState<Robot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [showConsole, setShowConsole] = useState(false);
  const [consoleMounted, setConsoleMounted] = useState(false);
  const [safetyModal, setSafetyModal] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const list = await fetchRobots();
        setRobots(list);
      } catch (err) {
        setError(toMessage(err));
      }
    };
    void load();
  }, []);

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
    const l = robots.find((r) => r.id === leaderId) || null;
    const f = robots.find((r) => r.id === followerId) || null;
    setLeader(l);
    setFollower(f);
  }, [robots, leaderId, followerId]);

  useEffect(() => {
    setSessionId(null);
    setRunning(false);
    setLogs([]);
    setMessage(null);
    setError(null);
    setSafetyModal(true);
  }, [leaderId, followerId]);

  useEffect(() => {
    if (!sessionId) return;
    let socket: WebSocket | null = null;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(teleopWsUrl(sessionId));
      socket.onmessage = (event) => {
        if (stopped) return;
        try {
          const payload = JSON.parse(event.data);
          if (payload?.error) return;
          if (Array.isArray(payload?.logs)) {
            setLogs(payload.logs);
          }
          if (typeof payload?.running === "boolean") {
            setRunning(payload.running);
          }
          if (payload?.return_code != null && payload?.running === false) {
            setMessage(`Teleop exited (code=${payload.return_code}).`);
          }
        } catch {
          // ignore malformed payloads
        }
      };
    };

    connect();
    return () => {
      stopped = true;
      if (socket) socket.close();
    };
  }, [sessionId]);

  useEffect(() => {
    if (showConsole) {
      setConsoleMounted(true);
      return;
    }
    const timer = setTimeout(() => setConsoleMounted(false), 200);
    return () => clearTimeout(timer);
  }, [showConsole]);

  const followerDeviceType = useMemo(() => {
    if (!follower) return "";
    return `${follower.model}_${follower.role}`;
  }, [follower]);

  const leaderDeviceType = useMemo(() => {
    if (!leader) return "";
    return `${leader.model}_${leader.role}`;
  }, [leader]);

  const commandString = follower && leader
    ? `lerobot-teleoperate --robot.type=${followerDeviceType} --robot.port=${follower.com_port} --robot.id=${follower.name} --teleop.type=${leaderDeviceType} --teleop.port=${leader.com_port} --teleop.id=${leader.name}`
    : "lerobot-teleoperate ...";

  const start = async () => {
    if (!leader || !follower) {
      setError("Leader or follower missing.");
      return;
    }
    setLoading(true);
    setError(null);
    setMessage(null);
    setLogs([`Starting: ${commandString}`]);
    try {
      const res = await startTeleop(leader.id, follower.id);
      setMessage(res.message);
      setSessionId(res.session_id || null);
      setRunning(!res.dry_run);
      setSafetyModal(false);
      setShowConsole(true);
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const stop = async (navigateBack = false) => {
    if (!leader || !follower) {
      if (navigateBack) router.push("/");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await stopTeleop(leader.id, follower.id);
      setMessage(res.message);
      setRunning(false);
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setLoading(false);
      if (navigateBack) {
        router.push(`/robots/${leader.id}`);
      }
    }
  };

  const handleBack = async () => {
    if (running) {
      await stop(true);
      return;
    }
    router.push(`/robots/${leader?.id ?? ""}`);
  };

  if (!leaderId || !followerId) {
    return (
      <main className="page">
        <p className="error">Missing leader or follower id. Launch teleop from a robot page.</p>
        <button className="btn" onClick={() => router.push("/")}>Back home</button>
      </main>
    );
  }

  return (
    <>
      <main className="page">
        <header className="panel" style={{ marginBottom: 16 }}>
          <div className="row" style={{ alignItems: "center", gap: 12 }}>
            <button className="btn" onClick={handleBack}>
              {"< Back"}
            </button>
            <div className="stack" style={{ flex: 1 }}>
              <p className="tag">Teleoperation</p>
              <h1 style={{ margin: "4px 0" }}>Leader ↔ Follower</h1>
              <p className="muted" style={{ margin: 0 }}>
                Start teleop after positioning both arms in similar poses. Stop anytime to pause control.
              </p>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button
                className={`btn ${showConsole ? "btn-primary" : ""}`}
                onClick={() => setShowConsole((v) => !v)}
              >
                Console
              </button>
            </div>
            <div className="stack" style={{ minWidth: 200, alignItems: "flex-end" }}>
              {loading && <span className="muted">Working...</span>}
              {error && <span className="error">{error}</span>}
              {message && <span className="success">{message}</span>}
            </div>
          </div>
        </header>

        <div className="stack" style={{ gap: 12 }}>
          <div className="panel">
            <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
              <div className="stack" style={{ minWidth: 240 }}>
                <p className="tag">Leader</p>
                <h2 style={{ margin: "4px 0" }}>{leader?.name || "Unknown"}</h2>
                <p className="muted" style={{ margin: 0 }}>
                  {leader?.model.toUpperCase()} · {leader?.role} · COM {leader?.com_port}
                </p>
              </div>
              <div className="stack" style={{ minWidth: 240 }}>
                <p className="tag">Follower</p>
                <h2 style={{ margin: "4px 0" }}>{follower?.name || "Unknown"}</h2>
                <p className="muted" style={{ margin: 0 }}>
                  {follower?.model.toUpperCase()} · {follower?.role} · COM {follower?.com_port}
                </p>
              </div>
              <div className="spacer" />
              <div className="stack" style={{ alignItems: "flex-end" }}>
                <span className="tag">{running ? "running" : "idle"}</span>
                <span className="muted" style={{ fontSize: 12 }}>Command: {commandString}</span>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {running ? (
                <button className="btn btn-danger" onClick={() => stop(false)} disabled={loading}>
                  Stop teleop
                </button>
              ) : (
                <button className="btn btn-primary" onClick={() => setSafetyModal(true)} disabled={loading}>
                  Start teleop
                </button>
              )}
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
                <span className="tag">{running ? "running" : "idle"}</span>
              </div>
              <p className="muted" style={{ marginTop: 6 }}>
                Output mirrored from teleop start/stop calls.
              </p>
              <div
                style={{
                  background: "rgba(0, 0, 0, 0.08)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 10,
                  maxHeight: 220,
                  overflowY: "auto",
                  fontFamily: "SFMono-Regular, Consolas, Menlo, monospace",
                  fontSize: 13,
                  marginTop: 6,
                }}
              >
                {logs.length === 0 ? (
                  <span className="muted">No output yet.</span>
                ) : (
                  logs.map((line, idx) => <div key={`${idx}-${line}`}>{line}</div>)
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {safetyModal && (
        <div
          className="modal"
          style={{
            background: "rgba(0, 0, 0, 0.65)",
            backdropFilter: "blur(8px)",
          }}
        >
          <div className="panel" style={{ maxWidth: 560, width: "100%", textAlign: "center" }}>
            <p className="tag" style={{ display: "inline-flex", marginBottom: 8 }}>
              Safety check
            </p>
            <h2 style={{ margin: "6px 0" }}>Align both arms</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Set the leader and follower to roughly the same pose to avoid strain when teleoperation starts.
            </p>
            <div className="robot-placeholder">
              <svg width="220" height="140" viewBox="0 0 220 140" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="28" y="92" width="164" height="22" rx="8" fill="rgba(127, 232, 195, 0.08)" />
                <path d="M80 90 L110 60 L140 90" />
                <circle cx="80" cy="90" r="10" />
                <circle cx="140" cy="90" r="10" />
              </svg>
            </div>
            <div className="row" style={{ justifyContent: "center", gap: 10, marginTop: 14 }}>
              <button className="btn btn-ghost" onClick={handleBack}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={start} disabled={loading}>
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
