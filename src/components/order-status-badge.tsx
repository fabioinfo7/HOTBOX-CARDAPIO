import { AlertCircle, Clock, ChefHat, Package, Bike, CheckCircle2, XCircle } from "lucide-react";
import { ORDER_STATUS_LABEL } from "@/lib/formatters";

export const STATUS_STYLE: Record<string, { icon: any; text: string; bg: string; border: string; dot: string; active: boolean }> = {
  pending_review: { icon: AlertCircle, text: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200", dot: "bg-amber-500", active: true },
  pending: { icon: Clock, text: "text-primary", bg: "bg-primary/10", border: "border-primary/25", dot: "bg-primary", active: true },
  preparing: { icon: ChefHat, text: "text-orange-700", bg: "bg-orange-50", border: "border-orange-200", dot: "bg-orange-500", active: true },
  ready_pickup: { icon: Package, text: "text-blue-700", bg: "bg-blue-50", border: "border-blue-200", dot: "bg-blue-500", active: true },
  out_for_delivery: { icon: Bike, text: "text-violet-700", bg: "bg-violet-50", border: "border-violet-200", dot: "bg-violet-500", active: true },
  delivered: { icon: CheckCircle2, text: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200", dot: "bg-emerald-500", active: false },
  failed: { icon: XCircle, text: "text-red-700", bg: "bg-red-50", border: "border-red-200", dot: "bg-red-500", active: false },
  cancelled: { icon: XCircle, text: "text-muted-foreground", bg: "bg-muted", border: "border-border", dot: "bg-muted-foreground", active: false },
};

export function StatusBadge({ status, size = "md", label }: { status: string; size?: "sm" | "md"; label?: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.pending;
  const Icon = s.icon;
  const pad = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border ${s.border} ${s.bg} ${pad} font-bold ${s.text}`}>
      <span className="relative flex size-2">
        {s.active && <span className={`absolute inline-flex size-full animate-ping rounded-full ${s.dot} opacity-60`} />}
        <span className={`relative inline-flex size-2 rounded-full ${s.dot}`} />
      </span>
      <Icon className={size === "sm" ? "size-3.5" : "size-4"} />
      {label ?? ORDER_STATUS_LABEL[status]}
    </span>
  );
}
