"use client";

import { ButtonHTMLAttributes, HTMLAttributes } from "react";

const cx = (...values: Array<string | false | null | undefined>) =>
  values.filter(Boolean).join(" ");

type ButtonVariant = "default" | "primary" | "ghost" | "danger" | "warning" | "warningOutline";

const buttonVariants: Record<ButtonVariant, string> = {
  default: "",
  primary: "btn-primary",
  ghost: "btn-ghost",
  danger: "btn-danger",
  warning: "btn-warning",
  warningOutline: "btn-warning-outline",
};

type WithClassName = {
  className?: string;
};

export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("panel", className)} {...props} />;
}

export function Stack({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("stack", className)} {...props} />;
}

export function Row({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("row", className)} {...props} />;
}

export function Spacer() {
  return <div className="spacer" />;
}

export function Tag({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cx("tag", className)} {...props} />;
}

export function Pill({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cx("pill", className)} {...props} />;
}

export function Notice({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("notice", className)} {...props} />;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  WithClassName & { variant?: ButtonVariant };

export function Button({ variant = "default", className, ...props }: ButtonProps) {
  return <button className={cx("btn", buttonVariants[variant], className)} {...props} />;
}
