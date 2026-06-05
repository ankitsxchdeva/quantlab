import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function fmtPct(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "·";
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

export function fmtNum(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "·";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function fmtMoney(n: number): string {
  if (!Number.isFinite(n)) return "·";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

export function fmtDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}
