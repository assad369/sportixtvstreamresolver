import type { SessionStatus } from "@/types/stream";

const STYLES: Record<SessionStatus, { dot: string; text: string; label: string }> = {
  active: {
    dot: "bg-green-400",
    text: "text-green-300 border-green-500/40 bg-green-500/10",
    label: "Fresh",
  },
  refreshing: {
    dot: "bg-yellow-400 animate-pulse",
    text: "text-yellow-300 border-yellow-500/40 bg-yellow-500/10",
    label: "Refreshing",
  },
  failed: {
    dot: "bg-red-400",
    text: "text-red-300 border-red-500/40 bg-red-500/10",
    label: "Failed",
  },
};

export default function StatusBadge({ status }: { status: SessionStatus }) {
  const s = STYLES[status];
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${s.text}`}
    >
      <span className={`h-2 w-2 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}
