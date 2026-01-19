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
  cameraStreamUrl,
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
  container_id: "",
} as const;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  const [showAddCameraModal, setShowAddCameraModal] = useState(false);
  const [savingCamera, setSavingCamera] = useState(false);
  const [probingCamera, setProbingCamera] = useState(false);
  const [cameraValidation, setCameraValidation] = useState<string | null>(null);
  const [cameraStreamError, setCameraStreamError] = useState<string | null>(null);
  const [streamVersion, setStreamVersion] = useState(0);
  const [streamPaused, setStreamPaused] = useState(false);
  const [pausedFrameUrl, setPausedFrameUrl] = useState<string | null>(null);
  const [streamParams, setStreamParams] = useState<{ width?: number; height?: number; fps?: number } | null>(null);
  const [lastDisplaySrc, setLastDisplaySrc] = useState<string | null>(null);

  const resumeStream = useCallback(() => {
    setStreamPaused(false);
    setCameraStreamError(null);
    setStreamVersion((v) => v + 1);
    setPausedFrameUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);
  const [probeProgress, setProbeProgress] = useState(0);
  const probeResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const probeStepTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [presetsReady, setPresetsReady] = useState(false);
  const [showPresets, setShowPresets] = useState(false);

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

  const filteredCameraDevices = useMemo(() => {
    if (!robot) return cameraDevices;
    const matches = (dev: CameraDevice, cam: RobotCamera) =>
      dev.id === cam.device_id ||
      (!!cam.container_id && dev.container_id && dev.container_id === cam.container_id) ||
      (!!cam.serial_number && dev.serial_number === cam.serial_number) ||
      (!!cam.path && dev.path === cam.path);
    return cameraDevices.filter((dev) => !(robot.cameras || []).some((cam) => matches(dev, cam)));
  }, [cameraDevices, robot]);

  useEffect(() => {
    if (
      showAddCameraModal &&
      selectedCameraId &&
      !filteredCameraDevices.some((dev) => dev.id === selectedCameraId)
    ) {
      setCameraValidation("The selected camera was disconnected.");
      setSelectedCameraId("");
      setCameraProbe(null);
    }
  }, [filteredCameraDevices, selectedCameraId, showAddCameraModal]);

  useEffect(() => {
    if (showAddCameraModal) return;
    setCameraProbe(null);
    setSelectedCameraId("");
    setCameraForm(defaultCameraForm);
    setCameraValidation(null);
    clearProbeReset();
    setProbeProgress(0);
    setPresetsReady(false);
    setCameraStreamError(null);
    setStreamPaused(false);
    setStreamParams(null);
    setPausedFrameUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, [showAddCameraModal]);

  useEffect(() => {
    return () => {
      clearProbeReset();
      setPausedFrameUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, []);

  const formatLastSeen = (value?: string | null) => {
    if (!value) return "Never seen online";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "Last seen unknown";
    return `Seen ${parsed.toLocaleString()}`;
  };

  const commandsDisabled = robot?.status === "offline";
  const showCameraManagement = robot?.role !== "leader";

  const currentDevice = filteredCameraDevices.find((d) => d.id === selectedCameraId);
  const cameraIsOnline = (cam: RobotCamera) =>
    cameraDevices.some(
      (dev) =>
        dev.id === cam.device_id ||
        (!!cam.container_id && dev.container_id && dev.container_id === cam.container_id) ||
        (!!cam.serial_number && dev.serial_number === cam.serial_number) ||
        (!!cam.path && dev.path === cam.path)
    );
  const labelCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredCameraDevices.forEach((dev) => {
      const key = dev.label || dev.id;
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }, [filteredCameraDevices]);
  const numericWidth = Number(cameraForm.width) || 0;
  const numericHeight = Number(cameraForm.height) || 0;
  const numericFps = Number(cameraForm.fps) || 0;
  const resolutionOrder = useMemo(
    () => [
      { label: "480p", width: 640, height: 480 },
      { label: "720p", width: 1280, height: 720 },
      { label: "1080p", width: 1920, height: 1080 },
    ],
    []
  );
  const supportedModes = useMemo(() => {
    const seen = new Set<string>();
    const list: CameraProbe["modes"] = [];
    const orderIndex = (w: number, h: number) =>
      resolutionOrder.findIndex((r) => r.width === w && r.height === h);
    (cameraProbe?.modes || []).forEach((m) => {
      const roundedFps = Math.round(m.fps);
      const key = `${m.width}x${m.height}-${roundedFps}`;
      if (seen.has(key)) return;
      seen.add(key);
      list.push({ ...m, fps: roundedFps });
    });
    return list.sort((a, b) => {
      const ia = orderIndex(a.width, a.height);
      const ib = orderIndex(b.width, b.height);
      if (ia !== ib) return ia - ib;
      return b.fps - a.fps;
    });
  }, [cameraProbe, resolutionOrder]);
  const supportedGrouped = useMemo(
    () =>
      resolutionOrder.map((res) => ({
        ...res,
        fps: supportedModes
          .filter((m) => m.width === res.width && m.height === res.height)
          .map((m) => Math.round(m.fps))
          .filter((fps, idx, arr) => arr.indexOf(fps) === idx)
          .sort((a, b) => b - a),
      })),
    [resolutionOrder, supportedModes]
  );
  const isModeSupported =
    supportedModes.length === 0 ||
    supportedModes.some(
      (m) =>
        (!!numericWidth ? m.width === numericWidth : true) &&
        (!!numericHeight ? m.height === numericHeight : true) &&
        (!!numericFps ? Math.abs(m.fps - numericFps) <= 1.5 : true)
    );
  const suggestedMode = cameraProbe?.suggested || cameraProbe?.modes?.[0];
  const streamQuery = useMemo(() => {
    if (streamParams) return streamParams;
    if (suggestedMode) {
      return {
        width: suggestedMode.width,
        height: suggestedMode.height,
        fps: Math.round(suggestedMode.fps),
      };
    }
    return {};
  }, [streamParams, suggestedMode?.width, suggestedMode?.height, suggestedMode?.fps]);
  const cameraStreamSrc = useMemo(() => {
    if (!selectedCameraId || streamPaused) return null;
    const base = cameraStreamUrl(selectedCameraId, streamQuery);
    return streamVersion ? `${base}${base.includes("?") ? "&" : "?"}v=${streamVersion}` : base;
  }, [
    selectedCameraId,
    streamVersion,
    streamPaused,
    streamQuery,
  ]);
  const displayStreamSrc = useMemo(() => {
    if (pausedFrameUrl) return pausedFrameUrl;
    if (!streamPaused) return cameraStreamSrc || lastDisplaySrc;
    if (lastDisplaySrc && lastDisplaySrc.startsWith("blob:")) return lastDisplaySrc;
    return null;
  }, [pausedFrameUrl, cameraStreamSrc, lastDisplaySrc, streamPaused]);

  const capturePausedFrame = useCallback(async () => {
    if (!selectedCameraId) return false;
    try {
      const blob = await fetchCameraSnapshot(selectedCameraId, {
        width: streamQuery.width || numericWidth || undefined,
        height: streamQuery.height || numericHeight || undefined,
        fps: streamQuery.fps || numericFps || undefined,
      });
      const url = URL.createObjectURL(blob);
      setPausedFrameUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      setLastDisplaySrc(url);
      return true;
    } catch {
      return false;
    }
  }, [selectedCameraId, streamQuery.width, streamQuery.height, streamQuery.fps, numericWidth, numericHeight, numericFps]);

  useEffect(() => {
    setCameraStreamError(null);
  }, [cameraStreamSrc]);

  const clearProbeReset = () => {
    if (probeResetRef.current) {
      clearTimeout(probeResetRef.current);
      probeResetRef.current = null;
    }
  };

  const clearProbeSteps = () => {
    probeStepTimersRef.current.forEach((t) => clearTimeout(t));
    probeStepTimersRef.current = [];
  };

  const scheduleProbeSteps = (timeoutMs: number) => {
    clearProbeSteps();
    const targets = [35, 65, 85];
    const delay = Math.max(3000, Math.floor(timeoutMs / (targets.length + 2)));
    targets.forEach((value, idx) => {
      const timer = setTimeout(() => {
        setProbeProgress((prev) => Math.max(prev, value));
      }, delay * (idx + 1));
      probeStepTimersRef.current.push(timer);
    });
  };

  const openAddCameraFlow = () => {
    setCameraForm(defaultCameraForm);
    setCameraProbe(null);
    setCameraValidation(null);
    setPresetsReady(false);
    if (cameraDevices.length === 0) {
      void fetchCameras()
        .then((list) => setCameraDevices(list))
        .catch(() => null);
    }
    setCameraStreamError(null);
    setStreamPaused(false);
    setPausedFrameUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    clearProbeReset();
    clearProbeSteps();
    setProbeProgress(0);
    setShowPresets(false);
    const firstId = "";
    setSelectedCameraId(firstId);
    setShowAddCameraModal(true);
  };

  const handleSelectCamera = async (cameraId: string) => {
    setSelectedCameraId(cameraId);
    setCameraProbe(null);
    setCameraValidation(null);
    setPresetsReady(false);
    clearProbeReset();
    clearProbeSteps();
    setProbeProgress(0);
    setShowPresets(false);
    setCameraStreamError(null);
    setStreamParams(null);
    resumeStream();
    if (!cameraId) return;
    setCameraForm({
      name: "",
      width: "",
      height: "",
      fps: "",
      serial_number: "",
      path: "",
      container_id: "",
    });
  };

  const handleDetectCamera = async () => {
    if (!selectedCameraId) {
      setCameraValidation("Pick a camera first.");
      return;
    }
    clearProbeReset();
    clearProbeSteps();
    setPresetsReady(false);
    setProbeProgress(10);
    setProbingCamera(true);
    setCameraStreamError(null);
    setStreamPaused(true);
    setLastDisplaySrc((prev) => (prev && prev.startsWith("blob:") ? prev : null));
    setStreamVersion((v) => v + 1);
    await sleep(220);
    const grabbed = await capturePausedFrame();
    if (!grabbed) {
      // Try once more quickly if the first grab failed
      await sleep(160);
      await capturePausedFrame();
    }
    await sleep(100);
    scheduleProbeSteps(60_000);
    let probeSucceeded = false;
    let timedOut = false;
    const timeoutMs = 60_000;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      setCameraValidation("Detection timed out. Please try again. If it persists, unplug and replug the webcam.");
      setProbingCamera(false);
      setProbeProgress(0);
      clearProbeSteps();
      resumeStream();
    }, timeoutMs);
    try {
      let probe;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          probe = await probeCameraDevice(selectedCameraId);
          break;
        } catch (err) {
          if (timedOut || attempt === 1) throw err;
          await sleep(250);
        }
      }
      if (timedOut || !probe) {
        return;
      }
      if (timedOut) {
        return;
      }
      setCameraProbe(probe);
      setProbeProgress(50);
      probeSucceeded = true;
      const best = probe.suggested || probe.modes[0];
      if (best) {
        setStreamParams({
          width: best.width,
          height: best.height,
          fps: Math.round(best.fps),
        });
      }
      setCameraForm((form) => ({
        ...form,
        width: best?.width?.toString() || form.width,
        height: best?.height?.toString() || form.height,
        fps: best?.fps?.toString() || form.fps,
        serial_number: probe.device.serial_number || form.serial_number,
        path: probe.device.path || form.path,
        container_id: probe.device.container_id || form.container_id,
      }));
      if (best) {
        setProbeProgress(100);
        probeResetRef.current = setTimeout(() => setProbeProgress(0), 800);
        setCameraStreamError(null);
      }
      setCameraValidation(null);
    } catch (err) {
      setCameraValidation(toMessage(err));
      setProbeProgress(0);
    } finally {
      clearTimeout(timeoutHandle);
      clearProbeSteps();
      if (probeSucceeded) {
        setPresetsReady(true);
      }
      setProbingCamera(false);
      resumeStream();
    }
  };

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
        container_id: cameraForm.container_id || currentDevice?.container_id || null,
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

        {showCameraManagement && (
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
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {robot.cameras.map((cam) => {
                  const online = cameraIsOnline(cam);
                  return (
                    <div
                      key={cam.id}
                      className="list-row w-full max-w-sm items-start gap-3"
                    >
                      <div className="flex flex-1 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="font-semibold">{cam.name}</div>
                          <Tag className="capitalize">{cam.kind}</Tag>
                          <Tag className={`capitalize ${online ? "online" : "offline"}`}>
                            {online ? "online" : "offline"}
                          </Tag>
                        </div>
                        <span className="text-sm text-muted">
                          {cam.width}x{cam.height} @ {cam.fps} FPS
                        </span>
                      </div>
                      <Button variant="ghost" onClick={() => void handleRemoveCamera(cam.id)}>
                        Remove
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <Notice>No cameras saved yet. Add one to pin a stable device path or serial.</Notice>
            )}
          </Panel>
        )}

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
              Select a detected camera, confirm its resolution and FPS, and save it to this robot. We keep stable IDs in
              the background so it stays recognizable after reboots or re-plugging.
            </p>
            {cameraValidation && <span className="text-sm text-danger">{cameraValidation}</span>}
            <div className="grid gap-4 md:grid-cols-2">
              <Stack className="gap-3 w-full">
                <label>Detected cameras</label>
                <select value={selectedCameraId} onChange={(e) => void handleSelectCamera(e.target.value)}>
                  <option value="">Pick a camera</option>
                  {filteredCameraDevices.map((dev) => (
                    <option key={dev.id} value={dev.id}>
                      {dev.label}
                      {labelCounts[dev.label] > 1 ? ` - ${dev.id.slice(-6)}` : ""}
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
                {(probingCamera || probeProgress > 0) && (
                  <div className="h-2 w-full overflow-hidden rounded-full bg-border">
                    <div
                      className="h-full rounded-full bg-accent transition-all"
                      style={{ width: `${Math.min(100, probeProgress)}%` }}
                    />
                  </div>
                )}
                {selectedCameraId && (
                  <div className="space-y-3 w-full">
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
                    {!isModeSupported && (
                      <Notice className="text-sm text-danger">
                        This camera did not report support for that FPS/resolution.
                      </Notice>
                    )}
                  </div>
                )}
              </Stack>
              <div className="flex flex-col gap-3">
                <div className="min-h-[220px] rounded-soft border border-border bg-panel p-3">
                  {selectedCameraId ? (
                    <div className="relative h-48 w-full overflow-hidden rounded-xl bg-black/40">
                      {displayStreamSrc ? (
                        <img
                          src={displayStreamSrc}
                          alt="Camera stream"
                          className={`h-full w-full object-cover ${probingCamera ? "blur-sm brightness-90" : ""}`}
                          onLoad={(e) => {
                            setCameraStreamError(null);
                            setLastDisplaySrc(e.currentTarget.src);
                          }}
                          onError={() => setCameraStreamError("Unable to load live stream.")}
                        />
                      ) : (
                        <div className="grid h-full place-items-center text-sm text-muted">
                          {probingCamera ? "Pausing stream for detection..." : "Preparing stream..."}
                        </div>
                      )}
                      {probingCamera && (
                        <div className="absolute inset-0 grid place-items-center bg-black/60 backdrop-blur-sm px-3 text-center text-sm text-foreground">
                          <div className="flex items-center gap-3 rounded-lg bg-panel/80 px-3 py-2">
                            <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-accent" />
                            <div className="text-left leading-tight">
                              <div className="font-semibold text-foreground">Detecting camera specs...</div>
                              <div className="text-xs text-muted">Stream paused temporarily.</div>
                            </div>
                          </div>
                        </div>
                      )}
                      {cameraStreamError && (
                        <div className="absolute inset-0 grid place-items-center bg-panel/80 px-3 text-center text-sm text-danger">
                          {cameraStreamError}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="grid h-full place-items-center text-sm text-muted">
                      Select a camera to start streaming.
                    </div>
                  )}
                </div>
                {selectedCameraId && (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        resumeStream();
                        setPausedFrameUrl((prev) => {
                          if (prev) URL.revokeObjectURL(prev);
                          return null;
                        });
                      }}
                    >
                      Restart stream
                    </Button>
                    {streamPaused && <span className="text-muted">Stream paused during detection.</span>}
                    {cameraStreamError ? (
                      <span className="text-danger">{cameraStreamError}</span>
                    ) : (
                      <span className="text-muted">Live MJPEG stream</span>
                    )}
                  </div>
                )}
                <div className="rounded-xl border border-border bg-panel p-3 text-sm text-muted">
                  <div className="mb-2 text-xs font-semibold text-muted">Suggested mode</div>
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
              </div>
            </div>
            <div className="h-px bg-border" />
            {selectedCameraId && presetsReady && supportedGrouped.some((g) => g.fps.length > 0) && (
              <div className="w-full space-y-2">
                <button
                  className="flex w-full items-center justify-between rounded-lg border border-border bg-panel px-3 py-2 text-xs font-semibold text-muted"
                  type="button"
                  onClick={() => setShowPresets((v) => !v)}
                >
                  <span>Optional presets (advanced)</span>
                  <span>{showPresets ? "Hide" : "Show"}</span>
                </button>
                {showPresets && (
                  <div className="space-y-3 rounded-lg border border-border bg-panel/60 p-3 w-full">
                    <div className="text-[11px] uppercase tracking-wide text-muted w-full text-left">480p / 720p / 1080p</div>
                    <div className="text-xs text-muted">
                      This is optional. Use these only if you need exact resolution/FPS combos.
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      {supportedGrouped.map((group) => {
                        if (!group.fps.length) return null;
                        return (
                          <div key={`${group.label}-${group.width}x${group.height}`} className="flex flex-col gap-2 w-full">
                            <div className="text-xs font-semibold text-muted">
                              {group.label} ({group.width}x{group.height})
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              {group.fps.map((fps) => {
                                const active =
                                  (!!numericWidth ? group.width === numericWidth : false) &&
                                  (!!numericHeight ? group.height === numericHeight : false) &&
                                  (!!numericFps ? Math.abs(fps - numericFps) <= 1.5 : false);
                                return (
                                  <button
                                    key={`${group.label}-${fps}`}
                                    className={`rounded-xl border px-3 py-1 text-xs ${
                                      active ? "border-accent bg-accent/10" : "border-border bg-transparent text-muted"
                                    }`}
                                    onClick={() => {
                                      setCameraForm((form) => ({
                                        ...form,
                                        width: group.width.toString(),
                                        height: group.height.toString(),
                                        fps: fps.toString(),
                                      }));
                                      setCameraStreamError(null);
                                    }}
                                    type="button"
                                  >
                                    {fps} FPS
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
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
