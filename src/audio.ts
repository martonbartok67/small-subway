/** Minimal sine-based sound, quantised to a 72 BPM pulse (1 beat = 1 in-game hour). */
const SCALE = [0, 2, 4, 7, 9, 12, 14]; // major pentatonic-ish, one pitch per line
const BEAT = 60 / 72;

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;
  private lastBlip = 0;

  /** Must be called from a user gesture. */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.18;
    this.master.connect(this.ctx.destination);
  }

  private tone(freq: number, at: number, dur: number, gain: number): void {
    if (!this.ctx || !this.master || this.muted) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(this.master);
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  /** Next eighth-beat boundary, so sounds fall into a gentle rhythm. */
  private quantised(): number {
    const t = this.ctx!.currentTime;
    const q = BEAT / 2;
    return Math.ceil(t / q) * q;
  }

  deliver(line: number): void {
    if (!this.ctx) return;
    const at = Math.max(this.quantised(), this.lastBlip + 0.06);
    this.lastBlip = at;
    const semis = SCALE[((line % SCALE.length) + SCALE.length) % SCALE.length];
    this.tone(523.25 * Math.pow(2, semis / 12), at, 0.35, 0.5);
  }

  station(): void {
    if (!this.ctx) return;
    const at = this.quantised();
    this.tone(392, at, 0.6, 0.35);
    this.tone(587.33, at + BEAT / 4, 0.6, 0.25);
  }

  weekEnd(): void {
    if (!this.ctx) return;
    const at = this.ctx.currentTime + 0.05;
    [261.63, 329.63, 392, 523.25].forEach((f, i) => this.tone(f, at + i * 0.04, 1.6, 0.3));
  }

  gameOver(): void {
    if (!this.ctx) return;
    const at = this.ctx.currentTime + 0.05;
    [220, 207.65, 196].forEach((f, i) => this.tone(f, at + i * 0.35, 1.2, 0.35));
  }
}
