import { useEffect, useState } from "react";
import { Download, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export function PwaInstallButton({ compact = false }: { compact?: boolean }) {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
      (window.navigator as any).standalone === true;
    setInstalled(!!standalone);

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice.catch(() => null);
    if (choice?.outcome === "accepted") setInstalled(true);
    setInstallPrompt(null);
  }

  if (installed) {
    return compact ? null : (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-600">
        <CheckCircle2 className="size-3.5" /> Instalado
      </span>
    );
  }

  if (!installPrompt) return null;

  return (
    <Button
      type="button"
      variant={compact ? "ghost" : "outline"}
      size={compact ? "icon" : "sm"}
      onClick={install}
      className={compact ? "size-9 rounded-full text-white hover:bg-white/10 hover:text-white" : "gap-2 rounded-xl"}
      title="Instalar HOTBOX DELIVERY"
    >
      <Download className="size-4" />
      {!compact && "Instalar app"}
    </Button>
  );
}
