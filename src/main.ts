import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import {
  ActiveRestTimerState,
  DEFAULT_SETTINGS,
  PlannedExerciseItem,
  SessionDraftState,
  WorkoutPluginSettings,
  makePlanItemId,
} from "./types";
import { OpenWorkoutOptions, WorkoutCompanionModal } from "./modal";
import { WorkoutRestTimerService } from "./timer";
import { ProgramStore } from "./program-store";
import { CatalogAndTemplatesEditor } from "./schedule-editor";

function sanitizeDraftPlanList(raw: unknown): PlannedExerciseItem[] {
  if (!Array.isArray(raw)) return [];
  const out: PlannedExerciseItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    const name = typeof e.name === "string" ? e.name.trim() : "";
    if (!name) continue;
    out.push({
      id:
        typeof e.id === "string" && e.id.trim()
          ? e.id.trim()
          : makePlanItemId(),
      name,
      weight:
        typeof e.weight === "number" && Number.isFinite(e.weight) && e.weight >= 0
          ? e.weight
          : 0,
      sets:
        typeof e.sets === "number" && Number.isFinite(e.sets) && e.sets >= 1
          ? Math.round(e.sets)
          : 4,
      target:
        typeof e.target === "string" && e.target.trim()
          ? e.target.trim()
          : "MAX",
      rest:
        typeof e.rest === "number" && Number.isFinite(e.rest) && e.rest >= 5
          ? Math.round(e.rest)
          : 120,
    });
  }
  return out;
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
        const d = v as Partial<SessionDraftState> & { selectedExKey?: string };
        const fallbackName =
          typeof d.selectedExName === "string" && d.selectedExName
            ? d.selectedExName
            : typeof d.selectedExKey === "string"
              ? d.selectedExKey.split("__")[0] ?? "Подтягивания"
              : "Подтягивания";
        draftBySession[k] = {
          selectedPlanItemId:
            typeof d.selectedPlanItemId === "string"
              ? d.selectedPlanItemId
              : "",
          selectedExName: fallbackName,
          customWeight:
            typeof d.customWeight === "number" ? d.customWeight : 0,
          draftReps: typeof d.draftReps === "number" ? d.draftReps : 10,
          restDurationSec:
            typeof d.restDurationSec === "number" && d.restDurationSec > 0
              ? d.restDurationSec
              : 120,
          plannedExercises: sanitizeDraftPlanList(d.plannedExercises),
          customTitle:
            typeof d.customTitle === "string" ? d.customTitle : undefined,
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
    selectedDateISO:
      typeof s.selectedDateISO === "string" ? s.selectedDateISO : "",
    timer,
    draftBySession,
  };
}

class WorkoutCompanionSettingTab extends PluginSettingTab {
  plugin: MyWorkoutCompanionPlugin;

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

    const editorHost = containerEl.createDiv();
    new CatalogAndTemplatesEditor(this.plugin, editorHost).render();
  }
}

export default class MyWorkoutCompanionPlugin extends Plugin {
  settings!: WorkoutPluginSettings;
  programStore!: ProgramStore;
  timer!: WorkoutRestTimerService;
  private saveTimer: number | null = null;

  async onload() {
    const rawData = await this.loadData();
    this.settings = migrateSettings(rawData);

    const pluginDir =
      this.manifest.dir ||
      `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    this.programStore = new ProgramStore(this.app, pluginDir);
    await this.programStore.load(rawData);

    this.timer = new WorkoutRestTimerService(this);
    this.addSettingTab(new WorkoutCompanionSettingTab(this.app, this));

    this.addRibbonIcon("flame", "Открыть терминал тренировки", () => {
      this.openWorkout();
    });

    this.registerObsidianProtocolHandler("my-workout", (params) => {
      this.openWorkout({
        sessionPath: params.session || undefined,
        dateISO: params.date || undefined,
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
    this.programStore?.flush();
    this.timer?.destroy();
  }
}
