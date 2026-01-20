"use client";

import { Button, Notice, Panel, Spacer } from "@/app/ui";

type BulkDeleteModalProps = {
  open: boolean;
  selectedCount: number;
  onCancel: () => void;
  onConfirm: () => void;
};

export function BulkDeleteModal({ open, selectedCount, onCancel, onConfirm }: BulkDeleteModalProps) {
  if (!open) return null;

  return (
    <div className="modal">
      <Panel className="w-full max-w-lg space-y-4">
        <h3 className="text-lg font-semibold">Delete selected robots?</h3>
        <Notice className="text-sm">
          This will remove {selectedCount} robot(s) and their calibration files from your lerobot cache. You cannot
          undo this action.
        </Notice>
        <div className="h-px bg-border" />
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Spacer />
          <Button variant="danger" onClick={onConfirm}>
            Delete
          </Button>
        </div>
      </Panel>
    </div>
  );
}
