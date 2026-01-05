"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  CameraDevice,
  CameraProbe,
  Robot,
  RobotCamera,
  addRobotCamera,
  deleteRobot,
  deleteCalibration,
  deleteRobotCamera,
  fetchCameraSnapshot,
  fetchCameras,
  fetchRobot,
  fetchRobots,
  probeCameraDevice,
  robotsWsUrl,
  camerasWsUrl,
  updateRobot,
} from "@/lib/api";
import { Button, Notice, Panel, Pill, Spacer, Stack, Tag } from "../../ui";

const toMessage = (err: unknown) => (err instanceof Error ? err.message : "Request failed");

const defaultCameraForm = {
  name: "",
  width: "",
  height: "",
  fps: "",
  serial_number: "",
  path: "",
} as const;

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
  const [selectedTeleopPartner, setSelectedTeleopPartner] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showDeleteCalibrationModal, setShowDeleteCalibrationModal] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [showTeleopModal, setShowTeleopModal] = useState(false);
  const [cameraDevices, setCameraDevices] = useState<CameraDevice[]>([]);
  const [cameraProbe, setCameraProbe] = useState<CameraProbe | null>(null);
  const [selectedCameraId, setSelectedCameraId] = useState("");
  const [cameraForm, setCameraForm] = useState(defaultCameraForm);
  const [cameraPreviewUrl, setCameraPreviewUrl] = useState<string | null>(null);
  const [cameraPreviewLoading, setCameraPreviewLoading] = useState(false);
  const [showAddCameraModal, setShowAddCameraModal] = useState(false);
  const [savingCamera, setSavingCamera] = useState(false);
  const [probingCamera, setProbingCamera] = useState(false);
  const [cameraValidation, setCameraValidation] = useState<string | null>(null);
  const [autoPreview, setAutoPreview] = useState(false);
  const [previewFailures, setPreviewFailures] = useState(0);
  const previewTokenRef = useRef(0);

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
      setSelectedTeleopPartner("");
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

  useEffect(() => {
    let socket: WebSocket | null = null;
    let stopped = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const loadOnce = async () => {
      try {
        const list = await fetchCameras();
        if (!stopped) {
          setCameraDevices(list);
        }
      } catch {
        // ignore failures; the websocket will keep us updated
      }
    };

    void loadOnce();

    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(camerasWsUrl);
      socket.onmessage = (event) => {
        if (stopped) return;
        try {
          const payload = JSON.parse(event.data);
          if (payload?.type === "camera_devices" && Array.isArray(payload.devices)) {
            setCameraDevices(payload.devices);
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

  const followerOptions = useMemo(
    () =>
      fleet.filter((r) => r.role === "follower" && r.model === robot?.model && r.id !== robot?.id),
    [fleet, robot]
  );

  const leaderOptions = useMemo(
    () =>
      fleet.filter((r) => r.role === "leader" && r.model === robot?.model && r.id !== robot?.id),
    [fleet, robot]
  );

  useEffect(() => {
    if (!robot) return;
    const options = robot.role === "leader" ? followerOptions : leaderOptions;
    if (!selectedTeleopPartner && options.length > 0) {
      setSelectedTeleopPartner(options[0].id);
    }
  }, [selectedTeleopPartner, followerOptions, leaderOptions, robot]);

  useEffect(() => {
    if (!robot || showRenameModal) return;
    setNameInput(robot.name);
  }, [robot, showRenameModal]);

  useEffect(() => {
    if (
      showAddCameraModal &&
      selectedCameraId &&
      !cameraDevices.some((dev) => dev.id === selectedCameraId)
    ) {
      setCameraValidation("The selected camera was disconnected.");
      setSelectedCameraId("");
      setCameraProbe(null);
    }
  }, [cameraDevices, selectedCameraId, showAddCameraModal]);

  useEffect(() => {
    return () => {
      if (cameraPreviewUrl) {
        URL.revokeObjectURL(cameraPreviewUrl);
      }
    };
  }, [cameraPreviewUrl]);

  useEffect(() => {
    if (showAddCameraModal) return;
    setCameraProbe(null);
    setSelectedCameraId("");
    setCameraForm(defaultCameraForm);
    setCameraValidation(null);
    if (cameraPreviewUrl) {
      URL.revokeObjectURL(cameraPreviewUrl);
      setCameraPreviewUrl(null);
    }
  }, [showAddCameraModal, cameraPreviewUrl]);

  const formatLastSeen = (value?: string | null) => {
    if (!value) return "Never seen online";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "Last seen unknown";
    return `Seen ${parsed.toLocaleString()}`;
  };

  const commandsDisabled = robot?.status === "offline";

  const currentDevice = cameraDevices.find((d) => d.id === selectedCameraId);
  const cameraIsOnline = (cam: RobotCamera) =>
    cameraDevices.some(
      (dev) =>
        dev.id === cam.device_id ||
        (!!cam.serial_number && dev.serial_number === cam.serial_number) ||
        (!!cam.path && dev.path === cam.path)
    );
  const labelCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    cameraDevices.forEach((dev) => {
      const key = dev.label || dev.id;
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }, [cameraDevices]);
  const numericWidth = Number(cameraForm.width) || 0;
  const numericHeight = Number(cameraForm.height) || 0;
  const numericFps = Number(cameraForm.fps) || 0;
  const supportedModes = useMemo(() => {
    const unique: CameraProbe["modes"] = [];
    const seen = new Set<string>();
    (cameraProbe?.modes || []).forEach((m) => {
      const key = `${m.width}x${m.height}-${Math.round(m.fps * 100)}`;
      if (seen.has(key)) return;
      seen.add(key);
      unique.push(m);
    });
    return unique;
  }, [cameraProbe]);
  const isModeSupported =
    supportedModes.length === 0 ||
    supportedModes.some(
      (m) =>
        (!!numericWidth ? m.width === numericWidth : true) &&
        (!!numericHeight ? m.height === numericHeight : true) &&
        (!!numericFps ? Math.abs(m.fps - numericFps) <= 1.5 : true)
    );
  const suggestedMode = cameraProbe?.suggested || cameraProbe?.modes?.[0];

  const openAddCameraFlow = () => {
    setCameraForm(defaultCameraForm);
    setCameraProbe(null);
    setCameraValidation(null);
    setAutoPreview(false);
    if (cameraDevices.length === 0) {
      void fetchCameras()
        .then((list) => setCameraDevices(list))
        .catch(() => null);
    }
    if (cameraPreviewUrl) {
      URL.revokeObjectURL(cameraPreviewUrl);
      setCameraPreviewUrl(null);
    }
    const firstId = "";
    setSelectedCameraId(firstId);
    setShowAddCameraModal(true);
  };

  const handleSelectCamera = async (cameraId: string) => {
    const prevSelected = selectedCameraId;
    previewTokenRef.current += 1;
    setSelectedCameraId(cameraId);
    setCameraProbe(null);
    setCameraValidation(null);
    setCameraPreviewUrl(null);
    setAutoPreview(false);
    if (cameraPreviewUrl) {
      URL.revokeObjectURL(cameraPreviewUrl);
    }
    if (!cameraId) return;
    setCameraForm({
      name: "",
      width: "",
      height: "",
      fps: "",
      serial_number: "",
      path: "",
    });
    void refreshPreview(cameraId, undefined, { fastOnly: true, force: true }, previewTokenRef.current);
  };

  const handleDetectCamera = async () => {
    if (!selectedCameraId) {
      setCameraValidation("Pick a camera first.");
      return;
    }
    const prevSelected = selectedCameraId;
    setProbingCamera(true);
    try {
      const probe = await probeCameraDevice(selectedCameraId);
      setCameraProbe(probe);
      const best = probe.suggested || probe.modes[0];
      setCameraForm((form) => {
        const isNewDevice = selectedCameraId !== prevSelected || !form.name;
        return {
          ...form,
          name: isNewDevice ? probe.device.label || form.name : form.name,
          width: best?.width?.toString() || form.width,
          height: best?.height?.toString() || form.height,
          fps: best?.fps?.toString() || form.fps,
          serial_number: probe.device.serial_number || form.serial_number,
          path: probe.device.path || form.path,
        };
      });
      if (best) {
        void refreshPreview(selectedCameraId, best, { fastOnly: true, force: true }, previewTokenRef.current);
      }
      setAutoPreview(false);
      setCameraValidation(null);
    } catch (err) {
      setCameraValidation(toMessage(err));
    } finally {
      setProbingCamera(false);
    }
  };

  const refreshPreview = useCallback(
    async (
      deviceId?: string,
      modeOverride?: { width?: number; height?: number; fps?: number },
      options?: { fastOnly?: boolean; force?: boolean },
      token?: number
    ) => {
      const activeToken = token ?? previewTokenRef.current;
      const target = deviceId || selectedCameraId;
      if (!target) return false;
      if (cameraPreviewLoading && !options?.force) return null;
      setCameraPreviewLoading(true);
      try {
        const attempt = async (opts?: { width?: number; height?: number; fps?: number }) => {
          const blob = await fetchCameraSnapshot(target, opts || {});
          const url = URL.createObjectURL(blob);
          if (activeToken === previewTokenRef.current) {
            setCameraPreviewUrl((prev) => {
              if (prev) URL.revokeObjectURL(prev);
              return url;
            });
          } else {
            URL.revokeObjectURL(url);
          }
        };

        const baseWidth = (modeOverride?.width ?? numericWidth) || 640;
        const baseHeight = (modeOverride?.height ?? numericHeight) || 480;
        const baseFps = (modeOverride?.fps ?? numericFps) || 30;
        const quickMode = {
          width: Math.max(160, Math.min(baseWidth, 640)),
          height: Math.max(120, Math.min(baseHeight, 480)),
          fps: Math.max(5, Math.min(baseFps, 15)),
        };

        // Quick preview first
        await attempt(quickMode);
        setPreviewFailures(0);
        if (options?.fastOnly) {
          return true;
        }

        const targetMode = {
          width: modeOverride?.width ?? cameraForm.width,
          height: modeOverride?.height ?? cameraForm.height,
          fps: modeOverride?.fps ?? cameraForm.fps,
        };

        // If the target matches quick, skip the second fetch
        const sameAsQuick =
          (!!targetMode.width && targetMode.width <= quickMode.width) &&
          (!!targetMode.height && targetMode.height <= quickMode.height) &&
          (!!targetMode.fps && targetMode.fps <= quickMode.fps + 0.1);

        if (!sameAsQuick && (targetMode.width || targetMode.height || targetMode.fps)) {
          try {
            await attempt(targetMode);
          } catch {
            // Ignore target failures; keep the quick frame
          }
        }
        return true;
      } catch {
        setPreviewFailures((n) => n + 1);
        return false;
      } finally {
        setCameraPreviewLoading(false);
      }
    },
    [cameraForm.height, cameraForm.width, cameraForm.fps, cameraPreviewLoading, selectedCameraId]
  );

  useEffect(() => {
    if (!showAddCameraModal || !selectedCameraId || !autoPreview) return;
    let stopped = false;

    const tick = async () => {
      if (stopped) return;
      const ok = await refreshPreview(undefined, undefined, { fastOnly: true }, previewTokenRef.current);
      if (ok === false && !stopped) {
        setAutoPreview(false);
      }
    };

    // Initial quick preview
    void tick();
    const timer = setInterval(() => {
      void tick();
    }, 1500);

    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [showAddCameraModal, selectedCameraId, autoPreview, refreshPreview]);

  const handleSaveCamera = async () => {
    if (!robot) return;
    if (!selectedCameraId) {
      setCameraValidation("Select a detected camera first.");
      return;
    }
    if (!cameraForm.name.trim()) {
      setCameraValidation("Give this camera a name.");
      return;
    }
    if (!numericWidth || !numericHeight || !numericFps) {
      setCameraValidation("Fill width, height, and FPS before saving.");
      return;
    }
    if (!isModeSupported) {
      setCameraValidation("Pick a resolution and FPS supported by this camera.");
      return;
    }
    setSavingCamera(true);
    setError(null);
    try {
      const updated = await addRobotCamera(robot.id, {
        device_id: selectedCameraId,
        name: cameraForm.name.trim(),
        width: numericWidth,
        height: numericHeight,
        fps: numericFps,
        serial_number: cameraForm.serial_number || undefined,
        path: cameraForm.path || undefined,
        kind: currentDevice?.kind,
        index: currentDevice?.index ?? null,
      });
      setRobot(updated);
      setFleet((list) => list.map((r) => (r.id === updated.id ? updated : r)));
      setShowAddCameraModal(false);
      setMessage("Camera saved to this robot.");
    } catch (err) {
      setError(toMessage(err));
      setCameraValidation(toMessage(err));
    } finally {
      setSavingCamera(false);
    }
  };

  const handleRemoveCamera = async (cameraId: string) => {
    if (!robot) return;
    setLoading(true);
    setError(null);
    try {
      const updated = await deleteRobotCamera(robot.id, cameraId);
      setRobot(updated);
      setFleet((list) => list.map((r) => (r.id === updated.id ? updated : r)));
      setMessage("Camera removed.");
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setLoading(false);
    }
  };

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
    if (robot.role !== "leader" && robot.role !== "follower") {
      setError("Unsupported robot role for teleoperation.");
      return;
    }
    setShowTeleopModal(true);
  };

  const startTeleopNavigation = () => {
    if (!robot) return;
    if (!selectedTeleopPartner) {
      setError(robot.role === "leader" ? "Pick a follower to teleoperate." : "Pick a leader to control from.");
      return;
    }

    const leaderId = robot.role === "leader" ? robot.id : selectedTeleopPartner;
    const followerId = robot.role === "leader" ? selectedTeleopPartner : robot.id;
    router.push(`/teleop?leader=${leaderId}&follower=${followerId}`);
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

        <Panel className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <strong>Cameras</strong>
            <Tag className="online">Live devices</Tag>
            <Spacer />
            <Button variant="primary" onClick={openAddCameraFlow}>
              Add camera
            </Button>
          </div>
          {robot?.cameras?.length ? (
            <div className="flex flex-col gap-2">
              {robot.cameras.map((cam) => {
                const online = cameraIsOnline(cam);
                return (
                  <div
                    key={cam.id}
                    className="list-row items-center gap-3"
                  >
                    <div className="min-w-[180px] space-y-1">
                      <div className="font-semibold">{cam.name}</div>
                      <div className="text-xs text-muted break-all">{cam.device_id}</div>
                    </div>
                    <Tag className={`capitalize ${online ? "online" : "offline"}`}>{online ? "online" : "offline"}</Tag>
                    <Tag className="capitalize">{cam.kind}</Tag>
                    <span className="text-sm text-muted">
                      {cam.width}x{cam.height} @ {cam.fps} FPS
                    </span>
                    {cam.serial_number && <Tag>SN {cam.serial_number}</Tag>}
                    <Spacer />
                    <Button variant="ghost" onClick={() => void handleRemoveCamera(cam.id)}>
                      Remove
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : (
            <Notice>No cameras saved yet. Add one to pin a device path or serial.</Notice>
          )}
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

      {showAddCameraModal && (
        <div className="modal">
          <Panel className="w-full max-w-4xl space-y-4">
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-semibold">Add a camera</h3>
              <Spacer />
              <Button variant="ghost" onClick={() => setShowAddCameraModal(false)}>
                Close
              </Button>
            </div>
            <p className="text-sm text-muted">
              Select a detected camera, confirm its resolution and FPS, and save it to this robot. We keep the device
              path or serial number so it stays recognizable after re-plugging.
            </p>
            {cameraValidation && <span className="text-sm text-danger">{cameraValidation}</span>}
            <div className="grid gap-4 md:grid-cols-2">
              <Stack>
                <label>Detected cameras</label>
                <select value={selectedCameraId} onChange={(e) => void handleSelectCamera(e.target.value)}>
                  <option value="">Pick a camera</option>
                  {cameraDevices.map((dev) => (
                    <option key={dev.id} value={dev.id}>
                      {dev.label}
                      {labelCounts[dev.label] > 1 ? ` • ${dev.id.slice(-6)}` : ""}
                      {dev.serial_number ? ` (SN ${dev.serial_number})` : ""}
                      {" "}
                      [{dev.kind}]
                    </option>
                  ))}
                </select>
                <Stack>
                  <label>Camera name</label>
                  <input
                    value={cameraForm.name}
                    onChange={(e) => setCameraForm((form) => ({ ...form, name: e.target.value }))}
                    placeholder="Front camera"
                  />
                </Stack>
                {currentDevice?.serial_number && (
                  <Stack>
                    <label>Serial number</label>
                    <input value={currentDevice.serial_number} readOnly />
                  </Stack>
                )}
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      void fetchCameras()
                        .then((list) => setCameraDevices(list))
                        .catch(() => null);
                    }}
                  >
                    Refresh list
                  </Button>
                  <Button variant="primary" onClick={() => void handleDetectCamera()} disabled={!selectedCameraId || probingCamera}>
                    {probingCamera ? "Detecting..." : "Detect & fill"}
                  </Button>
                  {probingCamera && <span className="text-sm text-muted">Probing camera...</span>}
                </div>
              </Stack>
              <div className="flex flex-col gap-2">
                <div className="min-h-[220px] rounded-soft border border-border bg-panel p-3">
                  {cameraPreviewUrl ? (
                    <img src={cameraPreviewUrl} alt="Camera preview" className="h-48 w-full rounded-xl object-cover" />
                  ) : (
                    <div className="grid h-full place-items-center text-sm text-muted">
                      {selectedCameraId
                        ? cameraPreviewLoading
                          ? "Preview loading..."
                          : "Preview"
                        : "Select a camera to preview it."}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => void refreshPreview()}
                    disabled={!selectedCameraId || cameraPreviewLoading}
                  >
                    {cameraPreviewLoading ? "Loading preview..." : "Refresh preview"}
                  </Button>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted">
                  <input
                    id="auto-preview"
                    type="checkbox"
                    className="size-4 accent-accent"
                    checked={autoPreview}
                    onChange={(e) => {
                      setPreviewFailures(0);
                      setAutoPreview(e.target.checked);
                    }}
                  />
                  <label htmlFor="auto-preview" className="cursor-pointer select-none">
                    Live preview (updates every ~1.5s)
                  </label>
                  {previewFailures >= 3 && (
                    <span className="text-danger">Preview paused after repeated errors. Click refresh.</span>
                  )}
                </div>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Stack>
                <label>Resolution</label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    value={cameraForm.width}
                    min={1}
                    onChange={(e) => setCameraForm((form) => ({ ...form, width: e.target.value }))}
                    placeholder="Width"
                  />
                  <input
                    type="number"
                    value={cameraForm.height}
                    min={1}
                    onChange={(e) => setCameraForm((form) => ({ ...form, height: e.target.value }))}
                    placeholder="Height"
                  />
                </div>
                <label>FPS</label>
                <input
                  type="number"
                  value={cameraForm.fps}
                  min={1}
                  onChange={(e) => setCameraForm((form) => ({ ...form, fps: e.target.value }))}
                  placeholder="FPS"
                />
                {supportedModes.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    {supportedModes.slice(0, 6).map((mode, idx) => {
                      const active =
                        (!!numericWidth ? mode.width === numericWidth : false) &&
                        (!!numericHeight ? mode.height === numericHeight : false) &&
                        (!!numericFps ? Math.abs(mode.fps - numericFps) <= 1.5 : false);
                      return (
                        <button
                          key={`${mode.width}x${mode.height}-${Math.round(mode.fps * 100)}-${idx}`}
                          className={`rounded-xl border px-3 py-1 text-xs ${
                            active ? "border-accent bg-accent/10" : "border-border bg-transparent text-muted"
                          }`}
                          onClick={() => {
                            setCameraForm((form) => ({
                              ...form,
                              width: mode.width.toString(),
                              height: mode.height.toString(),
                              fps: mode.fps.toString(),
                            }));
                            void refreshPreview(selectedCameraId, mode);
                          }}
                          type="button"
                        >
                          {mode.width}x{mode.height} @ {Math.round(mode.fps)} FPS
                        </button>
                      );
                    })}
                  </div>
                )}
                {!isModeSupported && (
                  <Notice className="text-sm text-danger">
                    This camera did not report support for that FPS/resolution.
                  </Notice>
                )}
              </Stack>
              <Stack>
                <label>Suggested mode</label>
                <div className="rounded-xl border border-border bg-panel p-3 text-sm text-muted">
                  {suggestedMode ? (
                    <div className="space-y-1 text-foreground">
                      <div>
                        {suggestedMode.width}x{suggestedMode.height} @ {Math.round(suggestedMode.fps)} FPS
                      </div>
                      {currentDevice?.label && <div className="text-muted">Device: {currentDevice.label}</div>}
                      {currentDevice?.serial_number && <div>SN: {currentDevice.serial_number}</div>}
                    </div>
                  ) : (
                    <div>No suggested mode reported. Pick values manually.</div>
                  )}
                </div>
              </Stack>
            </div>
            <div className="h-px bg-border" />
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => setShowAddCameraModal(false)}>
                Cancel
              </Button>
              <Spacer />
              <Button variant="primary" onClick={handleSaveCamera} disabled={savingCamera || !selectedCameraId}>
                {savingCamera ? "Saving..." : "Save camera"}
              </Button>
            </div>
          </Panel>
        </div>
      )}

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
              {robot?.role === "follower"
                ? "Choose a calibrated leader arm to control this follower from. Only leaders are listed."
                : "Choose a calibrated follower arm to control from this leader. Only followers are listed."}
            </p>
            <Stack>
              <label>{robot?.role === "follower" ? "Leader" : "Follower"}</label>
              <select
                value={selectedTeleopPartner}
                onChange={(e) => setSelectedTeleopPartner(e.target.value)}
              >
                <option value="">{robot?.role === "follower" ? "Select leader" : "Select follower"}</option>
                {(robot?.role === "follower" ? leaderOptions : followerOptions).map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name} {candidate.has_calibration ? "" : "(needs calibration)"}
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
              <Button variant="primary" onClick={startTeleopNavigation} disabled={!selectedTeleopPartner}>
                Start teleop
              </Button>
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}
