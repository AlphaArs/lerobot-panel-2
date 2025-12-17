"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  const [teleopStarting, setTeleopStarting] = useState(false);
  const [disconnectModalOpen, setDisconnectModalOpen] = useState(false);
  const [disconnectAlertRoles, setDisconnectAlertRoles] = useState<Array<"leader" | "follower">>([]);

  const previousStatuses = useRef<{ leader?: Robot["status"]; follower?: Robot["status"] }>({});
  const teleopStartingRef = useRef(false);
  const runningRef = useRef(false);
  const suppressDisconnectModalUntilRef = useRef(0);

  useEffect(() => {
    teleopStartingRef.current = teleopStarting;
  }, [teleopStarting]);

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  const isTeleopConfirmedStartedFromLogs = (maybeLogs: unknown) => {
    if (!Array.isArray(maybeLogs)) return false;

    const lines = maybeLogs.filter((line): line is string => typeof line === "string").map((line) => line.trim());
    if (lines.some((line) => /^time:\s/i.test(line))) return true;

    const leaderConnected = lines.some((line) => /\bleader\b.*\bconnected\.\b/i.test(line));
    const followerConnected = lines.some((line) => /\bfollower\b.*\bconnected\.\b/i.test(line));
    return leaderConnected && followerConnected;
  };

  const inferDisconnectFromLogs = (maybeLogs: unknown) => {
    if (!Array.isArray(maybeLogs)) return null;
    const lines = maybeLogs
      .filter((line): line is string => typeof line === "string")
      .map((line) => line.trim())
      .filter(Boolean);

    const errorMarkers = [
      "serialtimeoutexception",
      "write timeout",
      "could not open port",
      "file not found",
      "filenotfounderror",
      "permissionerror",
      "access is denied",
      "no such file or directory",
    ];

    const hasDisconnectMarker = lines.some((line) => {
      const lowered = line.toLowerCase();
      return errorMarkers.some((marker) => lowered.includes(marker));
    });
    if (!hasDisconnectMarker) return null;

    const leaderHints = ["so101_leader", "so100_leader", "01_leader.py", "leader.py", "so101leader"];
    const followerHints = ["so101_follower", "so100_follower", "follower.py", "so101follower"];

    const mentionsLeader = lines.some((line) => {
      const lowered = line.toLowerCase();
      return leaderHints.some((hint) => lowered.includes(hint));
    });
    const mentionsFollower = lines.some((line) => {
      const lowered = line.toLowerCase();
      return followerHints.some((hint) => lowered.includes(hint));
    });

    if (mentionsLeader && !mentionsFollower) return { role: "leader" as const };
    if (mentionsFollower && !mentionsLeader) return { role: "follower" as const };
    return { role: "follower" as const };
  };

  const mergeDisconnectRoles = (existing: Array<"leader" | "follower">, incoming: Array<"leader" | "follower">) =>
    Array.from(new Set([...existing, ...incoming]));

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
    setTeleopStarting(false);
    setDisconnectModalOpen(false);
    setDisconnectAlertRoles([]);
    previousStatuses.current = {};
    suppressDisconnectModalUntilRef.current = 0;
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

          if (teleopStartingRef.current || runningRef.current) {
            const inferred = inferDisconnectFromLogs(payload?.logs);
            if (inferred?.role === "leader" && leader) {
              setDisconnectModalOpen(true);
              setDisconnectAlertRoles((existing) => mergeDisconnectRoles(existing, ["leader"]));
            } else if (inferred?.role === "follower" && follower) {
              setDisconnectModalOpen(true);
              setDisconnectAlertRoles((existing) => mergeDisconnectRoles(existing, ["follower"]));
            }
          }

          if (
            teleopStartingRef.current &&
            isTeleopConfirmedStartedFromLogs(payload?.logs)
          ) {
            setTeleopStarting(false);
            setSafetyModal(false);
          }
          if (teleopStartingRef.current && payload?.return_code != null && payload?.running === false) {
            setTeleopStarting(false);
            setError(`Teleop exited during startup (code=${payload.return_code}).`);
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
    if (!leaderId || !followerId) return;

    const leaderSnap = robots.find((r) => r.id === leaderId);
    const followerSnap = robots.find((r) => r.id === followerId);
    const leaderStatus = leaderSnap?.status;
    const followerStatus = followerSnap?.status;

    const offlineRoles: Array<"leader" | "follower"> = [];
    if (leaderStatus === "offline") offlineRoles.push("leader");
    if (followerStatus === "offline") offlineRoles.push("follower");
    if (offlineRoles.length > 0) {
      setDisconnectAlertRoles((existing) => mergeDisconnectRoles(existing, offlineRoles));
      if (Date.now() >= suppressDisconnectModalUntilRef.current) {
        setDisconnectModalOpen(true);
      }
    }

    previousStatuses.current = {
      leader: leaderStatus,
      follower: followerStatus,
    };
  }, [robots, leaderId, followerId]);

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
    setTeleopStarting(true);
    setShowConsole(true);
    suppressDisconnectModalUntilRef.current = Date.now() + 2500;
    setError(null);
    setMessage(null);
    setLogs([`Starting: ${commandString}`]);
    try {
      const res = await startTeleop(leader.id, follower.id);
      setMessage(res.message);
      setSessionId(res.session_id || null);
      setRunning(!res.dry_run);
      if (res.dry_run) {
        setTeleopStarting(false);
        setSafetyModal(false);
      }
    } catch (err) {
      setError(toMessage(err));
      setTeleopStarting(false);
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

  const leaderOnline = leader?.status === "online";
  const followerOnline = follower?.status === "online";
  const bothConnected = Boolean(leaderOnline && followerOnline);

  const disconnectedNow = useMemo(() => {
    const parts: string[] = [];
    if (!leaderOnline && leader) parts.push(`Leader: ${leader.name}`);
    if (!followerOnline && follower) parts.push(`Follower: ${follower.name}`);
    return parts;
  }, [leader, follower, leaderOnline, followerOnline]);

  const disconnectedRemembered = useMemo(() => {
    const parts: string[] = [];
    if (disconnectAlertRoles.includes("leader") && leader) parts.push(`Leader: ${leader.name}`);
    if (disconnectAlertRoles.includes("follower") && follower) parts.push(`Follower: ${follower.name}`);
    return parts;
  }, [disconnectAlertRoles, leader, follower]);

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
                <button className="btn btn-danger" onClick={() => stop(false)} disabled={loading || teleopStarting}>
                  Stop teleop
                </button>
              ) : (
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    if (!bothConnected) {
                      setDisconnectModalOpen(true);
                      setDisconnectAlertRoles((existing) =>
                        mergeDisconnectRoles(existing, [
                          ...(leaderOnline ? [] : (["leader"] as const)),
                          ...(followerOnline ? [] : (["follower"] as const)),
                        ])
                      );
                      return;
                    }
                    setSafetyModal(true);
                  }}
                  disabled={loading || teleopStarting || !bothConnected}
                >
                  Start teleop
                </button>
              )}
            </div>
            {!bothConnected && (
              <p className="muted" style={{ marginBottom: 0, marginTop: 10 }}>
                Both leader and follower must be online to start.
              </p>
            )}
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
              <button className="btn btn-ghost" onClick={handleBack} disabled={loading}>
                Cancel
              </button>
              <button
                className="btn btn-primary-ghost"
                onClick={start}
                disabled={loading || teleopStarting || !bothConnected}
                style={{
                  display: "grid",
                  gridTemplateColumns: "16px auto 16px",
                  columnGap: 8,
                  alignItems: "center",
                  justifyItems: "center",
                  padding: "8px 12px",
                  transform: teleopStarting ? "scale(1.03)" : "scale(1)",
                  transition: "transform 220ms ease",
                }}
              >
                <span aria-hidden="true" style={{ width: 16, height: 16, display: "inline-block" }} />
                <span style={{ textAlign: "center" }}>{teleopStarting ? "Starting" : "Start"}</span>
                <span
                  className={teleopStarting ? "spinner" : "spinner invisible"}
                  aria-hidden="true"
                />
              </button>
            </div>
            <p className="muted" style={{ marginBottom: 0, marginTop: 12, minHeight: 18 }}>
              {!bothConnected
                ? "Waiting for both devices to be online..."
                : teleopStarting
                  ? "Waiting for the robot to connect..."
                  : " "}
            </p>
          </div>
        </div>
      )}

      {disconnectModalOpen && (
        <div className="modal" style={{ zIndex: 40, background: "rgba(0, 0, 0, 0.72)" }}>
          <div className="panel" style={{ maxWidth: 560, width: "100%" }}>
            <p className="tag" style={{ display: "inline-flex", marginBottom: 10 }}>
              Warning
            </p>
            <h3 style={{ marginTop: 0, marginBottom: 8 }}>Device disconnected</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              {disconnectedNow.length > 0
                ? `Disconnected: ${disconnectedNow.join(" • ")}`
                : disconnectedRemembered.length > 0
                  ? `Disconnected: ${disconnectedRemembered.join(" • ")}`
                  : "A teleoperation device disconnected."}
            </p>

            <div className="divider" />
            <div className="stack" style={{ gap: 10 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="muted">Leader</span>
                <span className={`tag ${leaderOnline ? "online" : "offline"}`}>{leaderOnline ? "online" : "offline"}</span>
              </div>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="muted">Follower</span>
                <span className={`tag ${followerOnline ? "online" : "offline"}`}>{followerOnline ? "online" : "offline"}</span>
              </div>
            </div>

            <div className="row" style={{ gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
              <button
                className="btn btn-ghost"
                onClick={async () => {
                  setDisconnectModalOpen(false);
                  setDisconnectAlertRoles([]);
                  try {
                    if (running) await stop(false);
                  } catch {
                    // ignore
                  }
                  router.push(`/robots/${leader?.id ?? ""}`);
                }}
                disabled={loading}
              >
                Leave
              </button>
              <button
                className="btn btn-primary-ghost"
                onClick={async () => {
                  setDisconnectModalOpen(false);
                  setDisconnectAlertRoles([]);
                  if (running) {
                    await stop(false);
                  }
                  setSafetyModal(true);
                }}
                disabled={loading || !bothConnected}
              >
                Next
              </button>
            </div>
            {!bothConnected && (
              <p className="muted" style={{ marginBottom: 0, marginTop: 12 }}>
                Reconnect both devices to continue.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
