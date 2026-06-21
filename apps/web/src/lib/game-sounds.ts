export type GameSoundKind =
  | "dice"
  | "move"
  | "kill"
  | "killReturn"
  | "home"
  | "win"
  | "turn";

const THROTTLE_MS: Record<GameSoundKind, number> = {
  dice: 140,
  move: 70,
  kill: 420,
  killReturn: 55,
  home: 260,
  win: 1200,
  turn: 400,
};

type AudioContextCtor = typeof AudioContext;

function getAudioContextClass(): AudioContextCtor | null {
  return (
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: AudioContextCtor })
      .webkitAudioContext ||
    null
  );
}

export class GameSoundEngine {
  private context: AudioContext | null = null;
  private enabled = true;
  private lastPlayed: Partial<Record<GameSoundKind, number>> & {
    timerTick?: number;
  } = {};

  setEnabled(value: boolean) {
    this.enabled = value;
  }

  resume() {
    if (!this.enabled) return;
    const AudioContextClass = getAudioContextClass();
    if (!AudioContextClass) return;
    this.context ??= new AudioContextClass();
    void this.context.resume().catch(() => undefined);
  }

  play(kind: GameSoundKind) {
    if (!this.enabled) return;
    const AudioContextClass = getAudioContextClass();
    if (!AudioContextClass) return;

    const now = Date.now();
    const throttle = THROTTLE_MS[kind];
    if (now - (this.lastPlayed[kind] ?? 0) < throttle) return;
    this.lastPlayed[kind] = now;

    this.context ??= new AudioContextClass();
    const audio = this.context;
    void audio.resume().catch(() => undefined);

    switch (kind) {
      case "dice":
        this.playDiceRoll(audio);
        break;
      case "move":
        this.playTokenHop(audio);
        break;
      case "kill":
        this.playCapture(audio);
        break;
      case "killReturn":
        this.playKillReturnStep(audio);
        break;
      case "home":
        this.playHome(audio);
        break;
      case "win":
        this.playWin(audio);
        break;
      case "turn":
        this.playTurn(audio);
        break;
    }
  }

  playTimerTick(secondsLeft: number) {
    if (!this.enabled) return;
    const AudioContextClass = getAudioContextClass();
    if (!AudioContextClass) return;

    const now = Date.now();
    if (now - (this.lastPlayed.timerTick ?? 0) < 180) return;
    this.lastPlayed.timerTick = now;

    this.context ??= new AudioContextClass();
    const audio = this.context;
    void audio.resume().catch(() => undefined);
    this.playTimerTickTone(audio, secondsLeft);
  }

  private playTone(
    audio: AudioContext,
    frequency: number,
    start: number,
    duration: number,
    options: {
      type?: OscillatorType;
      gain?: number;
      attack?: number;
    } = {},
  ) {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const peak = options.gain ?? 0.09;
    const attack = options.attack ?? 0.012;
    oscillator.type = options.type ?? "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private playNoiseBurst(
    audio: AudioContext,
    start: number,
    duration: number,
    gainValue = 0.05,
  ) {
    const bufferSize = Math.max(1, Math.floor(audio.sampleRate * duration));
    const buffer = audio.createBuffer(1, bufferSize, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < bufferSize; index += 1) {
      data[index] = (Math.random() * 2 - 1) * (1 - index / bufferSize);
    }
    const source = audio.createBufferSource();
    source.buffer = buffer;
    const filter = audio.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 900;
    filter.Q.value = 0.7;
    const gain = audio.createGain();
    gain.gain.setValueAtTime(gainValue, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(gain).connect(audio.destination);
    source.start(start);
    source.stop(start + duration + 0.02);
  }

  private playDiceRoll(audio: AudioContext) {
    const start = audio.currentTime;
    for (let index = 0; index < 7; index += 1) {
      const at = start + index * 0.055;
      this.playNoiseBurst(audio, at, 0.04, 0.035 + index * 0.004);
      this.playTone(audio, 180 + index * 28, at, 0.05, {
        type: "triangle",
        gain: 0.03,
      });
    }
    this.playTone(audio, 420, start + 0.42, 0.12, { type: "square", gain: 0.04 });
  }

  private playTokenHop(audio: AudioContext) {
    const start = audio.currentTime;
    this.playTone(audio, 520, start, 0.07, { type: "triangle", gain: 0.06 });
    this.playTone(audio, 760, start + 0.018, 0.05, {
      type: "sine",
      gain: 0.035,
    });
    this.playNoiseBurst(audio, start, 0.025, 0.018);
  }

  private playCapture(audio: AudioContext) {
    const start = audio.currentTime;
    const whistle = audio.createOscillator();
    const whistleGain = audio.createGain();
    whistle.type = "square";
    whistle.frequency.setValueAtTime(920, start);
    whistle.frequency.exponentialRampToValueAtTime(240, start + 0.34);
    whistleGain.gain.setValueAtTime(0.0001, start);
    whistleGain.gain.linearRampToValueAtTime(0.07, start + 0.015);
    whistleGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.36);
    whistle.connect(whistleGain).connect(audio.destination);
    whistle.start(start);
    whistle.stop(start + 0.38);

    this.playTone(audio, 180, start + 0.07, 0.12, { type: "sine", gain: 0.11 });
    this.playTone(audio, 110, start + 0.12, 0.16, { type: "triangle", gain: 0.08 });
    this.playNoiseBurst(audio, start + 0.05, 0.1, 0.05);
    this.playTone(audio, 260, start + 0.24, 0.14, { type: "sawtooth", gain: 0.045 });
    this.playTone(audio, 196, start + 0.34, 0.22, { type: "triangle", gain: 0.05 });
    this.playTone(audio, 155, start + 0.46, 0.28, { type: "sine", gain: 0.04 });
  }

  private playKillReturnStep(audio: AudioContext) {
    const start = audio.currentTime;
    this.playTone(audio, 360, start, 0.08, { type: "triangle", gain: 0.045 });
    this.playTone(audio, 280, start + 0.02, 0.07, { type: "sine", gain: 0.035 });
    this.playNoiseBurst(audio, start, 0.02, 0.012);
  }

  private playHome(audio: AudioContext) {
    const start = audio.currentTime;
    [523, 659, 784, 988].forEach((frequency, index) => {
      this.playTone(audio, frequency, start + index * 0.09, 0.16, {
        type: "sine",
        gain: 0.07,
      });
    });
  }

  private playWin(audio: AudioContext) {
    const start = audio.currentTime;
    const melody = [523, 659, 784, 988, 1175, 988, 1175];
    melody.forEach((frequency, index) => {
      this.playTone(audio, frequency, start + index * 0.11, 0.2, {
        type: index % 2 === 0 ? "triangle" : "sine",
        gain: 0.08,
      });
    });
    this.playNoiseBurst(audio, start + 0.55, 0.25, 0.025);
  }

  private playTurn(audio: AudioContext) {
    const start = audio.currentTime;
    this.playTone(audio, 640, start, 0.1, { type: "sine", gain: 0.045 });
    this.playTone(audio, 820, start + 0.08, 0.12, { type: "triangle", gain: 0.04 });
  }

  private playTimerTickTone(audio: AudioContext, secondsLeft: number) {
    const start = audio.currentTime;
    const frequency =
      secondsLeft <= 1 ? 920 : secondsLeft === 2 ? 760 : 620;
    this.playTone(audio, frequency, start, 0.09, {
      type: "square",
      gain: 0.055,
    });
    this.playTone(audio, frequency * 1.25, start + 0.045, 0.07, {
      type: "sine",
      gain: 0.04,
    });
    if (secondsLeft <= 1) {
      this.playNoiseBurst(audio, start, 0.04, 0.025);
    }
  }
}

let sharedEngine: GameSoundEngine | null = null;

export function getGameSoundEngine() {
  sharedEngine ??= new GameSoundEngine();
  return sharedEngine;
}
