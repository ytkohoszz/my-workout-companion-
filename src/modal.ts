import { App, Modal, Notice, setIcon } from "obsidian";
import type MyWorkoutCompanionPlugin from "./main";
import {
  ActiveRestTimerState,
  DAYS_SHORT,
  DayProgramSpec,
  HydratedWorkoutSession,
  ProgramExerciseSpec,
  REST_PRESETS,
  SessionDraftState,
  WORKOUT_KEYS,
  WorkoutPluginSettings,
  WorkoutSessionSummary,
} from "./types";
import {
  PreviousExerciseReference,
  appendSetToWorkoutFile,
  collectWorkoutSessions,
  computeSessionDurationMinutes,
  createOrOpenWorkoutSessionFile,
  deleteSetFromWorkoutFile,
  findPreviousExerciseResult,
  formatShortDateRu,
  getDayProgram,
  getEffectiveCatalog,
  getExerciseMeta,
  hydrateWorkoutSession,
  isoWeekdayOf,
  syncWorkoutHabitToDiary,
  todayLocalISO,
  yesterdayLocalISO,
} from "./scanner";
import { formatSecondsMMSS } from "./timer";

export interface OpenWorkoutOptions {
  sessionPath?: string;
  dayNumber?: number;
}

interface UniqueProgramExercise extends ProgramExerciseSpec {
  key: string;
}

function getUniqueExercises(
  program: DayProgramSpec,
  settings: WorkoutPluginSettings
): UniqueProgramExercise[] {
  const out: UniqueProgramExercise[] = [];
  const seen = new Set<string>();
  for (const e of program.exercises) {
    const key = `${e.name}__${e.weight}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ ...e, key });
    }
  }
  const catalog = getEffectiveCatalog(settings);
  if (out.length === 0) {
    for (const c of catalog) {
      out.push({
        name: c.name,
        sets: 4,
        weight: 0,
        target: "MAX",
        rest: program.restBetweenSets || 120,
        key: `${c.name}__0`,
      });
    }
  }
  return out;
}

export class WorkoutCompanionModal extends Modal {
  private plugin: MyWorkoutCompanionPlugin;
  private options: OpenWorkoutOptions;
  private closed = false;
  private cleanups: Array<() => void> = [];

  private allSessions: WorkoutSessionSummary[] = [];
  private activeSession: HydratedWorkoutSession | null = null;
  private prevRef: PreviousExerciseReference | null = null;
  private renderToken = 0;

  private headerEl!: HTMLElement;
  private timerCardEl!: HTMLElement;
  private timerTimeEl: HTMLElement | null = null;
  private timerStatusEl: HTMLElement | null = null;
  private timerFillEl: HTMLElement | null = null;
  private bodyEl!: HTMLElement;
  private sessionSelectEl: HTMLSelectElement | null = null;

  constructor(
    app: App,
    plugin: MyWorkoutCompanionPlugin,
    options: OpenWorkoutOptions = {}
  ) {
    super(app);
    this.plugin = plugin;
    this.options = options;
    (this as unknown as { shouldRestoreSelection?: boolean }).shouldRestoreSelection =
      false;
  }

  private focusSafeContainer(): void {
    if (this.closed) return;
    const active = document.activeElement;
    if (
      active instanceof HTMLSelectElement ||
      active instanceof HTMLInputElement ||
      active instanceof HTMLButtonElement
    ) {
      active.blur();
    }
    this.contentEl.focus({ preventScroll: true });
  }

  onOpen(): void {
    this.closed = false;
    this.modalEl.addClass("my-wc-modal-container");
    this.contentEl.addClass("my-wc-modal");
    this.contentEl.setAttribute("tabindex", "-1");

    this.headerEl = this.contentEl.createDiv("my-wc-header");
    this.timerCardEl = this.contentEl.createDiv("my-wc-timer-card");
    this.bodyEl = this.contentEl.createDiv("my-wc-body");

    const unsubTimer = this.plugin.timer.subscribe((state, now) => {
      this.updateTimerDisplayDOM(state, now);
    });
    this.cleanups.push(unsubTimer);

    if (this.options.sessionPath) {
      this.plugin.settings.pinnedSessionPath = this.options.sessionPath;
      this.plugin.settings.viewMode = "session";
    }
    if (
      this.options.dayNumber &&
      this.options.dayNumber >= 1 &&
      this.options.dayNumber <= 7
    ) {
      this.plugin.settings.selectedDay = this.options.dayNumber;
      if (!this.options.sessionPath) {
        this.plugin.settings.viewMode = "preview";
      }
    }

    void this.refreshAll().then(() => {
      if (this.sessionSelectEl) this.sessionSelectEl.tabIndex = -1;
      this.focusSafeContainer();
      const t1 = window.setTimeout(() => this.focusSafeContainer(), 0);
      const t2 = window.setTimeout(() => {
        if (this.sessionSelectEl) this.sessionSelectEl.removeAttribute("tabindex");
        if (document.activeElement === this.sessionSelectEl) {
          this.focusSafeContainer();
        }
      }, 60);
      this.cleanups.push(
        () => window.clearTimeout(t1),
        () => window.clearTimeout(t2)
      );
    });
  }

  onClose(): void {
    this.closed = true;
    for (const fn of this.cleanups) fn();
    this.cleanups = [];
    this.timerTimeEl = null;
    this.timerStatusEl = null;
    this.timerFillEl = null;
    this.sessionSelectEl = null;
    this.contentEl.empty();
  }

  private getDraft(
    sessionPath: string,
    program: DayProgramSpec,
    exList: UniqueProgramExercise[]
  ): SessionDraftState {
    const existing = this.plugin.settings.draftBySession[sessionPath];
    const firstEx = exList[0];
    if (existing) return existing;
    const init: SessionDraftState = {
      selectedExKey: firstEx?.key ?? "Подтягивания__0",
      customWeight: firstEx?.weight ?? 0,
      draftReps: 10,
      restDurationSec: firstEx?.rest ?? program.restBetweenSets ?? 120,
    };
    this.plugin.settings.draftBySession[sessionPath] = init;
    return init;
  }

  private async refreshAll(): Promise<void> {
    if (this.closed) return;
    const token = ++this.renderToken;
    const todayISO = todayLocalISO();
    const yesterdayISO = yesterdayLocalISO();
    const currentWeekday = isoWeekdayOf(todayISO);

    this.allSessions = collectWorkoutSessions(this.app, this.plugin.settings);
    const byPath = new Map(this.allSessions.map((s) => [s.path, s]));
    const todayEntry =
      this.allSessions.find((s) => s.dateISO === todayISO) ?? null;
    const unfinishedYesterday = !todayEntry
      ? this.allSessions.find(
          (s) => s.dateISO === yesterdayISO && s.durationMin === null
        ) ?? null
      : null;

    let pickedSummary: WorkoutSessionSummary | null = null;
    const pinned = this.plugin.settings.pinnedSessionPath;
    if (pinned && byPath.has(pinned)) {
      pickedSummary = byPath.get(pinned) ?? null;
    } else if (todayEntry) {
      pickedSummary = todayEntry;
      this.plugin.settings.pinnedSessionPath = todayEntry.path;
    } else if (unfinishedYesterday) {
      pickedSummary = unfinishedYesterday;
      this.plugin.settings.pinnedSessionPath = unfinishedYesterday.path;
    } else {
      this.plugin.settings.pinnedSessionPath = "";
    }

    const hydrated = pickedSummary
      ? await hydrateWorkoutSession(this.app, pickedSummary)
      : null;
    if (this.closed || token !== this.renderToken) return;
    this.activeSession = hydrated;

    const selDay = this.plugin.settings.selectedDay;
    if (!selDay || selDay < 1 || selDay > 7) {
      this.plugin.settings.selectedDay = hydrated
        ? hydrated.programDay
        : currentWeekday;
    }

    const isPreviewingOtherDay = Boolean(
      hydrated &&
        this.plugin.settings.viewMode === "preview" &&
        this.plugin.settings.selectedDay !== hydrated.programDay
    );
    const activeDayNum =
      hydrated && !isPreviewingOtherDay
        ? hydrated.programDay
        : this.plugin.settings.selectedDay || currentWeekday;
    const program = getDayProgram(this.plugin.settings, activeDayNum);

    if (hydrated && !isPreviewingOtherDay) {
      const exList = getUniqueExercises(program, this.plugin.settings);
      const draft = this.getDraft(hydrated.path, program, exList);
      const selectedEx =
        exList.find((e) => e.key === draft.selectedExKey) ?? exList[0];
      if (selectedEx) {
        this.prevRef = await findPreviousExerciseResult(
          this.app,
          this.allSessions,
          hydrated.path,
          selectedEx.name,
          draft.customWeight
        );
        if (this.closed || token !== this.renderToken) return;
        const hasSetsInCurrent = hydrated.loggedSets.some(
          (s) => s.name === selectedEx.name
        );
        if (!hasSetsInCurrent && this.prevRef && draft.draftReps === 10) {
          draft.draftReps = this.prevRef.lastReps;
        }
      }
    } else {
      this.prevRef = null;
    }

    this.plugin.requestSaveSettings();
    this.renderHeader(program, activeDayNum, currentWeekday, isPreviewingOtherDay);
    this.renderTimerSection(program);
    this.renderBody(program, activeDayNum, todayISO, isPreviewingOtherDay);
  }

  private renderHeader(
    program: DayProgramSpec,
    activeDayNum: number,
    currentWeekday: number,
    isPreviewingOtherDay: boolean
  ): void {
    this.headerEl.empty();
    this.sessionSelectEl = null;

    const topRow = this.headerEl.createDiv("my-wc-top-row");
    const titleWrap = topRow.createDiv("my-wc-title-wrap");
    titleWrap.createDiv({ cls: "my-wc-title", text: program.title });
    if (program.note) {
      titleWrap.createDiv({ cls: "my-wc-subtitle", text: program.note });
    }

    const controlsRow = this.headerEl.createDiv("my-wc-controls-row");
    const daysBar = controlsRow.createDiv("my-wc-days-bar");

    DAYS_SHORT.forEach((dName, idx) => {
      const dNum = idx + 1;
      const isSelected = dNum === activeDayNum;
      const btn = daysBar.createEl("button", {
        cls: "my-wc-day-btn" + (isSelected ? " is-active" : ""),
        text: dName + (dNum === currentWeekday ? "•" : ""),
        attr: { type: "button" },
      });
      btn.onclick = () => {
        if (this.activeSession && dNum === this.activeSession.programDay) {
          this.plugin.settings.selectedDay = dNum;
          this.plugin.settings.viewMode = "session";
        } else if (this.activeSession) {
          this.plugin.settings.selectedDay = dNum;
          this.plugin.settings.viewMode = "preview";
        } else {
          this.plugin.settings.selectedDay = dNum;
          this.plugin.settings.viewMode = "session";
        }
        this.plugin.requestSaveSettings();
        void this.refreshAll();
      };
    });

    if (this.allSessions.length > 0) {
      const sel = controlsRow.createEl("select", {
        cls: "dropdown my-wc-session-select",
        attr: { title: "Выбрать сессию тренировки" },
      });
      this.sessionSelectEl = sel;
      const todayISO = todayLocalISO();
      const todayEntry = this.allSessions.find((s) => s.dateISO === todayISO);
      sel.createEl("option", {
        value: "__new__",
        text: todayEntry ? "Сегодняшняя сессия" : "Новая / выбор дня",
      });
      for (const s of this.allSessions.slice(0, 15)) {
        const shortT = s.title.split("·")[1]?.trim() || s.title;
        const dayLabel = DAYS_SHORT[(s.programDay || 1) - 1] ?? "";
        const o = sel.createEl("option", {
          value: s.path,
          text: `${formatShortDateRu(s.dateISO)} · ${dayLabel} (${shortT})`,
        });
        if (
          this.activeSession &&
          this.activeSession.path === s.path &&
          !isPreviewingOtherDay
        ) {
          o.selected = true;
        }
      }
      if (!this.activeSession || isPreviewingOtherDay) {
        sel.value = "__new__";
      }
      sel.onchange = () => {
        if (sel.value === "__new__") {
          if (todayEntry) {
            this.plugin.settings.pinnedSessionPath = todayEntry.path;
            this.plugin.settings.selectedDay = todayEntry.programDay;
            this.plugin.settings.viewMode = "session";
          } else {
            this.plugin.settings.pinnedSessionPath = "";
            this.plugin.settings.viewMode = "preview";
          }
        } else {
          const picked = this.allSessions.find((x) => x.path === sel.value);
          if (picked) {
            this.plugin.settings.pinnedSessionPath = picked.path;
            this.plugin.settings.selectedDay = picked.programDay;
            this.plugin.settings.viewMode = "session";
          }
        }
        this.plugin.requestSaveSettings();
        void this.refreshAll();
        this.focusSafeContainer();
      };
    }
  }

  private renderTimerSection(program: DayProgramSpec): void {
    this.timerCardEl.empty();

    const top = this.timerCardEl.createDiv("my-wc-timer-top");
    const infoCol = top.createDiv("my-wc-timer-info");
    infoCol.createDiv({ cls: "my-wc-timer-label", text: "Таймер отдыха" });
    this.timerStatusEl = infoCol.createDiv({
      cls: "my-wc-timer-status",
      text: "Готов к запуску",
    });

    this.timerTimeEl = top.createDiv({
      cls: "my-wc-timer-digits",
      text: "00:00",
    });

    const barTrack = this.timerCardEl.createDiv("my-wc-timer-track");
    this.timerFillEl = barTrack.createDiv("my-wc-timer-fill");

    const presetsRow = this.timerCardEl.createDiv("my-wc-timer-presets");
    const sessionPath = this.activeSession?.path ?? "";
    const curDefault =
      (sessionPath
        ? this.plugin.settings.draftBySession[sessionPath]?.restDurationSec
        : undefined) ??
      this.plugin.settings.timer.durationSec ??
      program.restBetweenSets;

    for (const sec of REST_PRESETS) {
      const label = sec % 60 === 0 ? `${sec / 60} мин` : `${sec} с`;
      const btn = presetsRow.createEl("button", {
        cls: "my-wc-preset-btn" + (curDefault === sec ? " is-active" : ""),
        text: label,
        attr: { type: "button" },
      });
      btn.onclick = () => {
        if (sessionPath && this.plugin.settings.draftBySession[sessionPath]) {
          this.plugin.settings.draftBySession[sessionPath]!.restDurationSec = sec;
        }
        this.plugin.timer.start(sessionPath, sec);
        this.renderTimerSection(program);
      };
    }

    const add30Btn = presetsRow.createEl("button", {
      cls: "my-wc-preset-btn",
      text: "+30 с",
      attr: { type: "button", title: "Добавить 30 секунд отдыха" },
    });
    add30Btn.onclick = () => {
      this.plugin.timer.addSeconds(30);
    };

    const resetBtn = presetsRow.createEl("button", {
      cls: "my-wc-preset-btn is-muted",
      text: "Сброс",
      attr: { type: "button" },
    });
    resetBtn.onclick = () => {
      this.plugin.timer.reset(curDefault);
    };

    this.updateTimerDisplayDOM(this.plugin.timer.getState(), Date.now());
  }

  private updateTimerDisplayDOM(state: ActiveRestTimerState, now: number): void {
    if (!this.timerTimeEl || !this.timerStatusEl || !this.timerFillEl) return;

    if (state.endAt > now) {
      const remMs = state.endAt - now;
      const remSec = Math.max(0, Math.ceil(remMs / 1000));
      const totalMs = Math.max(1000, state.durationSec * 1000);
      const pct = Math.min(100, Math.max(0, (remMs / totalMs) * 100));

      this.timerTimeEl.setText(formatSecondsMMSS(remSec));
      this.timerTimeEl.className = "my-wc-timer-digits is-running";
      const endDate = new Date(state.endAt);
      const p = (n: number) => String(n).padStart(2, "0");
      this.timerStatusEl.setText(
        `Идёт отдых · до ${p(endDate.getHours())}:${p(endDate.getMinutes())}:${p(endDate.getSeconds())}`
      );
      this.timerFillEl.style.width = `${pct}%`;
      return;
    }

    const finishedAt = this.plugin.timer.getLastFinishedBannerEndAt();
    if (finishedAt > 0 && now - finishedAt < 120_000) {
      const agoSec = Math.max(0, Math.round((now - finishedAt) / 1000));
      this.timerTimeEl.setText("00:00");
      this.timerTimeEl.className = "my-wc-timer-digits is-done";
      this.timerStatusEl.setText(
        agoSec >= 3
          ? `Отдых завершён (${agoSec} с назад) — пора на подход!`
          : "Отдых завершён — пора на подход!"
      );
      this.timerFillEl.style.width = "100%";
      return;
    }

    this.timerTimeEl.setText("00:00");
    this.timerTimeEl.className = "my-wc-timer-digits";
    this.timerStatusEl.setText(`Выбран отдых: ${state.durationSec || 120} с`);
    this.timerFillEl.style.width = "0%";
  }

  private renderBody(
    program: DayProgramSpec,
    activeDayNum: number,
    todayISO: string,
    isPreviewingOtherDay: boolean
  ): void {
    this.bodyEl.empty();

    if (isPreviewingOtherDay && this.activeSession) {
      const banner = this.bodyEl.createDiv("my-wc-preview-banner");
      banner.createSpan({
        text: `Просмотр дня «${program.title}». Открыта сессия от ${formatShortDateRu(this.activeSession.dateISO)}.`,
      });
      const backBtn = banner.createEl("button", {
        cls: "mod-cta my-wc-btn",
        text: "↩ К активной сессии",
        attr: { type: "button" },
      });
      backBtn.onclick = () => {
        if (!this.activeSession) return;
        this.plugin.settings.selectedDay = this.activeSession.programDay;
        this.plugin.settings.viewMode = "session";
        this.plugin.requestSaveSettings();
        void this.refreshAll();
      };
    }

    if (program.isRestDay && (!this.activeSession || isPreviewingOtherDay)) {
      const restBox = this.bodyEl.createDiv("my-wc-empty-box");
      restBox.createDiv({
        cls: "my-wc-empty-title",
        text: "🌿 День отдыха и восстановления",
      });
      restBox.createDiv({
        cls: "my-wc-empty-sub",
        text: "Мышцы и ЦНС восстанавливаются. Прогулка, сон и питание.",
      });
      return;
    }

    if (!this.activeSession || isPreviewingOtherDay) {
      const startBox = this.bodyEl.createDiv("my-wc-empty-box");
      if (program.exercises.length > 0) {
        const planList = startBox.createDiv("my-wc-plan-preview");
        for (const ex of program.exercises) {
          const wTxt = ex.weight > 0 ? `+${ex.weight} кг` : "свой вес";
          const serTxt = ex.series ? `Серия ${ex.series}: ` : "";
          planList.createDiv({
            cls: "my-wc-plan-line",
            text: `${serTxt}${ex.name} — ${ex.sets} подх. × ${ex.target} (${wTxt}, отдых ${ex.rest} с)`,
          });
        }
      }
      const startBtn = startBox.createEl("button", {
        cls: "mod-cta my-wc-primary-btn",
        text: "▶ Начать тренировку (создать сессию за сегодня)",
        attr: { type: "button" },
      });
      startBtn.onclick = async () => {
        startBtn.disabled = true;
        this.plugin.timer.unlockAudioOnUserGesture();
        try {
          const file = await createOrOpenWorkoutSessionFile(
            this.app,
            this.plugin.settings,
            todayISO,
            program
          );
          this.plugin.settings.pinnedSessionPath = file.path;
          this.plugin.settings.selectedDay = activeDayNum;
          this.plugin.settings.viewMode = "session";
          this.plugin.requestSaveSettings();
          new Notice(`Тренировка начата: ${program.title}`);
          await this.refreshAll();
        } catch (err: unknown) {
          new Notice(
            "Ошибка создания сессии: " +
              (err instanceof Error ? err.message : String(err))
          );
          startBtn.disabled = false;
        }
      };
      return;
    }

    const session = this.activeSession;
    const exList = getUniqueExercises(program, this.plugin.settings);
    const catalog = getEffectiveCatalog(this.plugin.settings);

    // Если в расписании дня не все упражнения из каталога, добавляем остальные в конец списка
    const existingNames = new Set(exList.map((e) => e.name));
    for (const c of catalog) {
      if (!existingNames.has(c.name)) {
        exList.push({
          name: c.name,
          sets: 4,
          weight: 0,
          target: "MAX",
          rest: program.restBetweenSets || 120,
          key: `${c.name}__0`,
        });
      }
    }

    const draft = this.getDraft(session.path, program, exList);
    const selectedEx =
      exList.find((e) => e.key === draft.selectedExKey) ?? exList[0]!;
    const exMeta = getExerciseMeta(selectedEx.name, this.plugin.settings);

    const loggerCard = this.bodyEl.createDiv("my-wc-logger-card");

    const exRow = loggerCard.createDiv("my-wc-ex-row");
    const exSelect = exRow.createEl("select", {
      cls: "dropdown my-wc-ex-select",
    });
    for (const e of exList) {
      const wLabel = e.weight > 0 ? `+${e.weight} кг` : "свой вес";
      const o = exSelect.createEl("option", {
        value: e.key,
        text: `${e.name} (${wLabel} · цель ${e.target})`,
      });
      if (e.key === selectedEx.key) o.selected = true;
    }
    exSelect.onchange = () => {
      const picked = exList.find((e) => e.key === exSelect.value);
      if (!picked) return;
      draft.selectedExKey = picked.key;
      draft.customWeight = picked.weight;
      draft.restDurationSec = picked.rest || program.restBetweenSets || 120;
      if (this.plugin.settings.timer.endAt <= Date.now()) {
        this.plugin.settings.timer.durationSec = draft.restDurationSec;
      }
      this.plugin.requestSaveSettings();
      void this.refreshAll();
      this.focusSafeContainer();
    };

    if (this.prevRef) {
      const refBar = loggerCard.createDiv("my-wc-prev-ref");
      const wStr =
        this.prevRef.weight > 0 ? `+${this.prevRef.weight} кг` : "свой вес";
      refBar.setText(
        `В прошлый раз (${formatShortDateRu(this.prevRef.dateISO)}, ${wStr}): ${this.prevRef.sets.join(" · ")} ${exMeta.unit} (лучший: ${this.prevRef.best})`
      );
    }

    const steppersGrid = loggerCard.createDiv("my-wc-steppers-grid");

    // 1. Доп. вес (кг)
    const weightBox = steppersGrid.createDiv("my-wc-stepper-box");
    weightBox.createDiv({ cls: "my-wc-stepper-label", text: "Доп. вес (кг)" });
    const wControls = weightBox.createDiv("my-wc-stepper-controls");

    const wMinusBtn = wControls.createEl("button", {
      cls: "my-wc-step-btn",
      text: "−2",
      attr: { type: "button" },
    });
    const wInput = wControls.createEl("input", {
      cls: "my-wc-step-input",
      attr: {
        type: "number",
        inputmode: "decimal",
        min: "0",
        max: "500",
        step: "0.5",
      },
    });
    wInput.value = String(draft.customWeight);
    const wPlusBtn = wControls.createEl("button", {
      cls: "my-wc-step-btn",
      text: "+2",
      attr: { type: "button" },
    });
    const wZeroBtn = wControls.createEl("button", {
      cls: "my-wc-step-btn is-subtle",
      text: "0",
      attr: { type: "button", title: "Свой вес (0 кг)" },
    });

    const applyWeight = (nextW: number) => {
      const clean = Math.max(0, Math.min(500, Math.round(nextW * 2) / 2));
      draft.customWeight = clean;
      wInput.value = String(clean);
      this.plugin.requestSaveSettings();
    };
    wMinusBtn.onclick = () => applyWeight((Number(wInput.value) || 0) - 2);
    wPlusBtn.onclick = () => applyWeight((Number(wInput.value) || 0) + 2);
    wZeroBtn.onclick = () => applyWeight(0);
    wInput.oninput = () => {
      const n = Number(wInput.value.replace(",", "."));
      if (Number.isFinite(n) && n >= 0) {
        draft.customWeight = n;
        this.plugin.requestSaveSettings();
      }
    };

    // 2. Повторения / Секунды
    const repsBox = steppersGrid.createDiv("my-wc-stepper-box");
    repsBox.createDiv({
      cls: "my-wc-stepper-label",
      text:
        exMeta.field === "секунды"
          ? `Секунды (цель: ${selectedEx.target})`
          : `Повторения (цель: ${selectedEx.target})`,
    });
    const rControls = repsBox.createDiv("my-wc-stepper-controls");

    const rMinusBtn = rControls.createEl("button", {
      cls: "my-wc-step-btn",
      text: "−1",
      attr: { type: "button" },
    });
    const rInput = rControls.createEl("input", {
      cls: "my-wc-step-input",
      attr: {
        type: "number",
        inputmode: "numeric",
        min: "1",
        max: "600",
        step: "1",
      },
    });
    rInput.value = String(draft.draftReps || 10);
    const rPlus1Btn = rControls.createEl("button", {
      cls: "my-wc-step-btn",
      text: "+1",
      attr: { type: "button" },
    });
    const rPlus2Btn = rControls.createEl("button", {
      cls: "my-wc-step-btn",
      text: "+2",
      attr: { type: "button" },
    });

    const applyReps = (nextR: number) => {
      const clean = Math.max(1, Math.min(600, Math.round(nextR)));
      draft.draftReps = clean;
      rInput.value = String(clean);
      this.plugin.requestSaveSettings();
    };
    rMinusBtn.onclick = () => applyReps((Number(rInput.value) || 1) - 1);
    rPlus1Btn.onclick = () => applyReps((Number(rInput.value) || 1) + 1);
    rPlus2Btn.onclick = () => applyReps((Number(rInput.value) || 1) + 2);
    rInput.oninput = () => {
      const n = Math.round(Number(rInput.value));
      if (Number.isFinite(n) && n >= 1) {
        draft.draftReps = n;
        this.plugin.requestSaveSettings();
      }
    };

    const submitBtn = loggerCard.createEl("button", {
      cls: "mod-cta my-wc-primary-btn",
      text: `✓ Записать подход и запустить отдых (${draft.restDurationSec} с)`,
      attr: { type: "button" },
    });

    const doSubmitSet = async () => {
      if (submitBtn.disabled) return;
      this.plugin.timer.unlockAudioOnUserGesture();

      const repsVal = Math.round(Number(rInput.value));
      if (!Number.isFinite(repsVal) || repsVal < 1 || repsVal > 600) {
        new Notice("Укажи число повторений от 1 до 600.");
        return;
      }
      const weightVal = Math.max(
        0,
        Number(String(wInput.value).replace(",", ".")) || 0
      );

      submitBtn.disabled = true;
      try {
        await appendSetToWorkoutFile(
          this.app,
          this.plugin.settings,
          session,
          selectedEx.name,
          repsVal,
          weightVal,
          "Основной"
        );
        draft.customWeight = weightVal;
        draft.draftReps = repsVal;
        this.plugin.timer.start(session.path, draft.restDurationSec);
        new Notice(
          `Записано: ${selectedEx.name} — ${repsVal} ${exMeta.unit}` +
            (weightVal > 0 ? ` (+${weightVal} кг)` : "")
        );
        await this.refreshAll();
      } catch (err: unknown) {
        new Notice(
          "Ошибка записи подхода: " +
            (err instanceof Error ? err.message : String(err))
        );
        submitBtn.disabled = false;
      }
    };

    submitBtn.onclick = () => void doSubmitSet();

    if (program.isVolumePullups) {
      const pullupsSum = session.loggedSets
        .filter((s) => s.name === "Подтягивания")
        .reduce((acc, s) => acc + s.reps, 0);
      const target = program.targetVolume || 100;
      const pct = Math.min(100, Math.round((pullupsSum / target) * 100));

      const volBox = this.bodyEl.createDiv("my-wc-volume-box");
      volBox.createDiv({
        cls: "my-wc-volume-text",
        text: `Объём подтягиваний за сессию: ${pullupsSum} из ${target} (${pct}%)`,
      });
      const vTrack = volBox.createDiv("my-wc-timer-track");
      const vFill = vTrack.createDiv("my-wc-volume-fill");
      vFill.style.width = `${pct}%`;
    }

    const setsSection = this.bodyEl.createDiv("my-wc-sets-section");
    const setsHead = setsSection.createDiv("my-wc-sets-head");
    setsHead.createSpan({
      cls: "my-wc-sets-title",
      text: `Выполнено в сессии · ${session.loggedSets.length}`,
    });

    const sessionActions = setsHead.createDiv("my-wc-sets-actions");
    const openNoteBtn = sessionActions.createEl("button", {
      cls: "my-wc-btn",
      text: "📄 Заметка",
      attr: { type: "button", title: "Открыть файл тренировки" },
    });
    openNoteBtn.onclick = () => {
      this.close();
      void this.app.workspace.openLinkText(session.path, "", false);
    };

    const finishBtn = sessionActions.createEl("button", {
      cls: "my-wc-btn",
      text: session.durationMin
        ? `🔄 Обновить время (${session.durationMin} мин)`
        : "✓ Завершить тренировку",
      attr: { type: "button" },
    });
    finishBtn.onclick = async () => {
      finishBtn.disabled = true;
      try {
        const dur = computeSessionDurationMinutes(
          session.startStr,
          session.durationMin,
          session.dateISO || todayISO
        );
        await this.app.fileManager.processFrontMatter(
          session.file,
          (fm: Record<string, unknown>) => {
            fm[WORKOUT_KEYS.durationMin] = dur;
            if (!fm[WORKOUT_KEYS.programDay]) {
              fm[WORKOUT_KEYS.programDay] = session.programDay;
            }
          }
        );
        await syncWorkoutHabitToDiary(
          this.app,
          this.plugin.settings,
          session.dateISO || todayISO
        );
        new Notice(`Тренировка завершена (${dur} мин)`);
        await this.refreshAll();
      } catch (err: unknown) {
        new Notice(
          "Ошибка завершения: " +
            (err instanceof Error ? err.message : String(err))
        );
        finishBtn.disabled = false;
      }
    };

    if (session.loggedSets.length === 0) {
      setsSection.createDiv({
        cls: "my-wc-sets-empty",
        text: "Подходов в этой сессии пока нет.",
      });
    } else {
      const pillsList = setsSection.createDiv("my-wc-sets-list");
      session.loggedSets.forEach((s, idx) => {
        const meta = getExerciseMeta(s.name, this.plugin.settings);
        const wText = s.weight > 0 ? ` +${s.weight} кг` : "";
        const pill = pillsList.createDiv("my-wc-set-pill");
        pill.createSpan({
          text: `${idx + 1}. ${s.name}: ${s.reps} ${meta.unit}${wText}`,
        });

        const delBtn = pill.createEl("button", {
          cls: "my-wc-set-del",
          attr: { type: "button", title: "Удалить этот подход" },
        });
        setIcon(delBtn, "x");
        delBtn.onclick = async () => {
          delBtn.disabled = true;
          await deleteSetFromWorkoutFile(this.app, session.file, s.lineIndex);
          await this.refreshAll();
        };
      });
    }
  }
}
