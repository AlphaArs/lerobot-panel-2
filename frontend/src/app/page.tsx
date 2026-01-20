"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Robot, createRobot, deleteRobot, fetchPorts, fetchRobots, robotsWsUrl } from "@/lib/api";
import { AddRobotWizard, WizardForm } from "./components/AddRobotWizard";
import { BulkDeleteModal } from "./components/BulkDeleteModal";
import { FleetHeader } from "./components/FleetHeader";
import { RobotList } from "./components/RobotList";

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

  return (
    <>
      <main className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-6 md:py-8">
        <FleetHeader
          selectedCount={selectedIds.size}
          onDeleteSelected={() => setConfirmBulkDelete(true)}
          onAddRobot={openWizard}
          loading={loading}
          error={error}
          message={message}
        />

        <RobotList
          robots={robots}
          selectedIds={selectedIds}
          allSelected={allSelected}
          onSelectAll={handleSelectAll}
          onToggleSelect={toggleSelect}
          onRobotClick={(id) => router.push(`/robots/${id}`)}
        />
      </main>

      <AddRobotWizard
        open={wizardOpen}
        wizardStep={wizardStep}
        wizardForm={wizardForm}
        ports={ports}
        onClose={() => setWizardOpen(false)}
        onBack={() => setWizardStep((s) => s - 1)}
        onNext={handleWizardNext}
        onChange={setWizardForm}
        onRefreshPorts={refreshAll}
      />

      <BulkDeleteModal
        open={confirmBulkDelete}
        selectedCount={selectedIds.size}
        onCancel={() => setConfirmBulkDelete(false)}
        onConfirm={handleBulkDelete}
      />
    </>
  );
}
