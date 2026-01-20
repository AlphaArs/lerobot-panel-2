"use client";

import { useMemo } from "react";
import { Robot } from "@/lib/api";
import { Notice, Panel, Stack, Tag } from "@/app/ui";

type RobotListProps = {
  robots: Robot[];
  selectedIds: Set<string>;
  allSelected: boolean;
  onSelectAll: () => void;
  onToggleSelect: (id: string) => void;
  onRobotClick: (id: string) => void;
};

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

const formatLastSeen = (value?: string | null) => {
  if (!value) return "Never seen online yet";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Last seen unknown";
  return `Seen ${parsed.toLocaleString()}`;
};

type RobotRowProps = {
  robot: Robot;
  selected: boolean;
  onToggle: () => void;
  onClick: () => void;
};

function RobotRow({ robot, selected, onToggle, onClick }: RobotRowProps) {
  return (
    <div
      className="group flex cursor-pointer items-center gap-3 rounded-soft border border-border/40 bg-transparent px-4 py-3 transition hover:-translate-y-0.5 hover:border-accent/50 hover:bg-accent/10"
      onClick={onClick}
    >
      <input
        type="checkbox"
        className="size-4 accent-accent"
        checked={selected}
        onChange={onToggle}
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
  );
}

export function RobotList({
  robots,
  selectedIds,
  allSelected,
  onSelectAll,
  onToggleSelect,
  onRobotClick,
}: RobotListProps) {
  const sortedRobots = useMemo(() => [...robots].sort((a, b) => a.name.localeCompare(b.name)), [robots]);

  return (
    <Panel>
      <div className="mb-3 flex items-center gap-3">
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            className="size-4 accent-accent"
            checked={allSelected}
            onChange={onSelectAll}
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
            <RobotRow
              key={robot.id}
              robot={robot}
              selected={selectedIds.has(robot.id)}
              onToggle={() => onToggleSelect(robot.id)}
              onClick={() => onRobotClick(robot.id)}
            />
          ))}
        </Stack>
      )}
    </Panel>
  );
}
