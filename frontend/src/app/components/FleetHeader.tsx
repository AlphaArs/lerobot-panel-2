"use client";

import { Button, Panel, Spacer, Stack, Tag } from "@/app/ui";

type FleetHeaderProps = {
  selectedCount: number;
  onDeleteSelected: () => void;
  onAddRobot: () => void;
  loading?: boolean;
  error?: string | null;
  message?: string | null;
};

export function FleetHeader({
  selectedCount,
  onDeleteSelected,
  onAddRobot,
  loading = false,
  error = null,
  message = null,
}: FleetHeaderProps) {
  return (
    <Panel className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-4">
        <div className="space-y-2">
          <Tag>LeRobot control stack</Tag>
          <h1 className="text-2xl font-bold leading-tight">SO101 fleet manager</h1>
          <p className="max-w-3xl text-sm text-muted">
            Monitor every robot at a glance. Select rows to bulk delete and click a robot to inspect its
            calibration. Everything here updates live via WebSocket events.
          </p>
        </div>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
          <Button variant="warningOutline" onClick={onDeleteSelected} disabled={selectedCount === 0}>
            Delete selected
          </Button>
          <Button variant="primary" onClick={onAddRobot}>
            Add robot
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-start gap-4">
        <Stack className="flex-1">
          <p className="m-0 text-sm text-muted">
            Supports SO101 leader & follower arms. Teleoperation requires a calibrated pair. Use the calibration
            page to step through the guided setup.
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
          {!loading && !error && !message && <Spacer />}
        </Stack>
      </div>
    </Panel>
  );
}
