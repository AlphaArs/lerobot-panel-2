"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Robot, createRobot, deleteRobot, fetchPorts, fetchRobots, robotsWsUrl } from "@/lib/api";
import { Button, Notice, Panel, Spacer, Stack, Tag } from "./ui";

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

  const statusTone = (status: Robot["status"]) => {
    switch (status) {
      case "online":
        return "border-success/40 text-success bg-success/10";
      case "offline":
        return "border-muted/50 text-muted";
      default:
        return "border-accent/40 text-accent";
    }
  };

  return (
    <>
      <main className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-6 md:py-8">
        <Panel className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start gap-4">
            <div className="space-y-2">
              <Tag>LeRobot control stack</Tag>
              <h1 className="text-2xl font-bold leading-tight">SO101 fleet manager</h1>
              <p className="max-w-3xl text-sm text-muted">
                Monitor every robot at a glance. Select rows to bulk delete and click a robot to
                inspect its calibration. Everything here updates live via WebSocket events.
              </p>
            </div>
            <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
              <Button variant="warningOutline" onClick={() => setConfirmBulkDelete(true)} disabled={selectedIds.size === 0}>
                Delete selected
              </Button>
              <Button variant="primary" onClick={openWizard}>
                Add robot
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-start gap-4">
            <Stack className="flex-1">
              <p className="m-0 text-sm text-muted">
                Supports SO101 leader & follower arms. Teleoperation requires a calibrated pair. Use
                the calibration page to step through the guided setup.
              </p>
              <div className="flex flex-wrap gap-2">
                <Tag>Live fleet updates</Tag>
                <Tag>Bulk delete with confirmation</Tag>
                <Tag>Modal wizard for adding devices</Tag>
              </div>
            </Stack>
            <Stack className="items-end text-sm">
              {loading && <span className="text-muted">Working...</span>}
              {error && <span className="text-danger">{error}</span>}
              {message && <span className="text-success">{message}</span>}
            </Stack>
          </div>
        </Panel>

        <Panel>
          <div className="mb-3 flex items-center gap-3">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                className="size-4 accent-accent"
                checked={allSelected}
                onChange={handleSelectAll}
                aria-label="Select all robots"
              />
              <strong className="text-base">Robots</strong>
            </div>
            <div className="ml-auto text-sm text-muted">{robots.length} device(s)</div>
          </div>
          {robots.length === 0 ? (
            <Notice>No robots yet. Add a robot to map its COM port.</Notice>
          ) : (
            <Stack>
              {sortedRobots.map((robot) => (
                <div
                  key={robot.id}
                  className="group flex cursor-pointer items-center gap-3 rounded-soft border border-border/40 bg-transparent px-4 py-3 transition hover:-translate-y-0.5 hover:border-accent/50 hover:bg-accent/10"
                  onClick={(event) => {
                    const target = event.target as HTMLElement;
                    if (target.tagName.toLowerCase() === "input") return;
                    router.push(`/robots/${robot.id}`);
                  }}
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-accent"
                    checked={selectedIds.has(robot.id)}
                    onChange={() => toggleSelect(robot.id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Select ${robot.name}`}
                  />
                  <div className="min-w-[180px] space-y-1">
                    <span className="font-semibold">{robot.name}</span>
                    <span className="text-xs text-muted">
                      {robot.model.toUpperCase()} - {robot.role}
                    </span>
                  </div>
                  <Tag className="capitalize">{robot.role}</Tag>
                  <Tag className={`${statusTone(robot.status)} capitalize`}>{robot.status}</Tag>
                  <span className="text-sm text-muted">COM {robot.com_port}</span>
                  <div className="ml-auto flex items-center gap-3">
                    <span className="text-[12px] text-muted">{formatLastSeen(robot.last_seen || null)}</span>
                    <div className="grid h-9 w-9 place-items-center rounded-xl border border-border/30 bg-white/5 text-lg font-bold text-muted transition group-hover:text-foreground group-hover:bg-accent/10">
                      &gt;
                    </div>
                  </div>
                </div>
              ))}
            </Stack>
          )}
        </Panel>
      </main>

      {wizardOpen && (
        <div className="modal">
          <Panel className="w-full max-w-xl space-y-4">
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-semibold">Add a robot</h3>
              <Spacer />
              <Button variant="ghost" onClick={() => setWizardOpen(false)}>
                Close
              </Button>
            </div>
            <p className="text-sm text-muted">
              Identify the COM port, confirm the model and role, then name it.
            </p>
            <div className="h-px bg-border" />
            {wizardStep === 1 && (
              <Stack>
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
                <Button variant="ghost" onClick={refreshAll}>
                  Refresh COM list
                </Button>
              </Stack>
            )}

            {wizardStep === 2 && (
              <Stack>
                <label>Model</label>
                <select
                  value={wizardForm.model}
                  onChange={(e) => setWizardForm({ ...wizardForm, model: e.target.value as "so101" })}
                >
                  <option value="so101">SO101</option>
                </select>
                <label>Role</label>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant={wizardForm.role === "leader" ? "primary" : "default"}
                    onClick={() => setWizardForm({ ...wizardForm, role: "leader" })}
                  >
                    Leader arm
                  </Button>
                  <Button
                    variant={wizardForm.role === "follower" ? "primary" : "default"}
                    onClick={() => setWizardForm({ ...wizardForm, role: "follower" })}
                  >
                    Follower arm
                  </Button>
                </div>
              </Stack>
            )}

            {wizardStep === 3 && (
              <Stack>
                <label>Name</label>
                <input
                  placeholder="Friendly name (e.g. Lab Leader)"
                  value={wizardForm.name}
                  onChange={(e) => setWizardForm({ ...wizardForm, name: e.target.value })}
                />
                <p className="text-sm text-muted">
                  This name is also used for the calibration file in your lerobot cache.
                </p>
              </Stack>
            )}

            <div className="h-px bg-border" />
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted">Step {wizardStep} of 3</span>
              <Spacer />
              {wizardStep > 1 && (
                <Button onClick={() => setWizardStep((s) => s - 1)}>
                  Back
                </Button>
              )}
              <Button variant="primary" onClick={handleWizardNext}>
                {wizardStep === 3 ? "Finish" : "Next"}
              </Button>
            </div>
          </Panel>
        </div>
      )}

      {confirmBulkDelete && (
        <div className="modal">
          <Panel className="w-full max-w-lg space-y-4">
            <h3 className="text-lg font-semibold">Delete selected robots?</h3>
            <Notice className="text-sm">
              This will remove {selectedIds.size} robot(s) and their calibration files from your
              lerobot cache. You cannot undo this action.
            </Notice>
            <div className="h-px bg-border" />
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => setConfirmBulkDelete(false)}>
                Cancel
              </Button>
              <Spacer />
              <Button variant="danger" onClick={handleBulkDelete}>
                Delete
              </Button>
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}
