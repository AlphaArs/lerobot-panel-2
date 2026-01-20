"use client";

import { ReactNode } from "react";
import { Stack } from "@/app/ui";

type FieldProps = {
  label: string;
  htmlFor?: string;
  hint?: string;
  className?: string;
  children: ReactNode;
};

export function Field({ label, htmlFor, hint, className, children }: FieldProps) {
  return (
    <Stack className={className}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint ? <p className="m-0 text-xs text-muted">{hint}</p> : null}
    </Stack>
  );
}
