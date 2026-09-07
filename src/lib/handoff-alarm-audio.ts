// Áudio do alarme de atendimento humano. Se houver MP3 configurado, usa o
// arquivo da loja; sem MP3, usa um beep WebAudio para que o alerta continue
// audível em vez de ficar silencioso.

let handoffAudio: HTMLAudioElement | null = null;
let handoffAudioUrl = "";
let fallbackTimer: number | null = null;

export function getHandoffAlarmAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!handoffAudio) {
    handoffAudio = new Audio();
    handoffAudio.loop = true;
    handoffAudio.preload = "auto";
  }
  return handoffAudio;
}

function fallbackBeepOnce() {
  if (typeof window === "undefined") return;
  try {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    window.setTimeout(() => {
      try { osc.stop(); } catch {}
      try { ctx.close(); } catch {}
    }, 320);
  } catch {}
}

function startFallbackBeep() {
  if (typeof window === "undefined" || fallbackTimer != null) return;
  fallbackBeepOnce();
  fallbackTimer = window.setInterval(fallbackBeepOnce, 1800);
}

function stopFallbackBeep() {
  if (typeof window === "undefined" || fallbackTimer == null) return;
  window.clearInterval(fallbackTimer);
  fallbackTimer = null;
}

/** Chame dentro de um gesto do usuário para liberar reprodução automática. */
export function primeHandoffAlarmUnlock() {
  const a = getHandoffAlarmAudio();
  if (a && handoffAudioUrl) a.play().then(() => a.pause()).catch(() => {});
  // Também inicializa WebAudio em navegadores que exigem gesto, sem tocar alto.
  try {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx();
      ctx.resume?.().finally?.(() => ctx.close?.());
    }
  } catch {}
}

export function setHandoffAlarmSrc(url: string) {
  handoffAudioUrl = String(url || "").trim();
  const a = getHandoffAlarmAudio();
  if (!a) return;
  if (!handoffAudioUrl) {
    a.pause();
    a.removeAttribute("src");
    return;
  }
  if (a.src === handoffAudioUrl) return;
  const wasPlaying = !a.paused;
  a.src = handoffAudioUrl;
  if (wasPlaying) a.play().catch(() => {});
}

export function playHandoffAlarm() {
  const a = getHandoffAlarmAudio();
  if (handoffAudioUrl && a) {
    stopFallbackBeep();
    a.currentTime = 0;
    a.play().catch(() => startFallbackBeep());
    return;
  }
  startFallbackBeep();
}

export function pauseHandoffAlarm() {
  stopFallbackBeep();
  getHandoffAlarmAudio()?.pause();
}
