const SRC = "/assets/fill.mp3";

let audio: HTMLAudioElement | null = null;
let unlocked = false;

export function unlockFillSound() {
  if (unlocked) return;
  try {
    if (!audio) {
      audio = new Audio(SRC);
      audio.preload = "auto";
    }
    const p = audio.play();
    if (p) {
      p.then(() => {
        if (!audio) return;
        audio.pause();
        audio.currentTime = 0;
        unlocked = true;
      }).catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

export function playFillSound() {
  if (!unlocked || !audio) return;
  try {
    audio.currentTime = 0;
    void audio.play().catch(() => {});
  } catch {
    /* ignore */
  }
}
