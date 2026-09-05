/**
 * Drop-impact sound synthesised with the Web Audio API (no audio assets). The context is
 * created lazily on the first user gesture; every method is safe to call when audio is
 * unavailable. Audio never influences the scientific state.
 */

export class DropAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private unlocked = false;
  muted = false;

  /** Call from a user-gesture handler to allow playback (idempotent). */
  unlock(): void {
    if (this.unlocked) return;
    try {
      const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as typeof AudioContext | undefined;
      if (!Ctor) return;
      this.context = new Ctor();
      this.master = this.context.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.context.destination);
      if (this.context.state === 'suspended') void this.context.resume();
      this.unlocked = true;
    } catch {
      this.context = null;
      this.master = null;
    }
  }

  get available(): boolean {
    return this.context !== null;
  }

  /** Short "plink": a decaying sine sweep plus a filtered noise burst, pitch scaled by drop size. */
  playDrop(dropRadiusM: number, speed: number): void {
    if (this.muted || !this.context || !this.master) return;
    const ctx = this.context;
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    const base = 1800 - Math.min(900, dropRadiusM * 250000);
    const gain = Math.min(1, 0.4 + speed * 0.2);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(base * 0.8, now);
    osc.frequency.exponentialRampToValueAtTime(base * 1.6, now + 0.03);
    osc.frequency.exponentialRampToValueAtTime(base * 1.1, now + 0.12);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(0.35 * gain, now + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    osc.connect(env).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.18);

    const length = Math.floor(ctx.sampleRate * 0.05);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2500;
    filter.Q.value = 1.2;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.12 * gain, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    noise.connect(filter).connect(noiseGain).connect(this.master);
    noise.start(now);
    noise.stop(now + 0.06);
  }

  dispose(): void {
    if (this.context) void this.context.close();
    this.context = null;
    this.master = null;
    this.unlocked = false;
  }
}

export const dropAudio = new DropAudio();
