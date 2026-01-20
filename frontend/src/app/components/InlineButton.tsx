"use client";

import { ButtonHTMLAttributes } from "react";

const cx = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(" ");

type InlineButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
};

export function InlineButton({ active = false, className, ...props }: InlineButtonProps) {
  return (
    <button
      type="button"
      className={cx(
        "rounded-xl border px-3 py-1 text-xs transition",
        active ? "border-accent bg-accent/10 text-foreground" : "border-border bg-transparent text-muted hover:border-accent/60",
        className
      )}
      {...props}
    />
  );
}
