// Áudio do alarme de "IA pediu atendimento humano" — singleton próprio,
// separado do alarme de novos pedidos (src/lib/alarm-audio.ts).
//
// Por quê separado: os dois alarmes podem precisar tocar em momentos
// diferentes e independentes na mesma tela do painel. Se os dois usassem o
// mesmo elemento <audio> compartilhado, um deles pausar o som (por não ter
// mais pendência) cortaria o alarme do outro por engano, mesmo que ele ainda
// devesse estar tocando.

let handoffAudio: HTMLAudioElement | null = null;

export function getHandoffAlarmAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!handoffAudio) {
    handoffAudio = new Audio();
    handoffAudio.loop = true;
    handoffAudio.preload = "auto";
  }
  return handoffAudio;
}

/** Chame isso de dentro de um handler de clique/submit (gesto do usuário),
 *  no mesmo lugar onde primeAlarmUnlock() já é chamado. */
export function primeHandoffAlarmUnlock() {
  const a = getHandoffAlarmAudio();
  if (!a) return;
  a.play().then(() => a.pause()).catch(() => {});
}

export function setHandoffAlarmSrc(url: string) {
  const a = getHandoffAlarmAudio();
  if (!a || a.src === url) return;
  const wasPlaying = !a.paused;
  a.src = url;
  if (wasPlaying) a.play().catch(() => {});
}

export function playHandoffAlarm() {
  const a = getHandoffAlarmAudio();
  if (!a) return;
  a.currentTime = 0;
  a.play().catch(() => {});
}

export function pauseHandoffAlarm() {
  getHandoffAlarmAudio()?.pause();
}
