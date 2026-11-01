import { App, Modal, Notice, setIcon } from "obsidian";
import type MyWorkoutCompanionPlugin from "./main";
import {
  ActiveRestTimerState,
  HydratedWorkoutSession,
  PlannedExerciseItem,
  REST_PRESETS,
  SessionDraftState,
  WORKOUT_KEYS,
  WorkoutSessionSummary,
  makePlanItemId,
} from "./types";
import {
  PreviousExerciseReference,
  appendSetToWorkoutFile,
  buildPlanFromLoggedSets,
  buildPlanFromPreviousSession,
  collectWorkoutSessions,
  computeSessionDurationMinutes,
  createOrOpenWorkoutSessionFile,
  deleteSetFromWorkoutFile,
  findPreviousExerciseResult,
  formatDateWithWeekdayRu,
  formatDefaultSessionTitle,
  formatShortDateRu,
  getExerciseMeta,
  hydrateWorkoutSession,
  syncWorkoutHabitToDiary,
  todayLocalISO,
  yesterdayLocalISO,
} from "./scanner";
import { formatSecondsMMSS } from "./timer";

export interface OpenWorkoutOptions {
  sessionPath?: string;
  dateISO?: string;
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

  // UI-состояния внутри конструктора
  private isBuilderExpanded = false;
  private isNewExerciseFormOpen = false;
  private newExNameDraft = "";
  private newExFieldDraft: "повторы" | "секунды" = "повторы";
  private isSaveTemplateOpen = false;
  private saveTemplateNameDraft = "";
  private lastRecordSetLineIndex: number | null = null;

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
    }
    if (
      this.options.dateISO &&
      /^\d{4}-\d{2}-\d{2}$/.test(this.options.dateISO)
    ) {
      this.plugin.settings.selectedDateISO = this.options.dateISO;
    } else if (!this.plugin.settings.selectedDateISO) {
      this.plugin.settings.selectedDateISO = todayLocalISO();
    }

    void this.refreshAll().then(() => {
      if (this.sessionSelectEl) this.sessionSelectEl.tabIndex = -1;
      this.focusSafeContainer();
      const t1 = window.setTimeout(() => this.focusSafeContainer(), 0);
      const t2 = window.setTimeout(() => {
        if (this.sessionSelectEl) {
          this.sessionSelectEl.removeAttribute("tabindex");
        }
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

  private getDraftKey(dateISO: string): string {
    return this.activeSession ? this.activeSession.path : `date:${dateISO}`;
  }

  private getOrCreateDraft(dateISO: string): SessionDraftState {
    const key = this.getDraftKey(dateISO);
    const existing = this.plugin.settings.draftBySession[key];
    if (existing) {
      // Если сессия уже содержит записанные подходы, а план в черновике был пуст — восстанавливаем из факта
      if (
        existing.plannedExercises.length === 0 &&
        this.activeSession &&
        this.activeSession.loggedSets.length > 0
      ) {
        existing.plannedExercises = buildPlanFromLoggedSets(
          this.activeSession.loggedSets,
          existing.restDurationSec || 120
        );
        existing.selectedPlanItemId = existing.plannedExercises[0]?.id ?? "";
      }
      return existing;
    }

    // Если на дату был черновик до создания файла (`date:YYYY-MM-DD`), переносим его в ключ файла
    const preFileDraft = this.plugin.settings.draftBySession[`date:${dateISO}`];
    if (preFileDraft && this.activeSession) {
      this.plugin.settings.draftBySession[key] = preFileDraft;
      delete this.plugin.settings.draftBySession[`date:${dateISO}`];
      return preFileDraft;
    }

    const initialPlanned =
      this.activeSession && this.activeSession.loggedSets.length > 0
        ? buildPlanFromLoggedSets(this.activeSession.loggedSets, 120)
        : [];
    const firstPlan = initialPlanned[0];
    const firstCat =
      this.plugin.programStore.getCatalog()[0]?.name ?? "Подтягивания";

    const created: SessionDraftState = {
      selectedPlanItemId: firstPlan?.id ?? "",
      selectedExName: firstPlan?.name ?? firstCat,
      customWeight: firstPlan?.weight ?? 0,
      draftReps: 10,
      restDurationSec: firstPlan?.rest ?? 120,
      plannedExercises: initialPlanned,
    };
    this.plugin.settings.draftBySession[key] = created;
    return created;
  }

  private countDoneSetsForPlanItem(
    session: HydratedWorkoutSession | null,
    item: PlannedExerciseItem
  ): number {
    if (!session) return 0;
    return session.loggedSets.filter(
      (s) => s.name === item.name && Math.abs(s.weight - item.weight) < 0.01
    ).length;
  }

  private async refreshAll(): Promise<void> {
    if (this.closed) return;
    const token = ++this.renderToken;
    const todayISO = todayLocalISO();
    const yesterdayISO = yesterdayLocalISO();

    this.allSessions = collectWorkoutSessions(this.app, this.plugin.settings);
    const byPath = new Map(this.allSessions.map((s) => [s.path, s]));

    let targetDateISO = this.plugin.settings.selectedDateISO || todayISO;
    let pickedSummary: WorkoutSessionSummary | null = null;

    const pinned = this.plugin.settings.pinnedSessionPath;
    if (pinned && byPath.has(pinned)) {
      pickedSummary = byPath.get(pinned) ?? null;
      if (pickedSummary?.dateISO) {
        targetDateISO = pickedSummary.dateISO;
        this.plugin.settings.selectedDateISO = targetDateISO;
      }
    } else {
      const forSelectedDate =
        this.allSessions.find((s) => s.dateISO === targetDateISO) ?? null;
      const unfinishedYesterday =
        targetDateISO === todayISO && !forSelectedDate
          ? this.allSessions.find(
              (s) => s.dateISO === yesterdayISO && s.durationMin === null
            ) ?? null
          : null;

      if (forSelectedDate) {
        pickedSummary = forSelectedDate;
        this.plugin.settings.pinnedSessionPath = forSelectedDate.path;
      } else if (unfinishedYesterday) {
        pickedSummary = unfinishedYesterday;
        targetDateISO = unfinishedYesterday.dateISO;
        this.plugin.settings.selectedDateISO = targetDateISO;
        this.plugin.settings.pinnedSessionPath = unfinishedYesterday.path;
      } else {
        this.plugin.settings.pinnedSessionPath = "";
      }
    }

    const hydrated = pickedSummary
      ? await hydrateWorkoutSession(this.app, pickedSummary)
      : null;
    if (this.closed || token !== this.renderToken) return;
    this.activeSession = hydrated;

    const draft = this.getOrCreateDraft(targetDateISO);

    // Синхронизируем выбранное упражнение с планом, если выбран пункт плана
    if (draft.plannedExercises.length > 0) {
      const foundPlan =
        draft.plannedExercises.find((p) => p.id === draft.selectedPlanItemId) ??
        draft.plannedExercises[0]!;
      if (draft.selectedPlanItemId !== foundPlan.id) {
        draft.selectedPlanItemId = foundPlan.id;
        draft.selectedExName = foundPlan.name;
        draft.customWeight = foundPlan.weight;
        draft.restDurationSec = foundPlan.rest;
      }
    } else if (!draft.selectedExName) {
      draft.selectedExName =
        this.plugin.programStore.getCatalog()[0]?.name ?? "Подтягивания";
    }

    // Если план ещё пустой и сессия не начата — сразу раскрываем конструктор состава
    if (!hydrated && draft.plannedExercises.length === 0) {
      this.isBuilderExpanded = true;
    }

    this.prevRef = await findPreviousExerciseResult(
      this.app,
      this.allSessions,
      hydrated?.path ?? "",
      draft.selectedExName,
      draft.customWeight
    );
    if (this.closed || token !== this.renderToken) return;

    const hasSetsForThisEx = hydrated?.loggedSets.some(
      (s) => s.name === draft.selectedExName
    );
    if (!hasSetsForThisEx && this.prevRef && draft.draftReps === 10) {
      draft.draftReps = this.prevRef.lastReps;
    }

    this.plugin.requestSaveSettings();
    this.renderHeader(targetDateISO, todayISO, yesterdayISO, draft);
    this.renderTimerSection(draft);
    this.renderBody(targetDateISO, draft);
  }

  private renderHeader(
    targetDateISO: string,
    todayISO: string,
    yesterdayISO: string,
    draft: SessionDraftState
  ): void {
    this.headerEl.empty();
    this.sessionSelectEl = null;

    const topRow = this.headerEl.createDiv("my-wc-top-row");
    const titleWrap = topRow.createDiv("my-wc-title-wrap");

    const displayTitle =
      this.activeSession?.title ||
      draft.customTitle ||
      formatDefaultSessionTitle(targetDateISO, draft.plannedExercises);

    titleWrap.createDiv({ cls: "my-wc-title", text: displayTitle });
    titleWrap.createDiv({
      cls: "my-wc-subtitle",
      text: `Дата: ${formatDateWithWeekdayRu(targetDateISO)}${
        this.activeSession
          ? ` · сессия открыта (${this.activeSession.loggedSets.length} подх.)`
          : " · черновик тренировки"
      }`,
    });

    const controlsRow = this.headerEl.createDiv("my-wc-controls-row");
    const dateGroup = controlsRow.createDiv("my-wc-days-bar");

    const switchDate = (nextISO: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(nextISO)) return;
      this.plugin.settings.selectedDateISO = nextISO;
      const match = this.allSessions.find((s) => s.dateISO === nextISO);
      this.plugin.settings.pinnedSessionPath = match ? match.path : "";
      this.plugin.requestSaveSettings();
      void this.refreshAll();
    };

    const todayBtn = dateGroup.createEl("button", {
      cls: "my-wc-day-btn" + (targetDateISO === todayISO ? " is-active" : ""),
      text: `Сегодня (${formatShortDateRu(todayISO)})`,
      attr: { type: "button" },
    });
    todayBtn.onclick = () => switchDate(todayISO);

    const yestBtn = dateGroup.createEl("button", {
      cls:
        "my-wc-day-btn" + (targetDateISO === yesterdayISO ? " is-active" : ""),
      text: "Вчера",
      attr: { type: "button" },
    });
    yestBtn.onclick = () => switchDate(yesterdayISO);

    const dateInput = dateGroup.createEl("input", {
      cls: "my-wc-date-input",
      attr: {
        type: "date",
        value: targetDateISO,
        title: "Выбрать любую дату тренировки",
      },
    });
    dateInput.onchange = () => {
      if (dateInput.value) {
        switchDate(dateInput.value);
        this.focusSafeContainer();
      }
    };

    if (this.allSessions.length > 0) {
      const sel = controlsRow.createEl("select", {
        cls: "dropdown my-wc-session-select",
        attr: { title: "Переключиться на существующую сессию" },
      });
      this.sessionSelectEl = sel;
      sel.createEl("option", {
        value: "__current_date__",
        text: this.activeSession
          ? `Сессия ${formatShortDateRu(targetDateISO)}`
          : `Новая на ${formatShortDateRu(targetDateISO)}`,
      });
      for (const s of this.allSessions.slice(0, 20)) {
        const shortT = s.title.split("·")[1]?.trim() || s.title;
        const o = sel.createEl("option", {
          value: s.path,
          text: `${formatDateWithWeekdayRu(s.dateISO)} (${shortT})`,
        });
        if (this.activeSession && this.activeSession.path === s.path) {
          o.selected = true;
        }
      }
      if (!this.activeSession) {
        sel.value = "__current_date__";
      }
      sel.onchange = () => {
        if (sel.value !== "__current_date__") {
          const picked = this.allSessions.find((x) => x.path === sel.value);
          if (picked) {
            this.plugin.settings.pinnedSessionPath = picked.path;
            this.plugin.settings.selectedDateISO = picked.dateISO;
            this.plugin.requestSaveSettings();
            void this.refreshAll();
          }
        }
        this.focusSafeContainer();
      };
    }
  }

  private renderTimerSection(draft: SessionDraftState): void {
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
      draft.restDurationSec || this.plugin.settings.timer.durationSec || 120;

    for (const sec of REST_PRESETS) {
      const label = sec % 60 === 0 ? `${sec / 60} мин` : `${sec} с`;
      const btn = presetsRow.createEl("button", {
        cls: "my-wc-preset-btn" + (curDefault === sec ? " is-active" : ""),
        text: label,
        attr: { type: "button" },
      });
      btn.onclick = () => {
        draft.restDurationSec = sec;
        this.plugin.timer.start(sessionPath, sec);
        this.renderTimerSection(draft);
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

  private renderWorkoutBuilderSection(
    targetDateISO: string,
    draft: SessionDraftState
  ): void {
    const builderCard = this.bodyEl.createDiv("my-wc-builder-card");

    const head = builderCard.createDiv("my-wc-builder-head");
    const leftTitle = head.createDiv("my-wc-builder-title-wrap");
    const totalPlannedSets = draft.plannedExercises.reduce(
      (acc, e) => acc + e.sets,
      0
    );
    leftTitle.createSpan({
      cls: "my-wc-sets-title",
      text:
        draft.plannedExercises.length > 0
          ? `Состав тренировки · ${draft.plannedExercises.length} упр. (${totalPlannedSets} подх.)`
          : "Состав тренировки (свободный выбор)",
    });

    const headBtns = head.createDiv("my-wc-sets-actions");
    const toggleBuilderBtn = headBtns.createEl("button", {
      cls: "my-wc-btn" + (this.isBuilderExpanded ? " is-active" : ""),
      text: this.isBuilderExpanded ? "Свернуть план" : "Настроить состав",
      attr: { type: "button" },
    });
    toggleBuilderBtn.onclick = () => {
      this.isBuilderExpanded = !this.isBuilderExpanded;
      void this.refreshAll();
    };

    // Компактные чипы упражнений плана (всегда видны для переключения в 1 нажатие на iPad)
    if (draft.plannedExercises.length > 0) {
      const chipsBar = builderCard.createDiv("my-wc-plan-chips");
      for (const item of draft.plannedExercises) {
        const done = this.countDoneSetsForPlanItem(this.activeSession, item);
        const isCurrent = draft.selectedPlanItemId === item.id;
        const isCompleted = done >= item.sets;
        const wStr = item.weight > 0 ? ` +${item.weight}кг` : "";
        const chip = chipsBar.createEl("button", {
          cls:
            "my-wc-plan-chip" +
            (isCurrent ? " is-active" : "") +
            (isCompleted ? " is-done" : ""),
          text: `${item.name}${wStr} · ${done}/${item.sets}`,
          attr: {
            type: "button",
            title: `Цель: ${item.target}, отдых ${item.rest} с`,
          },
        });
        chip.onclick = () => {
          draft.selectedPlanItemId = item.id;
          draft.selectedExName = item.name;
          draft.customWeight = item.weight;
          draft.restDurationSec = item.rest;
          if (this.plugin.settings.timer.endAt <= Date.now()) {
            this.plugin.settings.timer.durationSec = item.rest;
          }
          this.plugin.requestSaveSettings();
          void this.refreshAll();
        };
      }
    }

    if (!this.isBuilderExpanded) return;

    // Панель быстрых действий: Повторить прошлую · Из шаблона · Сохранить как шаблон · Своё упражнение
    const quickBar = builderCard.createDiv("my-wc-builder-quickbar");

    const repeatLastBtn = quickBar.createEl("button", {
      cls: "my-wc-btn",
      text: "↺ Повторить прошлую",
      attr: {
        type: "button",
        title: "Скопировать упражнения и веса из последней тренировки",
      },
    });
    repeatLastBtn.onclick = async () => {
      const prevPlan = await buildPlanFromPreviousSession(
        this.app,
        this.allSessions,
        this.activeSession?.path
      );
      if (!prevPlan || prevPlan.items.length === 0) {
        new Notice("В хранилище пока нет прошлых тренировок с подходами.");
        return;
      }
      draft.plannedExercises = prevPlan.items;
      const first = draft.plannedExercises[0];
      if (first) {
        draft.selectedPlanItemId = first.id;
        draft.selectedExName = first.name;
        draft.customWeight = first.weight;
        draft.restDurationSec = first.rest;
      }
      this.plugin.requestSaveSettings();
      new Notice(
        `Скопирован состав от ${formatShortDateRu(prevPlan.sourceDateISO)}`
      );
      await this.refreshAll();
    };

    const templates = this.plugin.programStore.getTemplates();
    if (templates.length > 0) {
      const tplSelect = quickBar.createEl("select", {
        cls: "dropdown my-wc-tpl-select",
      });
      tplSelect.createEl("option", {
        value: "",
        text: "Загрузить из шаблона…",
      });
      for (const t of templates) {
        tplSelect.createEl("option", {
          value: t.id,
          text: `${t.name} (${t.exercises.length} упр.)`,
        });
      }
      tplSelect.onchange = () => {
        const picked = templates.find((t) => t.id === tplSelect.value);
        if (!picked) return;
        draft.plannedExercises = picked.exercises.map((e) => ({
          ...e,
          id: makePlanItemId(),
        }));
        draft.customTitle = picked.name;
        const first = draft.plannedExercises[0];
        if (first) {
          draft.selectedPlanItemId = first.id;
          draft.selectedExName = first.name;
          draft.customWeight = first.weight;
          draft.restDurationSec = first.rest;
        }
        this.plugin.requestSaveSettings();
        new Notice(`Загружен шаблон: «${picked.name}»`);
        void this.refreshAll();
        this.focusSafeContainer();
      };
    }

    const addPlanItemBtn = quickBar.createEl("button", {
      cls: "mod-cta my-wc-btn",
      text: "＋ Добавить в план",
      attr: { type: "button" },
    });
    addPlanItemBtn.onclick = () => {
      const catalog = this.plugin.programStore.getCatalog();
      const baseName =
        draft.selectedExName || catalog[0]?.name || "Подтягивания";
      const newItem: PlannedExerciseItem = {
        id: makePlanItemId(),
        name: baseName,
        weight: draft.customWeight || 0,
        sets: 4,
        target: "MAX",
        rest: draft.restDurationSec || 120,
      };
      draft.plannedExercises.push(newItem);
      draft.selectedPlanItemId = newItem.id;
      this.plugin.requestSaveSettings();
      void this.refreshAll();
    };

    const customExToggleBtn = quickBar.createEl("button", {
      cls: "my-wc-btn" + (this.isNewExerciseFormOpen ? " is-active" : ""),
      text: "＋ Своё упражнение",
      attr: { type: "button" },
    });
    customExToggleBtn.onclick = () => {
      this.isNewExerciseFormOpen = !this.isNewExerciseFormOpen;
      void this.refreshAll();
    };

    if (draft.plannedExercises.length > 0) {
      const saveTplToggleBtn = quickBar.createEl("button", {
        cls: "my-wc-btn" + (this.isSaveTemplateOpen ? " is-active" : ""),
        text: "★ В шаблон",
        attr: { type: "button", title: "Сохранить текущий состав как шаблон" },
      });
      saveTplToggleBtn.onclick = () => {
        this.isSaveTemplateOpen = !this.isSaveTemplateOpen;
        void this.refreshAll();
      };
    }

    // Инлайн-форма создания своего упражнения
    if (this.isNewExerciseFormOpen) {
      const customBox = builderCard.createDiv("my-wc-inline-drawer");
      const exNameInp = customBox.createEl("input", {
        cls: "my-wc-set-target",
        attr: {
          type: "text",
          placeholder: "Название упражнения (напр. Армейский жим)…",
          value: this.newExNameDraft,
        },
      });
      exNameInp.oninput = () => {
        this.newExNameDraft = exNameInp.value;
      };

      const kindSel = customBox.createEl("select", { cls: "dropdown" });
      kindSel.createEl("option", {
        value: "повторы",
        text: "Повторения (повт.)",
      });
      const secOpt = kindSel.createEl("option", {
        value: "секунды",
        text: "Время (секунды, с)",
      });
      if (this.newExFieldDraft === "секунды") secOpt.selected = true;
      kindSel.onchange = () => {
        this.newExFieldDraft =
          kindSel.value === "секунды" ? "секунды" : "повторы";
      };

      const saveExBtn = customBox.createEl("button", {
        cls: "mod-cta my-wc-btn",
        text: "Создать и добавить",
        attr: { type: "button" },
      });
      saveExBtn.onclick = () => {
        const created = this.plugin.programStore.addCustomExercise(
          this.newExNameDraft,
          this.newExFieldDraft
        );
        if (!created) {
          new Notice("Введи название упражнения.");
          return;
        }
        const planItem: PlannedExerciseItem = {
          id: makePlanItemId(),
          name: created.name,
          weight: 0,
          sets: 4,
          target: "MAX",
          rest: 120,
        };
        draft.plannedExercises.push(planItem);
        draft.selectedPlanItemId = planItem.id;
        draft.selectedExName = created.name;
        draft.customWeight = 0;
        this.newExNameDraft = "";
        this.isNewExerciseFormOpen = false;
        this.plugin.requestSaveSettings();
        new Notice(`Упражнение «${created.name}» добавлено в каталог и план.`);
        void this.refreshAll();
      };
    }

    // Инлайн-форма сохранения текущего состава как шаблона
    if (this.isSaveTemplateOpen && draft.plannedExercises.length > 0) {
      const tplDrawer = builderCard.createDiv("my-wc-inline-drawer");
      const tplNameInp = tplDrawer.createEl("input", {
        cls: "my-wc-set-target",
        attr: {
          type: "text",
          placeholder: "Имя шаблона (напр. Тяжёлая база +20 кг)…",
          value: this.saveTemplateNameDraft,
        },
      });
      tplNameInp.oninput = () => {
        this.saveTemplateNameDraft = tplNameInp.value;
      };

      const confirmSaveTplBtn = tplDrawer.createEl("button", {
        cls: "mod-cta my-wc-btn",
        text: "Сохранить шаблон",
        attr: { type: "button" },
      });
      confirmSaveTplBtn.onclick = () => {
        const saved = this.plugin.programStore.saveTemplate(
          this.saveTemplateNameDraft,
          draft.plannedExercises
        );
        if (!saved) {
          new Notice("Укажи название шаблона.");
          return;
        }
        this.saveTemplateNameDraft = "";
        this.isSaveTemplateOpen = false;
        new Notice(`Шаблон «${saved.name}» сохранён.`);
        void this.refreshAll();
      };
    }

    // Редактируемый список упражнений состава тренировки (перестановка ↑/↓, вес, подходы, цель, отдых, удаление)
    if (draft.plannedExercises.length === 0) {
      builderCard.createDiv({
        cls: "my-wc-sets-empty",
        text: "План пуст — нажми «＋ Добавить в план», «↺ Повторить прошлую» или выбери шаблон (либо просто записывай подходы свободно ниже).",
      });
    } else {
      const listEl = builderCard.createDiv("my-wc-set-ex-list");
      const catalog = this.plugin.programStore.getCatalog();

      draft.plannedExercises.forEach((item, idx) => {
        const row = listEl.createDiv("my-wc-set-ex-row");

        const exSel = row.createEl("select", {
          cls: "dropdown my-wc-set-ex-name",
        });
        const hasInCat = catalog.some((c) => c.name === item.name);
        if (!hasInCat) {
          exSel.createEl("option", { value: item.name, text: item.name });
        }
        for (const c of catalog) {
          const o = exSel.createEl("option", { value: c.name, text: c.name });
          if (c.name === item.name) o.selected = true;
        }
        exSel.onchange = () => {
          item.name = exSel.value;
          if (draft.selectedPlanItemId === item.id) {
            draft.selectedExName = item.name;
          }
          this.plugin.requestSaveSettings();
          void this.refreshAll();
        };

        const wInp = row.createEl("input", {
          cls: "my-wc-set-num",
          attr: {
            type: "number",
            step: "0.5",
            min: "0",
            placeholder: "+кг",
            title: "Доп. вес (кг)",
            value: String(item.weight),
          },
        });
        wInp.oninput = () => {
          const n = Number(wInp.value);
          if (Number.isFinite(n) && n >= 0) {
            item.weight = n;
            if (draft.selectedPlanItemId === item.id) {
              draft.customWeight = n;
            }
            this.plugin.requestSaveSettings();
          }
        };

        const setsInp = row.createEl("input", {
          cls: "my-wc-set-num",
          attr: {
            type: "number",
            min: "1",
            placeholder: "Подх.",
            title: "Запланировано подходов",
            value: String(item.sets),
          },
        });
        setsInp.oninput = () => {
          const n = Math.round(Number(setsInp.value));
          if (Number.isFinite(n) && n >= 1) {
            item.sets = n;
            this.plugin.requestSaveSettings();
          }
        };

        const targetInp = row.createEl("input", {
          cls: "my-wc-set-target",
          attr: {
            type: "text",
            placeholder: "Цель (MAX, 8–10)",
            title: "Цель на подход",
            value: item.target,
          },
        });
        targetInp.oninput = () => {
          item.target = targetInp.value.trim() || "MAX";
          this.plugin.requestSaveSettings();
        };

        const restInp = row.createEl("input", {
          cls: "my-wc-set-num",
          attr: {
            type: "number",
            min: "5",
            step: "15",
            placeholder: "Отдых",
            title: "Отдых в секундах",
            value: String(item.rest),
          },
        });
        restInp.oninput = () => {
          const n = Math.round(Number(restInp.value));
          if (Number.isFinite(n) && n >= 5) {
            item.rest = n;
            if (draft.selectedPlanItemId === item.id) {
              draft.restDurationSec = n;
            }
            this.plugin.requestSaveSettings();
          }
        };

        const upBtn = row.createEl("button", {
          cls: "my-wc-btn",
          text: "↑",
          attr: { type: "button", title: "Выше" },
        });
        upBtn.disabled = idx === 0;
        upBtn.onclick = () => {
          if (idx <= 0) return;
          const prev = draft.plannedExercises[idx - 1]!;
          draft.plannedExercises[idx - 1] = item;
          draft.plannedExercises[idx] = prev;
          this.plugin.requestSaveSettings();
          void this.refreshAll();
        };

        const downBtn = row.createEl("button", {
          cls: "my-wc-btn",
          text: "↓",
          attr: { type: "button", title: "Ниже" },
        });
        downBtn.disabled = idx === draft.plannedExercises.length - 1;
        downBtn.onclick = () => {
          if (idx >= draft.plannedExercises.length - 1) return;
          const next = draft.plannedExercises[idx + 1]!;
          draft.plannedExercises[idx + 1] = item;
          draft.plannedExercises[idx] = next;
          this.plugin.requestSaveSettings();
          void this.refreshAll();
        };

        const delBtn = row.createEl("button", {
          cls: "my-wc-btn",
          text: "✕",
          attr: { type: "button", title: "Удалить из плана" },
        });
        delBtn.onclick = () => {
          draft.plannedExercises.splice(idx, 1);
          if (draft.selectedPlanItemId === item.id) {
            const fallback = draft.plannedExercises[0];
            draft.selectedPlanItemId = fallback?.id ?? "";
            if (fallback) {
              draft.selectedExName = fallback.name;
              draft.customWeight = fallback.weight;
              draft.restDurationSec = fallback.rest;
            }
          }
          this.plugin.requestSaveSettings();
          void this.refreshAll();
        };
      });
    }
  }

  private renderBody(targetDateISO: string, draft: SessionDraftState): void {
    this.bodyEl.empty();

    // 1. Блок конструктора состава тренировки (работает и до старта сессии, и во время)
    this.renderWorkoutBuilderSection(targetDateISO, draft);

    // 2. Если файл сессии на выбранную дату ещё не создан — кнопка старта
    if (!this.activeSession) {
      const startBox = this.bodyEl.createDiv("my-wc-empty-box");
      const startBtn = startBox.createEl("button", {
        cls: "mod-cta my-wc-primary-btn",
        text: `▶ Начать тренировку на ${formatDateWithWeekdayRu(targetDateISO)}`,
        attr: { type: "button" },
      });
      startBtn.onclick = async () => {
        startBtn.disabled = true;
        this.plugin.timer.unlockAudioOnUserGesture();
        try {
          const title =
            draft.customTitle ||
            formatDefaultSessionTitle(targetDateISO, draft.plannedExercises);
          const file = await createOrOpenWorkoutSessionFile(
            this.app,
            this.plugin.settings,
            targetDateISO,
            title
          );
          // Переносим черновик с ключа `date:YYYY-MM-DD` на путь созданного файла
          this.plugin.settings.draftBySession[file.path] = draft;
          delete this.plugin.settings.draftBySession[`date:${targetDateISO}`];
          this.plugin.settings.pinnedSessionPath = file.path;
          this.isBuilderExpanded = false;
          this.plugin.requestSaveSettings();
          new Notice(`Тренировка начата: ${title}`);
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
    const catalog = this.plugin.programStore.getCatalog();
    const activePlanItem =
      draft.plannedExercises.find((p) => p.id === draft.selectedPlanItemId) ??
      null;
    const selectedExName =
      activePlanItem?.name ||
      draft.selectedExName ||
      catalog[0]?.name ||
      "Подтягивания";
    const exMeta = getExerciseMeta(selectedExName, this.plugin.programStore);

    // 3. Карточка логгера подходов
    const loggerCard = this.bodyEl.createDiv("my-wc-logger-card");

    const exRow = loggerCard.createDiv("my-wc-ex-row");
    const exSelect = exRow.createEl("select", {
      cls: "dropdown my-wc-ex-select",
    });

    if (draft.plannedExercises.length > 0) {
      const planGroup = exSelect.createEl("optgroup", {
        attr: { label: "По плану тренировки" },
      });
      for (const p of draft.plannedExercises) {
        const done = this.countDoneSetsForPlanItem(session, p);
        const wLabel = p.weight > 0 ? `+${p.weight} кг` : "свой вес";
        const o = planGroup.createEl("option", {
          value: `plan:${p.id}`,
          text: `${p.name} (${wLabel} · ${done}/${p.sets} подх. · цель ${p.target})`,
        });
        if (activePlanItem && activePlanItem.id === p.id) {
          o.selected = true;
        }
      }
    }

    const catGroup = exSelect.createEl("optgroup", {
      attr: { label: "Все упражнения каталога" },
    });
    for (const c of catalog) {
      const o = catGroup.createEl("option", {
        value: `cat:${c.name}`,
        text: `${c.name} (${c.unit})`,
      });
      if (!activePlanItem && c.name === selectedExName) {
        o.selected = true;
      }
    }

    exSelect.onchange = () => {
      const val = exSelect.value;
      if (val.startsWith("plan:")) {
        const id = val.slice(5);
        const found = draft.plannedExercises.find((p) => p.id === id);
        if (found) {
          draft.selectedPlanItemId = found.id;
          draft.selectedExName = found.name;
          draft.customWeight = found.weight;
          draft.restDurationSec = found.rest;
        }
      } else if (val.startsWith("cat:")) {
        const name = val.slice(4);
        draft.selectedPlanItemId = "";
        draft.selectedExName = name;
      }
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
      const prText =
        this.prevRef.allTimeBestForExactWeight > 0
          ? ` · рекорд на этом весе: ${this.prevRef.allTimeBestForExactWeight} ${exMeta.unit}`
          : "";
      refBar.setText(
        `В прошлый раз (${formatShortDateRu(this.prevRef.dateISO)}, ${wStr}): ${this.prevRef.sets.join(" · ")} ${exMeta.unit}${prText}`
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
    const targetHint = activePlanItem ? ` · цель ${activePlanItem.target}` : "";
    const progressHint = activePlanItem
      ? ` · подход ${Math.min(activePlanItem.sets, this.countDoneSetsForPlanItem(session, activePlanItem) + 1)} из ${activePlanItem.sets}`
      : "";
    repsBox.createDiv({
      cls: "my-wc-stepper-label",
      text:
        (exMeta.field === "секунды" ? "Секунды" : "Повторения") +
        targetHint +
        progressHint,
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
        new Notice("Укажи значение от 1 до 600.");
        return;
      }
      const weightVal = Math.max(
        0,
        Number(String(wInput.value).replace(",", ".")) || 0
      );

      submitBtn.disabled = true;
      try {
        // Проверяем, побит ли рекорд на этом весе
        const prevBestOnSameWeight =
          this.prevRef &&
          Math.abs(this.prevRef.weight - weightVal) < 0.01
            ? this.prevRef.allTimeBestForExactWeight
            : 0;
        const currentSessionBest = session.loggedSets
          .filter(
            (s) =>
              s.name === selectedExName &&
              Math.abs(s.weight - weightVal) < 0.01
          )
          .reduce((m, s) => Math.max(m, s.reps), 0);
        const baselineBest = Math.max(prevBestOnSameWeight, currentSessionBest);
        const isNewRecord = baselineBest > 0 && repsVal > baselineBest;

        const restToStart = draft.restDurationSec || 120;

        await appendSetToWorkoutFile(
          this.app,
          this.plugin.settings,
          this.plugin.programStore,
          session,
          selectedExName,
          repsVal,
          weightVal,
          "Основной"
        );

        draft.customWeight = weightVal;
        draft.draftReps = repsVal;

        // Автопереход к следующему упражнению плана, если все подходы текущего выполнены
        let switchedToNextMsg = "";
        if (activePlanItem) {
          const doneNow =
            this.countDoneSetsForPlanItem(session, activePlanItem) + 1;
          if (doneNow >= activePlanItem.sets) {
            const curIdx = draft.plannedExercises.findIndex(
              (p) => p.id === activePlanItem.id
            );
            const nextItem = draft.plannedExercises
              .slice(curIdx + 1)
              .find(
                (p) => this.countDoneSetsForPlanItem(session, p) < p.sets
              );
            if (nextItem) {
              draft.selectedPlanItemId = nextItem.id;
              draft.selectedExName = nextItem.name;
              draft.customWeight = nextItem.weight;
              draft.restDurationSec = nextItem.rest;
              switchedToNextMsg = ` · далее: ${nextItem.name}`;
            }
          }
        }

        this.plugin.timer.start(session.path, restToStart);

        const updatedSession = await hydrateWorkoutSession(this.app, session);
        const lastLogged =
          updatedSession.loggedSets[updatedSession.loggedSets.length - 1];
        this.lastRecordSetLineIndex =
          isNewRecord && lastLogged ? lastLogged.lineIndex : null;

        const recordBadge = isNewRecord ? " 🏆 НОВЫЙ РЕКОРД!" : "";
        new Notice(
          `Записано: ${selectedExName} — ${repsVal} ${exMeta.unit}` +
            (weightVal > 0 ? ` (+${weightVal} кг)` : "") +
            recordBadge +
            switchedToNextMsg
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

    // 4. Суммарный объём и список выполненных подходов за сессию
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
          session.dateISO || targetDateISO
        );
        await this.app.fileManager.processFrontMatter(
          session.file,
          (fm: Record<string, unknown>) => {
            fm[WORKOUT_KEYS.durationMin] = dur;
          }
        );
        await syncWorkoutHabitToDiary(
          this.app,
          this.plugin.settings,
          session.dateISO || targetDateISO
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
      // Строка суммарного объёма по упражнениям за сессию
      const totalsByEx = new Map<string, { sum: number; unit: string }>();
      for (const s of session.loggedSets) {
        const m = getExerciseMeta(s.name, this.plugin.programStore);
        const cur = totalsByEx.get(s.name) ?? { sum: 0, unit: m.unit };
        cur.sum += s.reps;
        totalsByEx.set(s.name, cur);
      }
      const volumeSummary = [...totalsByEx.entries()]
        .map(([n, v]) => `${n}: ${v.sum} ${v.unit}`)
        .join(" · ");
      setsSection.createDiv({
        cls: "my-wc-volume-summary",
        text: `Объём за сессию: ${volumeSummary}`,
      });

      const pillsList = setsSection.createDiv("my-wc-sets-list");
      session.loggedSets.forEach((s, idx) => {
        const meta = getExerciseMeta(s.name, this.plugin.programStore);
        const wText = s.weight > 0 ? ` +${s.weight} кг` : "";
        const isPR = this.lastRecordSetLineIndex === s.lineIndex;
        const pill = pillsList.createDiv(
          "my-wc-set-pill" + (isPR ? " is-record" : "")
        );
        pill.createSpan({
          text: `${idx + 1}. ${s.name}: ${s.reps} ${meta.unit}${wText}${isPR ? " 🏆" : ""}`,
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
