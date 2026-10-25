const SRC = "/assets/fill.mp3";

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

let ctx: AudioContext | null = null;
let buffer: AudioBuffer | null = null;
let unlocked = false;
let loadPromise: Promise<AudioBuffer | null> | null = null;

function getCtx(): AudioContext | null {
  if (ctx) return ctx;
  const W = window as WebkitWindow;
  const AC = window.AudioContext || W.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  return ctx;
}

function loadBuffer(ac: AudioContext): Promise<AudioBuffer | null> {
  if (buffer) return Promise.resolve(buffer);
  if (loadPromise) return loadPromise;
  loadPromise = fetch(SRC)
    .then((r) => {
      if (!r.ok) throw new Error("fill.mp3 " + r.status);
      return r.arrayBuffer();
    })
    .then((arr) => ac.decodeAudioData(arr.slice(0)))
    .then((buf) => {
      buffer = buf;
      return buf;
    })
    .catch(() => {
      loadPromise = null;
      return null;
    });
  return loadPromise;
}

function startBuffer(ac: AudioContext, buf: AudioBuffer, gain = 1) {
  const src = ac.createBufferSource();
  src.buffer = buf;
  if (gain < 1) {
    const g = ac.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(ac.destination);
  } else {
    src.connect(ac.destination);
  }
  src.start(0);
}

/**
 * Must run inside a user gesture on iOS. Resumes AudioContext and warms the buffer.
 * Safe to call repeatedly; does not permanently give up if a prior attempt failed.
 */
export function unlockFillSound() {
  try {
    const ac = getCtx();
    if (!ac) return;
    // resume() must be kicked off synchronously in the gesture turn.
    const ready =
      ac.state === "suspended"
        ? ac.resume().catch(() => undefined)
        : Promise.resolve();
    void ready
      .then(() => loadBuffer(ac))
      .then((buf) => {
        if (!buf || ac.state !== "running") return;
        // Near-silent tick so iOS fully unlocks the audio session.
        if (!unlocked) startBuffer(ac, buf, 0.001);
        unlocked = true;
      });
  } catch {
    /* keep unlocked=false so the next gesture retries */
  }
}

/** Play one fill click. No-ops quietly if audio is still locked / buffer missing. */
export function playFillSound() {
  try {
    const ac = getCtx();
    if (!ac) return;
    const kick = () => {
      if (!buffer || ac.state !== "running") return;
      startBuffer(ac, buffer, 1);
      unlocked = true;
    };
    if (ac.state === "suspended") {
      // May succeed if still inside the same gesture that placed the order.
      void ac.resume().then(() => loadBuffer(ac).then(() => kick()));
      return;
    }
    if (!buffer) {
      void loadBuffer(ac).then(() => kick());
      return;
    }
    kick();
  } catch {
    /* ignore */
  }
}

export function fillSoundUnlocked() {
  return unlocked && !!ctx && ctx.state === "running" && !!buffer;
}
