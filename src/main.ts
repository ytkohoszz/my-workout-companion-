import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import {
  ActiveRestTimerState,
  DEFAULT_SETTINGS,
  SessionDraftState,
  WorkoutPluginSettings,
} from "./types";
import { OpenWorkoutOptions, WorkoutCompanionModal } from "./modal";
import { WorkoutRestTimerService } from "./timer";

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
    selectedDay:
      typeof s.selectedDay === "number" ? s.selectedDay : 0,
    viewMode: s.viewMode === "preview" ? "preview" : "session",
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

    this.addRibbonIcon("Flame", "Открыть терминал тренировки", () => {
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