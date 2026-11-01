import { Notice } from "obsidian";
import type MyWorkoutCompanionPlugin from "./main";
import type { ActiveRestTimerState } from "./types";

export type TimerTickListener = (state: ActiveRestTimerState, now: number) => void;

export class WorkoutRestTimerService {
  private plugin: MyWorkoutCompanionPlugin;
  private intervalId: number | null = null;
  private listeners = new Set<TimerTickListener>();
  private audioCtx: AudioContext | null = null;
  private lastFinishedBannerEndAt = 0;

  constructor(plugin: MyWorkoutCompanionPlugin) {
    this.plugin = plugin;
  }

  /**
   * Вызывается внутри обработчика клика пользователя (старт таймера или запись подхода),
   * чтобы разблокировать AudioContext на iOS / iPadOS.
   */
  unlockAudioOnUserGesture(): void {
    if (!this.plugin.settings.soundEnabled) return;
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      if (!this.audioCtx) {
        this.audioCtx = new Ctx();
      }
      if (this.audioCtx.state === "suspended") {
        void this.audioCtx.resume();
      }
    } catch {
      // игнорируем, если аудио недоступно на устройстве
    }
  }

  private playCompletionChime(): void {
    if (!this.plugin.settings.soundEnabled) return;
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      if (!this.audioCtx) {
        this.audioCtx = new Ctx();
      }
      const ctx = this.audioCtx;
      if (ctx.state === "suspended") {
        void ctx.resume();
      }

      const now = ctx.currentTime;
      const playTone = (freq: number, startOffset: number, duration: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now + startOffset);
        gain.gain.setValueAtTime(0.0001, now + startOffset);
        gain.gain.exponentialRampToValueAtTime(0.18, now + startOffset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + startOffset);
        osc.stop(now + startOffset + duration + 0.02);
      };

      playTone(659.25, 0, 0.16); // E5
      playTone(880.0, 0.18, 0.24); // A5
    } catch {
      // игнорируем ошибки аудио на заблокированном устройстве
    }
  }

  getState(): ActiveRestTimerState {
    return this.plugin.settings.timer;
  }

  getLastFinishedBannerEndAt(): number {
    return this.lastFinishedBannerEndAt;
  }

  start(sessionPath: string, durationSec: number): void {
    this.unlockAudioOnUserGesture();
    const sec = Math.max(5, Math.round(durationSec));
    const now = Date.now();
    const endAt = now + sec * 1000;
    this.lastFinishedBannerEndAt = 0;

    this.plugin.settings.timer = {
      sessionPath,
      startAt: now,
      endAt,
      durationSec: sec,
      notifiedEndAt: 0,
    };
    this.plugin.requestSaveSettings();
    this.ensureLoop();
    this.emitTick();
  }

  addSeconds(deltaSec: number): void {
    this.unlockAudioOnUserGesture();
    const t = this.plugin.settings.timer;
    const now = Date.now();
    if (t.endAt > now) {
      const nextEnd = Math.max(now + 1000, t.endAt + deltaSec * 1000);
      t.endAt = nextEnd;
      t.durationSec = Math.max(5, Math.round((nextEnd - t.startAt) / 1000));
      this.plugin.requestSaveSettings();
      this.emitTick();
    } else {
      const base = Math.max(15, deltaSec > 0 ? deltaSec : t.durationSec || 120);
      this.start(t.sessionPath, base);
    }
  }

  reset(newDefaultDurationSec?: number): void {
    const t = this.plugin.settings.timer;
    this.lastFinishedBannerEndAt = 0;
    this.plugin.settings.timer = {
      sessionPath: t.sessionPath,
      startAt: 0,
      endAt: 0,
      durationSec: newDefaultDurationSec ?? (t.durationSec || 120),
      notifiedEndAt: t.notifiedEndAt,
    };
    this.plugin.requestSaveSettings();
    this.stopLoop();
    this.emitTick();
  }

  subscribe(fn: TimerTickListener): () => void {
    this.listeners.add(fn);
    this.checkAndSyncNow();
    return () => {
      this.listeners.delete(fn);
    };
  }

  /**
   * Вызывается при старте плагина, открытии окна, а также по событиям visibilitychange / focus на iPad.
   * Не затирает молча истёкший таймер, а фиксирует завершение и уведомляет пользователя.
   */
  checkAndSyncNow(): void {
    const t = this.plugin.settings.timer;
    const now = Date.now();

    if (t.endAt > 0) {
      if (t.endAt > now) {
        this.ensureLoop();
      } else {
        const finishedEndAt = t.endAt;
        const wasNotified = t.notifiedEndAt === finishedEndAt;
        this.lastFinishedBannerEndAt = finishedEndAt;
        t.endAt = 0;
        t.startAt = 0;
        t.notifiedEndAt = finishedEndAt;
        this.plugin.requestSaveSettings();
        this.stopLoop();

        if (!wasNotified) {
          const overdueSec = Math.max(0, Math.round((now - finishedEndAt) / 1000));
          const suffix =
            overdueSec >= 5 ? ` (${overdueSec} с назад)` : "";
          new Notice(`⏰ Отдых завершён${suffix} — пора на подход!`);
          this.playCompletionChime();
        }
      }
    }
    this.emitTick();
  }

  private ensureLoop(): void {
    if (this.intervalId !== null) return;
    this.intervalId = window.setInterval(() => {
      this.checkAndSyncNow();
    }, 250);
  }

  private stopLoop(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private emitTick(): void {
    const now = Date.now();
    const state = this.plugin.settings.timer;
    for (const fn of this.listeners) {
      fn(state, now);
    }
  }

  destroy(): void {
    this.stopLoop();
    this.listeners.clear();
    if (this.audioCtx) {
      try {
        void this.audioCtx.close();
      } catch {
        // игнорируем
      }
      this.audioCtx = null;
    }
  }
}

export function formatSecondsMMSS(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  const m = String(Math.floor(safe / 60)).padStart(2, "0");
  const s = String(safe % 60).padStart(2, "0");
  return `${m}:${s}`;
}