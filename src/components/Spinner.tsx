"use client";

interface SpinnerProps {
  size?: number;
  className?: string;
}

export default function Spinner({ size = 36, className }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={className}
      style={{ width: size, height: 2, display: "inline-block", position: "relative", overflow: "hidden", borderRadius: 999 }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-1/3 bg-accent animate-sweep"
        style={{ borderRadius: 999 }}
      />
    </span>
  );
}
