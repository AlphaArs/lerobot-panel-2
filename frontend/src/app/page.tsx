"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Robot, createRobot, deleteRobot, fetchPorts, fetchRobots, robotsWsUrl } from "@/lib/api";

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
  const router = useRouter();
  const [robots, setRobots] = useState<Robot[]>([]);
  const [ports, setPorts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardForm, setWizardForm] = useState<WizardForm>(defaultWizard);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

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

  const openWizard = () => {
    setWizardForm(defaultWizard);
    setWizardStep(1);
    setWizardOpen(true);
  };

  const handleWizardNext = () => {
    if (wizardStep === 1 && !wizardForm.com_port) {
      setError("Pick a COM port before continuing.");
      return;
    }
    if (wizardStep === 3) {
      void handleCreateRobot();
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

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const allSelected = robots.length > 0 && selectedIds.size === robots.length;

  const handleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(robots.map((r) => r.id)));
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) {
      setConfirmBulkDelete(false);
      return;
    }
    setLoading(true);
    setError(null);
    const failed: string[] = [];
    const idsToDelete = Array.from(selectedIds);
    for (const id of idsToDelete) {
      const target = robots.find((r) => r.id === id);
      try {
        await deleteRobot(id);
      } catch {
        failed.push(target?.name || id);
      }
    }
    setRobots((list) => list.filter((r) => !selectedIds.has(r.id)));
    setSelectedIds(new Set());
    setConfirmBulkDelete(false);
    setLoading(false);
    if (failed.length) {
      setError(`Could not delete: ${failed.join(", ")}`);
    } else {
      setMessage("Selected robots deleted.");
    }
  };

  const formatLastSeen = (value?: string | null) => {
    if (!value) return "Never seen online yet";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "Last seen unknown";
    return `Seen ${parsed.toLocaleString()}`;
  };

  const sortedRobots = useMemo(
    () => [...robots].sort((a, b) => a.name.localeCompare(b.name)),
    [robots]
  );

  return (
    <>
      <main className="page">
        <header className="panel" style={{ marginBottom: 16 }}>
          <div className="row" style={{ alignItems: "flex-start", gap: 16 }}>
            <div>
              <p className="tag">LeRobot control stack</p>
              <h1 style={{ margin: "8px 0 4px" }}>SO101 fleet manager</h1>
              <p className="muted" style={{ maxWidth: 620 }}>
                Monitor every robot at a glance. Select rows to bulk delete and click a robot to
                open its dedicated page with calibration, teleoperation, and settings.
              </p>
              <div className="row" style={{ gap: 10, marginTop: 8, flexWrap: "wrap" }}>
                <div className="pill">
                  <strong>Ports:</strong>{" "}
                  {Object.keys(ports).length === 0 ? (
                    <span className="muted">Plug a device and hit refresh.</span>
                  ) : (
                    Object.entries(ports).map(([port, label]) => (
                      <span key={port} style={{ marginRight: 8 }}>
                        {port} <span className="muted">{label ? `(${label})` : ""}</span>
                      </span>
                    ))
                  )}
                </div>
                <button className="btn btn-ghost" onClick={refreshAll} disabled={loading}>
                  Refresh
                </button>
                <button className="btn btn-primary" onClick={openWizard}>
                  Add robot
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => setConfirmBulkDelete(true)}
                  disabled={selectedIds.size === 0}
                  title="Delete selected robots and their calibration files"
                >
                  Delete selected
                </button>
              </div>
            </div>
            <div className="stack" style={{ minWidth: 180, alignItems: "flex-end" }}>
              {loading && <span className="muted">Working...</span>}
              {error && <span className="error">{error}</span>}
              {message && <span className="success">{message}</span>}
            </div>
          </div>
        </header>

        <section className="panel">
          <div className="row" style={{ marginBottom: 10 }}>
            <div className="row" style={{ gap: 8 }}>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={handleSelectAll}
                aria-label="Select all robots"
              />
              <strong>Robots</strong>
            </div>
            <div className="spacer" />
            <span className="muted">{robots.length} device(s)</span>
          </div>
          {robots.length === 0 ? (
            <div className="notice">No robots yet. Add a robot to map its COM port.</div>
          ) : (
            <div className="stack">
              {sortedRobots.map((robot) => (
                <div
                  key={robot.id}
                  className="list-row"
                  onClick={(event) => {
                    const target = event.target as HTMLElement;
                    if (target.tagName.toLowerCase() === "input") return;
                    router.push(`/robots/${robot.id}`);
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(robot.id)}
                    onChange={() => toggleSelect(robot.id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Select ${robot.name}`}
                  />
                  <div className="stack" style={{ gap: 4, minWidth: 180 }}>
                    <span style={{ fontWeight: 700 }}>{robot.name}</span>
                    <span className="muted">
                      {robot.model.toUpperCase()} - {robot.role}
                    </span>
                  </div>
                  <div className="tag" style={{ textTransform: "capitalize" }}>
                    {robot.role}
                  </div>
                  <div className={`tag ${robot.status}`} style={{ textTransform: "capitalize" }}>
                    {robot.status}
                  </div>
                  <span className="muted">COM {robot.com_port}</span>
                  <div className="spacer" />
                  <span className="muted" style={{ fontSize: 12 }}>
                    {formatLastSeen(robot.last_seen || null)}
                  </span>
                  <div
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 12,
                      border: "1px solid var(--border)",
                      display: "grid",
                      placeItems: "center",
                      background: "rgba(255,255,255,0.03)",
                      fontWeight: 700,
                    }}
                  >
                    {">"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

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
            <p className="muted">Identify the COM port, confirm the model and role, then name it.</p>
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
                <input
                  placeholder="Type a COM port manually (e.g. COM13)"
                  value={wizardForm.com_port}
                  onChange={(e) => setWizardForm({ ...wizardForm, com_port: e.target.value })}
                />
                <button className="btn btn-ghost" onClick={refreshAll}>
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
                  This name is also used for the calibration file in your lerobot cache.
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

      {confirmBulkDelete && (
        <div className="modal">
          <div className="panel" style={{ maxWidth: 420, width: "100%" }}>
            <h3>Delete selected robots?</h3>
            <p className="notice" style={{ marginTop: 6 }}>
              This will remove {selectedIds.size} robot(s) and their calibration files from your
              lerobot cache. You cannot undo this action.
            </p>
            <div className="divider" />
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => setConfirmBulkDelete(false)}>
                Cancel
              </button>
              <div className="spacer" />
              <button className="btn btn-danger" onClick={handleBulkDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
