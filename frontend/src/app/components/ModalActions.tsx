"use client";

import { Button, Spacer } from "@/app/ui";

type ModalActionsProps = {
  onCancel: () => void;
  onConfirm: () => void;
  cancelLabel?: string;
  confirmLabel: string;
  confirmVariant?: Parameters<typeof Button>[0]["variant"];
  confirmDisabled?: boolean;
};

export function ModalActions({
  onCancel,
  onConfirm,
  cancelLabel = "Cancel",
  confirmLabel,
  confirmVariant = "primary",
  confirmDisabled = false,
}: ModalActionsProps) {
  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" onClick={onCancel}>
        {cancelLabel}
      </Button>
      <Spacer />
      <Button variant={confirmVariant} onClick={onConfirm} disabled={confirmDisabled}>
        {confirmLabel}
      </Button>
    </div>
  );
}
