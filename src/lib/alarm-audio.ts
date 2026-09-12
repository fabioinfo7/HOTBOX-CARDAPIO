// Áudio do alarme como singleton fora do React.
// Por que: navegadores só liberam play() de áudio com som depois de uma
// interação real do usuário (clique/toque). Se a gente criar o <audio> só
// dentro da tela do painel, o clique que "destrava" o som acontece ANTES
// (no botão Entrar da tela de login) — numa troca de rota client-side (SPA)
// o objeto Audio criado aqui sobrevive normalmente, então destravar no clique
// do login já deixa o som liberado quando o painel aparecer, sem precisar de
// mais nenhum toque na tela.

let audio: HTMLAudioElement | null = null;

export function getAlarmAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!audio) {
    audio = new Audio();
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = 1;
  }
  return audio;
}

/** Chame isso de dentro de um handler de clique/submit (gesto do usuário). */
export function primeAlarmUnlock() {
  const a = getAlarmAudio();
  if (!a) return;
  // toca mudo/pausado imediatamente só para "destravar" o elemento pro navegador
  a.play().then(() => a.pause()).catch(() => {});
}

export function setAlarmSrc(url: string) {
  const a = getAlarmAudio();
  if (!a || a.src === url) return;
  const wasPlaying = !a.paused;
  a.src = url;
  if (wasPlaying) a.play().catch(() => {});
}

export function playAlarm() {
  const a = getAlarmAudio();
  if (!a) return;
  a.currentTime = 0;
  a.play().catch(() => {});
}

export function pauseAlarm() {
  getAlarmAudio()?.pause();
}

// ─────────────────────────────────────────────────────────────────────────
// Alarme sintetizado via Web Audio API — não depende de nenhum arquivo
// ou CDN externo. É o alarme que SEMPRE vai tocar quando chegar pedido,
// independente do alarm_sound_url configurado.
// ─────────────────────────────────────────────────────────────────────────

let __beepCtx: AudioContext | null = null;
let __beepInterval: ReturnType<typeof setInterval> | null = null;

function _playBeepOnce() {
  try {
    if (typeof window === "undefined") return;
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    __beepCtx ||= new Ctx();
    const ctx = __beepCtx;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    // Três bipes escalando — padrão de alarme urgente
    [0, 0.32, 0.64].forEach((offset, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 660 + i * 220; // 660 Hz → 880 Hz → 1100 Hz
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(1, now + offset + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.24);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.27);
    });
  } catch { /* o alarme nunca pode derrubar o app */ }
}

/** Inicia o alarme sintetizado — repete a cada 2.5 s até stopAlarmBeep(). */
export function playAlarmBeep() {
  if (__beepInterval) return; // já está tocando
  _playBeepOnce();
  try { navigator.vibrate?.([600, 200, 600, 200, 900]); } catch {}
  __beepInterval = setInterval(() => {
    _playBeepOnce();
    try { navigator.vibrate?.([600, 200, 600, 200, 900]); } catch {}
  }, 2500);
}

/** Para o alarme sintetizado imediatamente. */
export function stopAlarmBeep() {
  if (__beepInterval) {
    clearInterval(__beepInterval);
    __beepInterval = null;
  }
  try { navigator.vibrate?.(0); } catch {}
}

/** Desbloqueia o AudioContext no primeiro gesto do usuário (política do browser). */
export function primeBeepUnlock() {
  try {
    if (typeof window === "undefined") return;
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    __beepCtx ||= new Ctx();
    __beepCtx?.resume().catch(() => {});
  } catch { /* ignore */ }
}
