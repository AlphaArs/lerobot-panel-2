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
  updateRobot,
} from "@/lib/api";
import { Button, Notice, Panel, Pill, Spacer, Stack, Tag } from "../../ui";

const toMessage = (err: unknown) => (err instanceof Error ? err.message : "Request failed");

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
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showDeleteCalibrationModal, setShowDeleteCalibrationModal] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [showTeleopModal, setShowTeleopModal] = useState(false);

  const loadData = useCallback(async () => {
    if (!robotId) return;
    setLoading(true);
    setError(null);
    try {
      const [detail, list] = await Promise.all([fetchRobot(robotId), fetchRobots()]);
      setRobot(detail);
      setFleet(list);
      if (!showRenameModal) {
        setNameInput(detail.name);
      }
      setSelectedFollower("");
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setLoading(false);
    }
  }, [robotId, showRenameModal]);

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
                if (!showRenameModal) {
                  setNameInput(updated.name);
                }
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
  }, [robotId, showRenameModal]);

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

  useEffect(() => {
    if (!robot || showRenameModal) return;
    setNameInput(robot.name);
  }, [robot, showRenameModal]);

  const formatLastSeen = (value?: string | null) => {
    if (!value) return "Never seen online";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "Last seen unknown";
    return `Seen ${parsed.toLocaleString()}`;
  };

  const commandsDisabled = robot?.status === "offline";

  const handleRename = async () => {
    if (!robot) return;
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === robot.name) {
      setNameInput(robot.name);
      setShowRenameModal(false);
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
      setShowRenameModal(false);
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

  const openTeleopFlow = () => {
    if (!robot) return;
    if (robot.role !== "leader") {
      setError("Teleoperation can only be started from a leader arm.");
      return;
    }
    setShowTeleopModal(true);
  };

  const startTeleopNavigation = () => {
    if (!robot) return;
    if (!selectedFollower) {
      setError("Pick a follower to teleoperate.");
      return;
    }
    router.push(`/teleop?leader=${robot.id}&follower=${selectedFollower}`);
  };

  return (
    <>
      <main className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-6 md:py-8">
        <Panel className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start gap-4">
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => router.push("/")}>
                {"< Back"}
              </Button>
              <Tag>Robot</Tag>
            </div>
            <Stack className="flex-1">
              <h1 className="text-2xl font-bold leading-tight">{robot?.name || "Loading robot..."}</h1>
              {robot && (
                <div className="flex flex-wrap items-center gap-2">
                  <Pill>{robot.model.toUpperCase()}</Pill>
                  <Pill className="capitalize">{robot.role}</Pill>
                  <Pill>COM {robot.com_port}</Pill>
                  {robot.has_calibration && <Tag>calibrated</Tag>}
                  {robot.status && (
                    <Tag
                      className={
                        robot.status === "online"
                          ? "border-success/40 text-success bg-success/10 capitalize"
                          : "border-muted/50 text-muted capitalize"
                      }
                    >
                      {robot.status}
                    </Tag>
                  )}
                </div>
              )}
              <p className="max-w-3xl text-sm text-muted">
                Inspect calibration status, start teleoperation, or remove this robot and its cached
                calibration files.
              </p>
              {robot && (
                <p className="m-0 text-sm text-muted">{formatLastSeen(robot.last_seen || null)}</p>
              )}
            </Stack>
            <Stack className="min-w-[180px] items-end text-sm">
              {loading && <span className="text-muted">Working...</span>}
              {error && <span className="text-danger">{error}</span>}
              {message && <span className="text-success">{message}</span>}
            </Stack>
          </div>
        </Panel>

        <div className="grid gap-4 md:grid-cols-2">
          <Panel className={commandsDisabled ? "opacity-60" : ""}>
            <div className="mb-2 flex items-center gap-3">
              <strong>Commands</strong>
              <Spacer />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!robot?.has_calibration && (
                <Button
                  variant="primary"
                  onClick={() => router.push(`/calibration?robot=${robotId}`)}
                  disabled={!robot || commandsDisabled}
                >
                  Calibrate
                </Button>
              )}
              <Button onClick={openTeleopFlow} disabled={!robot || commandsDisabled}>
                Teleoperate
              </Button>
            </div>
            <p className="mt-2 text-sm text-muted">
              Calibration opens in a dedicated flow. Teleoperation launches from here into its own guided page.
            </p>
          </Panel>

          <Panel className="border-danger/40">
            <div className="mb-2 flex items-center gap-3">
              <strong>Danger zone</strong>
              <Spacer />
              <Tag>Destructive</Tag>
            </div>
            <p className="mt-0 text-sm text-muted">
              These actions are optional. Delete the calibration if you need to reset it, or delete the robot entirely.
            </p>
            <div className="flex flex-col gap-2">
              <Button
                variant="warning"
                onClick={() => {
                  setNameInput(robot?.name || "");
                  setShowRenameModal(true);
                }}
                disabled={!robot}
              >
                Rename robot
              </Button>
              {robot?.has_calibration && (
                <Button variant="danger" onClick={() => setShowDeleteCalibrationModal(true)}>
                  Delete calibration
                </Button>
              )}
              <Button variant="danger" onClick={() => setShowDeleteModal(true)} disabled={!robot}>
                Delete robot
              </Button>
            </div>
          </Panel>
        </div>
      </main>

      {showDeleteModal && (
        <div className="modal">
          <Panel className="w-full max-w-lg space-y-4">
            <h3 className="text-lg font-semibold">Delete {robot?.name || "this robot"}?</h3>
            <Notice className="text-sm">
              This action removes the robot entry and its calibration file. You will need to recreate
              and recalibrate it to use it again.
            </Notice>
            <div className="h-px bg-border" />
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => setShowDeleteModal(false)}>
                Cancel
              </Button>
              <Spacer />
              <Button variant="danger" onClick={handleDelete} disabled={loading}>
                Delete
              </Button>
            </div>
          </Panel>
        </div>
      )}

      {showDeleteCalibrationModal && (
        <div className="modal">
          <Panel className="w-full max-w-lg space-y-4">
            <h3 className="text-lg font-semibold">Delete calibration?</h3>
            <Notice className="text-sm">
              Remove the calibration file for this robot. You can recalibrate later if needed.
            </Notice>
            <div className="h-px bg-border" />
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => setShowDeleteCalibrationModal(false)}>
                Cancel
              </Button>
              <Spacer />
              <Button variant="danger" onClick={handleDeleteCalibration} disabled={loading}>
                Delete calibration
              </Button>
            </div>
          </Panel>
        </div>
      )}

      {showRenameModal && (
        <div className="modal">
          <Panel className="w-full max-w-lg space-y-4">
            <h3 className="text-lg font-semibold">Rename robot</h3>
            <p className="text-sm text-muted">This also renames the calibration file on disk.</p>
            <Stack>
              <input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder={robot?.name || "Robot name"}
              />
            </Stack>
            <div className="h-px bg-border" />
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => setShowRenameModal(false)}>
                Cancel
              </Button>
              <Spacer />
              <Button variant="warning" onClick={handleRename} disabled={!robot || savingName}>
                Save
              </Button>
            </div>
          </Panel>
        </div>
      )}

      {showTeleopModal && (
        <div className="modal">
          <Panel className="w-full max-w-xl space-y-4">
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-semibold">Start teleoperation</h3>
              <Spacer />
              <Button variant="ghost" onClick={() => setShowTeleopModal(false)}>
                Close
              </Button>
            </div>
            <p className="text-sm text-muted">
              Choose a calibrated follower arm to control from this leader. Only followers are listed.
            </p>
            <Stack>
              <label>Follower</label>
              <select value={selectedFollower} onChange={(e) => setSelectedFollower(e.target.value)}>
                <option value="">Select follower</option>
                {followerOptions.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} {f.has_calibration ? "" : "(needs calibration)"}
                  </option>
                ))}
              </select>
            </Stack>
            <div className="h-px bg-border" />
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => setShowTeleopModal(false)}>
                Cancel
              </Button>
              <Spacer />
              <Button variant="primary" onClick={startTeleopNavigation} disabled={!selectedFollower}>
                Start teleop
              </Button>
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}
