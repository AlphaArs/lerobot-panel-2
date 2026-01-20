"use client";

import { Button, Panel, Spacer, Stack } from "@/app/ui";

export type WizardForm = {
  com_port: string;
  model: "so101";
  role: "leader" | "follower";
  name: string;
};

type AddRobotWizardProps = {
  open: boolean;
  wizardStep: number;
  wizardForm: WizardForm;
  ports: Record<string, string>;
  onClose: () => void;
  onBack: () => void;
  onNext: () => void;
  onChange: (form: WizardForm) => void;
  onRefreshPorts: () => void;
};

export function AddRobotWizard({
  open,
  wizardStep,
  wizardForm,
  ports,
  onClose,
  onBack,
  onNext,
  onChange,
  onRefreshPorts,
}: AddRobotWizardProps) {
  if (!open) return null;

  const updateForm = (changes: Partial<WizardForm>) => onChange({ ...wizardForm, ...changes });

  return (
    <div className="modal">
      <Panel className="w-full max-w-xl space-y-4">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold">Add a robot</h3>
          <Spacer />
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        <p className="text-sm text-muted">Identify the COM port, confirm the model and role, then name it.</p>
        <div className="h-px bg-border" />

        {wizardStep === 1 && (
          <Stack>
            <label>COM port</label>
            <select value={wizardForm.com_port} onChange={(e) => updateForm({ com_port: e.target.value })}>
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
              onChange={(e) => updateForm({ com_port: e.target.value })}
            />
            <Button variant="ghost" onClick={onRefreshPorts}>
              Refresh COM list
            </Button>
          </Stack>
        )}

        {wizardStep === 2 && (
          <Stack>
            <label>Model</label>
            <select
              value={wizardForm.model}
              onChange={(e) => updateForm({ model: e.target.value as WizardForm["model"] })}
            >
              <option value="so101">SO101</option>
            </select>
            <label>Role</label>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant={wizardForm.role === "leader" ? "primary" : "default"} onClick={() => updateForm({ role: "leader" })}>
                Leader arm
              </Button>
              <Button variant={wizardForm.role === "follower" ? "primary" : "default"} onClick={() => updateForm({ role: "follower" })}>
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
              onChange={(e) => updateForm({ name: e.target.value })}
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
          {wizardStep > 1 && <Button onClick={onBack}>Back</Button>}
          <Button variant="primary" onClick={onNext}>
            {wizardStep === 3 ? "Finish" : "Next"}
          </Button>
        </div>
      </Panel>
    </div>
  );
}
