import { App, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import {
  ActiveRestTimerState,
  DAYS_SHORT,
  DEFAULT_SCHEDULE,
  DEFAULT_SETTINGS,
  DayProgramSpec,
  ExerciseCatalogItem,
  ProgramExerciseSpec,
  SessionDraftState,
  WorkoutPluginSettings,
  cloneDefaultCatalog,
  cloneDefaultSchedule,
} from "./types";
import { OpenWorkoutOptions, WorkoutCompanionModal } from "./modal";
import { WorkoutRestTimerService } from "./timer";

function sanitizeProgramExercise(raw: unknown): ProgramExerciseSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Partial<ProgramExerciseSpec>;
  const name = typeof e.name === "string" ? e.name.trim() : "";
  if (!name) return null;
  const sets =
    typeof e.sets === "number" && Number.isFinite(e.sets) && e.sets > 0
      ? Math.round(e.sets)
      : 4;
  const weight =
    typeof e.weight === "number" && Number.isFinite(e.weight) && e.weight >= 0
      ? e.weight
      : 0;
  const target =
    typeof e.target === "string" && e.target.trim() ? e.target.trim() : "MAX";
  const rest =
    typeof e.rest === "number" && Number.isFinite(e.rest) && e.rest >= 5
      ? Math.round(e.rest)
      : 120;
  const spec: ProgramExerciseSpec = { name, sets, weight, target, rest };
  if (typeof e.series === "number" && Number.isFinite(e.series) && e.series > 0) {
    spec.series = Math.round(e.series);
  }
  return spec;
}

function migrateSchedule(raw: unknown): Record<number, DayProgramSpec> {
  const fallback = cloneDefaultSchedule();
  if (!raw || typeof raw !== "object") return fallback;
  const srcMap = raw as Record<string, unknown>;

  for (let d = 1; d <= 7; d++) {
    const def = DEFAULT_SCHEDULE[d]!;
    const cand = srcMap[String(d)] ?? srcMap[d];
    if (!cand || typeof cand !== "object") continue;
    const c = cand as Partial<DayProgramSpec>;

    const exercises: ProgramExerciseSpec[] = Array.isArray(c.exercises)
      ? c.exercises
          .map(sanitizeProgramExercise)
          .filter((x): x is ProgramExerciseSpec => x !== null)
      : def.exercises.map((x) => ({ ...x }));

    fallback[d] = {
      dayNumber: d,
      title:
        typeof c.title === "string" && c.title.trim()
          ? c.title.trim()
          : def.title,
      restBetweenSets:
        typeof c.restBetweenSets === "number" && c.restBetweenSets >= 5
          ? Math.round(c.restBetweenSets)
          : def.restBetweenSets,
      isRestDay:
        typeof c.isRestDay === "boolean" ? c.isRestDay : Boolean(def.isRestDay),
      isVolumePullups:
        typeof c.isVolumePullups === "boolean"
          ? c.isVolumePullups
          : Boolean(def.isVolumePullups),
      targetVolume:
        typeof c.targetVolume === "number" && c.targetVolume > 0
          ? Math.round(c.targetVolume)
          : def.targetVolume,
      note: typeof c.note === "string" ? c.note.trim() : def.note,
      exercises,
    };
  }
  return fallback;
}

function migrateCatalog(raw: unknown): ExerciseCatalogItem[] {
  if (!Array.isArray(raw) || raw.length === 0) return cloneDefaultCatalog();
  const out: ExerciseCatalogItem[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const c = item as Partial<ExerciseCatalogItem>;
    const name = typeof c.name === "string" ? c.name.trim() : "";
    if (!name) continue;
    const low = name.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    const isSec = c.field === "секунды" || c.unit === "с";
    out.push({
      name,
      field: isSec ? "секунды" : "повторы",
      unit: isSec ? "с" : "повт.",
    });
  }
  return out.length > 0 ? out : cloneDefaultCatalog();
}

function migrateSettings(raw: unknown): WorkoutPluginSettings {
  const s =
    raw && typeof raw === "object"
      ? (raw as Partial<WorkoutPluginSettings>)
      : {};

  const timerRaw =
    s.timer && typeof s.timer === "object"
      ? (s.timer as Partial<ActiveRestTimerState>)
      : {};
  const timer: ActiveRestTimerState = {
    sessionPath:
      typeof timerRaw.sessionPath === "string" ? timerRaw.sessionPath : "",
    startAt: typeof timerRaw.startAt === "number" ? timerRaw.startAt : 0,
    endAt: typeof timerRaw.endAt === "number" ? timerRaw.endAt : 0,
    durationSec:
      typeof timerRaw.durationSec === "number" && timerRaw.durationSec > 0
        ? timerRaw.durationSec
        : 120,
    notifiedEndAt:
      typeof timerRaw.notifiedEndAt === "number" ? timerRaw.notifiedEndAt : 0,
  };

  const draftBySession: Record<string, SessionDraftState> = {};
  if (s.draftBySession && typeof s.draftBySession === "object") {
    for (const [k, v] of Object.entries(
      s.draftBySession as Record<string, unknown>
    )) {
      if (v && typeof v === "object") {
        const d = v as Partial<SessionDraftState>;
        draftBySession[k] = {
          selectedExKey:
            typeof d.selectedExKey === "string" ? d.selectedExKey : "",
          customWeight:
            typeof d.customWeight === "number" ? d.customWeight : 0,
          draftReps: typeof d.draftReps === "number" ? d.draftReps : 10,
          restDurationSec:
            typeof d.restDurationSec === "number" && d.restDurationSec > 0
              ? d.restDurationSec
              : 120,
        };
      }
    }
  }

  return {
    workoutsFolder:
      typeof s.workoutsFolder === "string" && s.workoutsFolder.trim()
        ? s.workoutsFolder.trim()
        : DEFAULT_SETTINGS.workoutsFolder,
    diaryFolder:
      typeof s.diaryFolder === "string" && s.diaryFolder.trim()
        ? s.diaryFolder.trim()
        : DEFAULT_SETTINGS.diaryFolder,
    soundEnabled:
      typeof s.soundEnabled === "boolean"
        ? s.soundEnabled
        : DEFAULT_SETTINGS.soundEnabled,
    pinnedSessionPath:
      typeof s.pinnedSessionPath === "string" ? s.pinnedSessionPath : "",
    selectedDay: typeof s.selectedDay === "number" ? s.selectedDay : 0,
    viewMode: s.viewMode === "preview" ? "preview" : "session",
    schedule: migrateSchedule(s.schedule),
    catalog: migrateCatalog(s.catalog),
    timer,
    draftBySession,
  };
}

class WorkoutCompanionSettingTab extends PluginSettingTab {
  plugin: MyWorkoutCompanionPlugin;
  private editingDay = 1;
  private newCatalogName = "";
  private newCatalogField: "повторы" | "секунды" = "повторы";

  constructor(app: App, plugin: MyWorkoutCompanionPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("my-wc-settings");

    containerEl.createEl("h3", { text: "Тренировки и таймер" });

    new Setting(containerEl)
      .setName("Папка файлов тренировок")
      .setDesc("По умолчанию: Знания (файлы «Тренировка ГГГГ-ММ-ДД.md»)")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.workoutsFolder)
          .onChange((val) => {
            this.plugin.settings.workoutsFolder =
              val.trim() || DEFAULT_SETTINGS.workoutsFolder;
            this.plugin.requestSaveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Папка ежедневника")
      .setDesc("По умолчанию: Ежедневник (для автоотметки «тренировка: true»)")
      .addText((text) =>
        text.setValue(this.plugin.settings.diaryFolder).onChange((val) => {
          this.plugin.settings.diaryFolder =
            val.trim() || DEFAULT_SETTINGS.diaryFolder;
          this.plugin.requestSaveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Звуковой сигнал таймера отдыха")
      .setDesc(
        "Короткий сигнал через Web Audio API по окончании отдыха (работает при открытом экране Obsidian и включённом звуке на устройстве)"
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.soundEnabled)
          .onChange((val) => {
            this.plugin.settings.soundEnabled = val;
            this.plugin.requestSaveSettings();
          })
      );

    // ---------- Настройка недельного расписания (Пн–Вс) ----------
    containerEl.createEl("h3", { text: "Программа по дням недели" });

    const dayTabs = containerEl.createDiv("my-wc-set-days-bar");
    DAYS_SHORT.forEach((dName, idx) => {
      const dNum = idx + 1;
      const b = dayTabs.createEl("button", {
        cls: "my-wc-day-btn" + (this.editingDay === dNum ? " is-active" : ""),
        text: dName,
        attr: { type: "button" },
      });
      b.onclick = () => {
        this.editingDay = dNum;
        this.display();
      };
    });

    const dayProg =
      this.plugin.settings.schedule[this.editingDay] ??
      DEFAULT_SCHEDULE[this.editingDay]!;

    const dayBox = containerEl.createDiv("my-wc-set-card");

    new Setting(dayBox)
      .setName(`День ${this.editingDay} (${DAYS_SHORT[this.editingDay - 1]}): Заголовок`)
      .addText((text) =>
        text.setValue(dayProg.title).onChange((val) => {
          dayProg.title = val.trim() || DEFAULT_SCHEDULE[this.editingDay]!.title;
          this.plugin.requestSaveSettings();
        })
      );

    new Setting(dayBox)
      .setName("Заметка / подсказка к дню")
      .addText((text) =>
        text.setValue(dayProg.note).onChange((val) => {
          dayProg.note = val.trim();
          this.plugin.requestSaveSettings();
        })
      );

    new Setting(dayBox)
      .setName("Отдых по умолчанию (сек.) и день отдыха")
      .setDesc("Базовый отдых между подходами и переключатель полного выходного")
      .addText((text) =>
        text
          .setPlaceholder("150")
          .setValue(String(dayProg.restBetweenSets))
          .onChange((val) => {
            const n = Math.round(Number(val));
            if (Number.isFinite(n) && n >= 5) {
              dayProg.restBetweenSets = n;
              this.plugin.requestSaveSettings();
            }
          })
      )
      .addToggle((toggle) =>
        toggle
          .setTooltip("День полного восстановления (без тренировки)")
          .setValue(Boolean(dayProg.isRestDay))
          .onChange((val) => {
            dayProg.isRestDay = val;
            this.plugin.requestSaveSettings();
            this.display();
          })
      );

    new Setting(dayBox)
      .setName("Шкала объёма подтягиваний за сессию")
      .setDesc("Показывать прогресс-бар суммы подтягиваний (например, 100 за тренировку в четверг)")
      .addToggle((toggle) =>
        toggle
          .setValue(Boolean(dayProg.isVolumePullups))
          .onChange((val) => {
            dayProg.isVolumePullups = val;
            if (val && !dayProg.targetVolume) dayProg.targetVolume = 100;
            this.plugin.requestSaveSettings();
            this.display();
          })
      )
      .addText((text) =>
        text
          .setPlaceholder("100")
          .setValue(String(dayProg.targetVolume || 100))
          .onChange((val) => {
            const n = Math.round(Number(val));
            if (Number.isFinite(n) && n > 0) {
              dayProg.targetVolume = n;
              this.plugin.requestSaveSettings();
            }
          })
      );

    if (!dayProg.isRestDay) {
      dayBox.createDiv({
        cls: "my-wc-set-subtitle",
        text: "Упражнения и рабочие веса этого дня (Упражнение · Серия · Подходы · Доп. вес кг · Цель · Отдых с):",
      });

      const exListEl = dayBox.createDiv("my-wc-set-ex-list");
      dayProg.exercises.forEach((ex, idx) => {
        const row = exListEl.createDiv("my-wc-set-ex-row");

        const sel = row.createEl("select", {
          cls: "dropdown my-wc-set-ex-name",
        });
        const catalogNames = new Set(
          this.plugin.settings.catalog.map((c) => c.name)
        );
        if (!catalogNames.has(ex.name)) {
          sel.createEl("option", { value: ex.name, text: ex.name });
        }
        for (const c of this.plugin.settings.catalog) {
          const o = sel.createEl("option", { value: c.name, text: c.name });
          if (c.name === ex.name) o.selected = true;
        }
        sel.onchange = () => {
          ex.name = sel.value;
          this.plugin.requestSaveSettings();
        };

        const serInp = row.createEl("input", {
          cls: "my-wc-set-num",
          attr: {
            type: "number",
            placeholder: "Сер.",
            title: "Номер серии (необязательно)",
            value: ex.series ? String(ex.series) : "",
          },
        });
        serInp.oninput = () => {
          const n = Math.round(Number(serInp.value));
          if (Number.isFinite(n) && n > 0) ex.series = n;
          else delete ex.series;
          this.plugin.requestSaveSettings();
        };

        const setsInp = row.createEl("input", {
          cls: "my-wc-set-num",
          attr: {
            type: "number",
            placeholder: "Подх.",
            title: "Количество подходов",
            value: String(ex.sets),
          },
        });
        setsInp.oninput = () => {
          const n = Math.round(Number(setsInp.value));
          if (Number.isFinite(n) && n > 0) {
            ex.sets = n;
            this.plugin.requestSaveSettings();
          }
        };

        const wInp = row.createEl("input", {
          cls: "my-wc-set-num",
          attr: {
            type: "number",
            step: "0.5",
            placeholder: "+кг",
            title: "Дополнительный вес (кг)",
            value: String(ex.weight),
          },
        });
        wInp.oninput = () => {
          const n = Number(wInp.value);
          if (Number.isFinite(n) && n >= 0) {
            ex.weight = n;
            this.plugin.requestSaveSettings();
          }
        };

        const targetInp = row.createEl("input", {
          cls: "my-wc-set-target",
          attr: {
            type: "text",
            placeholder: "Цель (MAX, 3–5)",
            title: "Целевые повторения или время",
            value: ex.target,
          },
        });
        targetInp.oninput = () => {
          ex.target = targetInp.value.trim() || "MAX";
          this.plugin.requestSaveSettings();
        };

        const restInp = row.createEl("input", {
          cls: "my-wc-set-num",
          attr: {
            type: "number",
            placeholder: "Отдых",
            title: "Отдых (сек.)",
            value: String(ex.rest),
          },
        });
        restInp.oninput = () => {
          const n = Math.round(Number(restInp.value));
          if (Number.isFinite(n) && n >= 5) {
            ex.rest = n;
            this.plugin.requestSaveSettings();
          }
        };

        const delBtn = row.createEl("button", {
          cls: "my-wc-btn",
          text: "✕",
          attr: { type: "button", title: "Удалить строку" },
        });
        delBtn.onclick = () => {
          dayProg.exercises.splice(idx, 1);
          this.plugin.requestSaveSettings();
          this.display();
        };
      });

      const dayActions = dayBox.createDiv("my-wc-set-actions");
      const addExBtn = dayActions.createEl("button", {
        cls: "mod-cta my-wc-btn",
        text: "＋ Добавить упражнение в этот день",
        attr: { type: "button" },
      });
      addExBtn.onclick = () => {
        const firstCat = this.plugin.settings.catalog[0]?.name ?? "Подтягивания";
        dayProg.exercises.push({
          name: firstCat,
          sets: 4,
          weight: 0,
          target: "MAX",
          rest: dayProg.restBetweenSets || 120,
        });
        this.plugin.requestSaveSettings();
        this.display();
      };

      const resetDayBtn = dayActions.createEl("button", {
        cls: "my-wc-btn",
        text: "↺ Сбросить этот день к исходному",
        attr: { type: "button" },
      });
      resetDayBtn.onclick = () => {
        const def = DEFAULT_SCHEDULE[this.editingDay]!;
        this.plugin.settings.schedule[this.editingDay] = {
          dayNumber: def.dayNumber,
          title: def.title,
          restBetweenSets: def.restBetweenSets,
          isRestDay: Boolean(def.isRestDay),
          isVolumePullups: Boolean(def.isVolumePullups),
          targetVolume: def.targetVolume,
          note: def.note,
          exercises: def.exercises.map((e) => ({ ...e })),
        };
        this.plugin.requestSaveSettings();
        new Notice(`День ${DAYS_SHORT[this.editingDay - 1]} сброшен к заводскому.`);
        this.display();
      };
    }

    // ---------- Каталог упражнений ----------
    containerEl.createEl("h3", { text: "Каталог упражнений" });
    const catBox = containerEl.createDiv("my-wc-set-card");

    const catList = catBox.createDiv("my-wc-set-ex-list");
    this.plugin.settings.catalog.forEach((item, idx) => {
      const row = catList.createDiv("my-wc-set-ex-row");
      row.createSpan({
        cls: "my-wc-set-cat-name",
        text: `${item.name} (${item.field}, ${item.unit})`,
      });
      const delBtn = row.createEl("button", {
        cls: "my-wc-btn",
        text: "✕",
        attr: { type: "button", title: "Удалить из каталога" },
      });
      delBtn.onclick = () => {
        this.plugin.settings.catalog.splice(idx, 1);
        this.plugin.requestSaveSettings();
        this.display();
      };
    });

    const addCatRow = catBox.createDiv("my-wc-set-ex-row");
    const nameInp = addCatRow.createEl("input", {
      cls: "my-wc-set-target",
      attr: {
        type: "text",
        placeholder: "Новое упражнение…",
        value: this.newCatalogName,
      },
    });
    nameInp.oninput = () => {
      this.newCatalogName = nameInp.value;
    };

    const kindSel = addCatRow.createEl("select", { cls: "dropdown" });
    kindSel.createEl("option", { value: "повторы", text: "Повторения (повт.)" });
    const secOpt = kindSel.createEl("option", {
      value: "секунды",
      text: "Время (секунды, с)",
    });
    if (this.newCatalogField === "секунды") secOpt.selected = true;
    kindSel.onchange = () => {
      this.newCatalogField =
        kindSel.value === "секунды" ? "секунды" : "повторы";
    };

    const addCatBtn = addCatRow.createEl("button", {
      cls: "mod-cta my-wc-btn",
      text: "＋ В каталог",
      attr: { type: "button" },
    });
    addCatBtn.onclick = () => {
      const clean = this.newCatalogName.trim();
      if (!clean) {
        new Notice("Введи название упражнения.");
        return;
      }
      if (
        this.plugin.settings.catalog.some(
          (c) => c.name.toLowerCase() === clean.toLowerCase()
        )
      ) {
        new Notice("Такое упражнение уже есть в каталоге.");
        return;
      }
      const isSec = this.newCatalogField === "секунды";
      this.plugin.settings.catalog.push({
        name: clean,
        field: isSec ? "секунды" : "повторы",
        unit: isSec ? "с" : "повт.",
      });
      this.newCatalogName = "";
      this.plugin.requestSaveSettings();
      this.display();
    };
  }
}

export default class MyWorkoutCompanionPlugin extends Plugin {
  settings!: WorkoutPluginSettings;
  timer!: WorkoutRestTimerService;
  private saveTimer: number | null = null;

  async onload() {
    this.settings = migrateSettings(await this.loadData());
    this.timer = new WorkoutRestTimerService(this);
    this.addSettingTab(new WorkoutCompanionSettingTab(this.app, this));

    this.addRibbonIcon("flame", "Открыть терминал тренировки", () => {
      this.openWorkout();
    });

    this.registerObsidianProtocolHandler("my-workout", (params) => {
      this.openWorkout({
        sessionPath: params.session || undefined,
        dayNumber: params.day ? Number(params.day) : undefined,
      });
    });

    this.addCommand({
      id: "open-workout-companion",
      name: "Открыть терминал тренировки",
      callback: () => this.openWorkout(),
    });

    this.registerDomEvent(document, "visibilitychange", () => {
      if (document.visibilityState === "visible") {
        this.timer.checkAndSyncNow();
      }
    });
    this.registerDomEvent(window, "focus", () => {
      this.timer.checkAndSyncNow();
    });

    this.app.workspace.onLayoutReady(() => {
      this.timer.checkAndSyncNow();
    });
  }

  openWorkout(options: OpenWorkoutOptions = {}) {
    new WorkoutCompanionModal(this.app, this, options).open();
  }

  requestSaveSettings() {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.saveData(this.settings);
    }, 250);
  }

  onunload() {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.timer?.destroy();
  }
}
