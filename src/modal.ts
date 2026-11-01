import { App, Modal, Notice, setIcon } from "obsidian";
import type MyWorkoutCompanionPlugin from "./main";
import {
  ActiveRestTimerState,
  ExerciseCatalogItem,
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
} from "./scanner";
import { formatSecondsMMSS } from "./timer";

export interface OpenWorkoutOptions {
  sessionPath?: string;
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

  private isBuilderExpanded = false;
  private isNewExerciseFormOpen = false;
  private newExNameDraft = "";
  private newExFieldDraft: "повторы" | "секунды" = "повторы";
  private lastRecordSetLineIndex: number | null = null;

  private headerEl!: HTMLElement;
  private timerCardEl!: HTMLElement;
  private timerTimeEl: HTMLElement | null = null;
  private timerStatusEl: HTMLElement | null = null;
  private timerFillEl: HTMLElement | null = null;
  private bodyEl!: HTMLElement;

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

    void this.refreshAll().then(() => {
      this.focusSafeContainer();
      const t1 = window.setTimeout(() => this.focusSafeContainer(), 0);
      const t2 = window.setTimeout(() => this.focusSafeContainer(), 50);
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
    this.contentEl.empty();
  }

  private getDraftKey(todayISO: string): string {
    return this.activeSession ? this.activeSession.path : `date:${todayISO}`;
  }

  private getOrCreateDraft(todayISO: string): SessionDraftState {
    const key = this.getDraftKey(todayISO);
    const existing = this.plugin.settings.draftBySession[key];
    if (existing) {
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

    const preFileDraft = this.plugin.settings.draftBySession[`date:${todayISO}`];
    if (preFileDraft && this.activeSession) {
      this.plugin.settings.draftBySession[key] = preFileDraft;
      delete this.plugin.settings.draftBySession[`date:${todayISO}`];
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
      restDurationSec: firstPlan?.rest ?? 150,
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

    this.allSessions = collectWorkoutSessions(this.app, this.plugin.settings);
    const todaySummary =
      (this.options.sessionPath
        ? this.allSessions.find((s) => s.path === this.options.sessionPath)
        : null) ??
      this.allSessions.find((s) => s.dateISO === todayISO) ??
      null;

    const hydrated = todaySummary
      ? await hydrateWorkoutSession(this.app, todaySummary)
      : null;
    if (this.closed || token !== this.renderToken) return;
    this.activeSession = hydrated;

    const draft = this.getOrCreateDraft(todayISO);

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

    if (!hydrated || draft.plannedExercises.length === 0) {
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
    this.renderHeader(todayISO, draft);
    this.renderTimerSection(draft);
    this.renderBody(todayISO, draft);
  }

  private renderHeader(todayISO: string, draft: SessionDraftState): void {
    this.headerEl.empty();

    const displayTitle =
      this.activeSession?.title ||
      formatDefaultSessionTitle(todayISO, draft.plannedExercises);

    this.headerEl.createDiv({ cls: "my-wc-title", text: displayTitle });
    this.headerEl.createDiv({
      cls: "my-wc-subtitle",
      text: `Сегодня: ${formatDateWithWeekdayRu(todayISO)}${
        this.activeSession
          ? ` · записано подходов: ${this.activeSession.loggedSets.length}`
          : " · сборка тренировки на сегодня"
      }`,
    });
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

  private addExerciseToPlan(draft: SessionDraftState, ex: ExerciseCatalogItem): void {
    const newItem: PlannedExerciseItem = {
      id: makePlanItemId(),
      name: ex.name,
      weight: ex.defaultWeight ?? 0,
      sets: ex.defaultSets ?? 4,
      target: ex.defaultTarget ?? "MAX",
      rest: ex.defaultRest ?? 150,
    };
    draft.plannedExercises.push(newItem);
    draft.selectedPlanItemId = newItem.id;
    draft.selectedExName = newItem.name;
    draft.customWeight = newItem.weight;
    draft.restDurationSec = newItem.rest;
    this.plugin.requestSaveSettings();
    void this.refreshAll();
  }

  private renderWorkoutBuilderSection(draft: SessionDraftState): void {
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
          ? `Список упражнений на сегодня · ${draft.plannedExercises.length} (${totalPlannedSets} подх.)`
          : "Список упражнений на сегодня",
    });

    const headBtns = head.createDiv("my-wc-sets-actions");
    if (draft.plannedExercises.length > 0) {
      const toggleBuilderBtn = headBtns.createEl("button", {
        cls: "my-wc-btn" + (this.isBuilderExpanded ? " is-active" : ""),
        text: this.isBuilderExpanded ? "Свернуть настройку" : "Изменить список",
        attr: { type: "button" },
      });
      toggleBuilderBtn.onclick = () => {
        this.isBuilderExpanded = !this.isBuilderExpanded;
        void this.refreshAll();
      };
    }

    // Активные упражнения сегодняшней тренировки (переключение в 1 тап)
    if (draft.plannedExercises.length > 0) {
      const chipsBar = builderCard.createDiv("my-wc-plan-chips");
      for (const item of draft.plannedExercises) {
        const done = this.countDoneSetsForPlanItem(this.activeSession, item);
        const isCurrent = draft.selectedPlanItemId === item.id;
        const isCompleted = done >= item.sets;
        const wStr = item.weight > 0 ? ` +${item.weight} кг` : " (свой вес)";
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

    if (!this.isBuilderExpanded && draft.plannedExercises.length > 0) return;

    // Блок быстрых кнопок: нажми на упражнение, чтобы добавить его в тренировку
    const quickSection = builderCard.createDiv("my-wc-quick-add-box");
    quickSection.createDiv({
      cls: "my-wc-quick-add-label",
      text: "Нажми на упражнение, чтобы добавить в сегодняшнюю тренировку:",
    });

    const quickBtnsWrap = quickSection.createDiv("my-wc-quick-add-btns");
    const quickList = this.plugin.programStore.getQuickExercises();
    for (const ex of quickList) {
      const b = quickBtnsWrap.createEl("button", {
        cls: "my-wc-quick-ex-btn",
        text: `＋ ${ex.name}`,
        attr: { type: "button" },
      });
      b.onclick = () => this.addExerciseToPlan(draft, ex);
    }

    const customExToggleBtn = quickBtnsWrap.createEl("button", {
      cls: "my-wc-quick-ex-btn is-custom" + (this.isNewExerciseFormOpen ? " is-active" : ""),
      text: "＋ Своё упражнение…",
      attr: { type: "button" },
    });
    customExToggleBtn.onclick = () => {
      this.isNewExerciseFormOpen = !this.isNewExerciseFormOpen;
      void this.refreshAll();
    };

    // Инлайн-форма создания своего упражнения
    if (this.isNewExerciseFormOpen) {
      const customBox = builderCard.createDiv("my-wc-inline-drawer");
      const exNameInp = customBox.createEl("input", {
        cls: "my-wc-set-target",
        attr: {
          type: "text",
          placeholder: "Название упражнения…",
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
        this.newExNameDraft = "";
        this.isNewExerciseFormOpen = false;
        this.addExerciseToPlan(draft, created);
        new Notice(`Упражнение «${created.name}» добавлено.`);
      };
    }

    // Список добавленных в тренировку упражнений с явными подписями над каждым полем
    if (draft.plannedExercises.length === 0) {
      builderCard.createDiv({
        cls: "my-wc-sets-empty",
        text: "Список пока пуст — выбери упражнения кнопками выше.",
      });
    } else {
      const listEl = builderCard.createDiv("my-wc-plan-cards-list");
      const catalog = this.plugin.programStore.getCatalog();

      draft.plannedExercises.forEach((item, idx) => {
        const itemCard = listEl.createDiv("my-wc-plan-item-card");

        // Верхняя строка карточки упражнения: номер + выбор упражнения + кнопки порядка и удаления
        const topBar = itemCard.createDiv("my-wc-plan-item-top");
        topBar.createSpan({
          cls: "my-wc-plan-item-num",
          text: `${idx + 1}.`,
        });

        const exSel = topBar.createEl("select", {
          cls: "dropdown my-wc-plan-item-select",
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

        const rowTools = topBar.createDiv("my-wc-plan-item-tools");
        const upBtn = rowTools.createEl("button", {
          cls: "my-wc-btn",
          text: "↑",
          attr: { type: "button", title: "Переместить выше" },
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

        const downBtn = rowTools.createEl("button", {
          cls: "my-wc-btn",
          text: "↓",
          attr: { type: "button", title: "Переместить ниже" },
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

        const delBtn = rowTools.createEl("button", {
          cls: "my-wc-btn",
          text: "✕ Убрать",
          attr: { type: "button", title: "Убрать из сегодняшней тренировки" },
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

        // Нижняя строка карточки: 4 подписанных поля (Доп. вес · Подходов · Цель · Отдых)
        const fieldsGrid = itemCard.createDiv("my-wc-plan-fields-grid");

        // Поле 1: Доп. вес (кг)
        const fWeight = fieldsGrid.createEl("label", { cls: "my-wc-labeled-field" });
        fWeight.createSpan({ cls: "my-wc-field-caption", text: "Доп. вес (кг)" });
        const wInp = fWeight.createEl("input", {
          cls: "my-wc-field-input",
          attr: {
            type: "number",
            inputmode: "decimal",
            step: "0.5",
            min: "0",
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

        // Поле 2: Подходов
        const fSets = fieldsGrid.createEl("label", { cls: "my-wc-labeled-field" });
        fSets.createSpan({ cls: "my-wc-field-caption", text: "Подходов" });
        const setsInp = fSets.createEl("input", {
          cls: "my-wc-field-input",
          attr: {
            type: "number",
            inputmode: "numeric",
            min: "1",
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

        // Поле 3: Цель повторений
        const fTarget = fieldsGrid.createEl("label", { cls: "my-wc-labeled-field" });
        fTarget.createSpan({ cls: "my-wc-field-caption", text: "Цель (MAX / 8–10)" });
        const targetInp = fTarget.createEl("input", {
          cls: "my-wc-field-input",
          attr: {
            type: "text",
            placeholder: "MAX",
            value: item.target,
          },
        });
        targetInp.oninput = () => {
          item.target = targetInp.value.trim() || "MAX";
          this.plugin.requestSaveSettings();
        };

        // Поле 4: Отдых (сек)
        const fRest = fieldsGrid.createEl("label", { cls: "my-wc-labeled-field" });
        fRest.createSpan({ cls: "my-wc-field-caption", text: "Отдых (сек)" });
        const restInp = fRest.createEl("input", {
          cls: "my-wc-field-input",
          attr: {
            type: "number",
            inputmode: "numeric",
            min: "5",
            step: "15",
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
      });
    }
  }

  private renderBody(todayISO: string, draft: SessionDraftState): void {
    this.bodyEl.empty();

    // 1. Блок списка упражнений на сегодня
    this.renderWorkoutBuilderSection(draft);

    // 2. Если файл сессии за сегодня ещё не создан — кнопка старта
    if (!this.activeSession) {
      const startBox = this.bodyEl.createDiv("my-wc-empty-box");
      const startBtn = startBox.createEl("button", {
        cls: "mod-cta my-wc-primary-btn",
        text: "▶ Начать тренировку",
        attr: { type: "button" },
      });
      startBtn.onclick = async () => {
        startBtn.disabled = true;
        this.plugin.timer.unlockAudioOnUserGesture();
        try {
          const title = formatDefaultSessionTitle(
            todayISO,
            draft.plannedExercises
          );
          const file = await createOrOpenWorkoutSessionFile(
            this.app,
            this.plugin.settings,
            todayISO,
            title
          );
          this.plugin.settings.draftBySession[file.path] = draft;
          delete this.plugin.settings.draftBySession[`date:${todayISO}`];
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

    // 3. Карточка записи подхода
    const loggerCard = this.bodyEl.createDiv("my-wc-logger-card");

    const exRow = loggerCard.createDiv("my-wc-ex-row");
    const exSelect = exRow.createEl("select", {
      cls: "dropdown my-wc-ex-select",
    });

    if (draft.plannedExercises.length > 0) {
      const planGroup = exSelect.createEl("optgroup", {
        attr: { label: "Упражнения сегодняшней тренировки" },
      });
      for (const p of draft.plannedExercises) {
        const done = this.countDoneSetsForPlanItem(session, p);
        const wLabel = p.weight > 0 ? `+${p.weight} кг` : "свой вес";
        const o = planGroup.createEl("option", {
          value: `plan:${p.id}`,
          text: `${p.name} (${wLabel} · подход ${done}/${p.sets} · цель ${p.target})`,
        });
        if (activePlanItem && activePlanItem.id === p.id) {
          o.selected = true;
        }
      }
    }

    const catGroup = exSelect.createEl("optgroup", {
      attr: { label: "Все упражнения" },
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
        const prevBestOnSameWeight =
          this.prevRef && Math.abs(this.prevRef.weight - weightVal) < 0.01
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

    // 4. Выполненные подходы за сегодня
    const setsSection = this.bodyEl.createDiv("my-wc-sets-section");
    const setsHead = setsSection.createDiv("my-wc-sets-head");
    setsHead.createSpan({
      cls: "my-wc-sets-title",
      text: `Выполнено сегодня · ${session.loggedSets.length}`,
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
        text: "Подходов сегодня пока не записано.",
      });
    } else {
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
        text: `Сумма за тренировку: ${volumeSummary}`,
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
