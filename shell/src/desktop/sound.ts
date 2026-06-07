// Tiny synthesized UI sounds (no assets). Subtle by design.

let ctx: AudioContext | null = null;
function audio(): AudioContext {
  if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  return ctx;
}

function blip(freq: number, dur: number, type: OscillatorType = "sine", gain = 0.035) {
  try {
    const a = audio();
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.value = freq;
    o.connect(g);
    g.connect(a.destination);
    const t = a.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t);
    o.stop(t + dur);
  } catch {
    /* audio not available */
  }
}

export const sound = {
  open() {
    blip(620, 0.12, "sine");
  },
  close() {
    blip(280, 0.12, "sine");
  },
  minimize() {
    blip(440, 0.09, "triangle");
  },
};
