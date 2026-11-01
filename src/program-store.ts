import { App, normalizePath } from "obsidian";
import {
  ExerciseCatalogItem,
  PlannedExerciseItem,
  ProgramStoreData,
  WorkoutTemplate,
  cloneDefaultCatalog,
  cloneDefaultTemplates,
  makePlanItemId,
} from "./types";

interface LegacyProgramExercise {
  name?: unknown;
  sets?: unknown;
  weight?: unknown;
  target?: unknown;
  rest?: unknown;
}

interface LegacyDayProgram {
  title?: unknown;
  note?: unknown;
  isRestDay?: unknown;
  exercises?: unknown;
}

function sanitizePlannedExercise(raw: unknown): PlannedExerciseItem | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const name = typeof e.name === "string" ? e.name.trim() : "";
  if (!name) return null;
  const weight =
    typeof e.weight === "number" && Number.isFinite(e.weight) && e.weight >= 0
      ? Math.round(e.weight * 2) / 2
      : 0;
  const sets =
    typeof e.sets === "number" && Number.isFinite(e.sets) && e.sets >= 1
      ? Math.round(e.sets)
      : 4;
  const target =
    typeof e.target === "string" && e.target.trim() ? e.target.trim() : "MAX";
  const rest =
    typeof e.rest === "number" && Number.isFinite(e.rest) && e.rest >= 5
      ? Math.round(e.rest)
      : 120;
  const id =
    typeof e.id === "string" && e.id.trim() ? e.id.trim() : makePlanItemId();
  return { id, name, weight, sets, target, rest };
}

function sanitizeCatalog(raw: unknown): ExerciseCatalogItem[] {
  const defaults = cloneDefaultCatalog();
  if (!Array.isArray(raw) || raw.length === 0) return defaults;

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
      isCustom: Boolean(c.isCustom),
    });
  }

  // Гарантируем, что базовые упражнения (включая «Жим на брусьях») присутствуют
  for (const def of defaults) {
    if (!seen.has(def.name.toLowerCase())) {
      seen.add(def.name.toLowerCase());
      out.push({ ...def });
    }
  }

  return out;
}

function sanitizeTemplates(raw: unknown): WorkoutTemplate[] {
  if (!Array.isArray(raw)) return cloneDefaultTemplates();
  const out: WorkoutTemplate[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const t = item as Record<string, unknown>;
    const name = typeof t.name === "string" ? t.name.trim() : "";
    if (!name) continue;
    const id =
      typeof t.id === "string" && t.id.trim()
        ? t.id.trim()
        : "tpl_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
    const note = typeof t.note === "string" ? t.note.trim() : undefined;
    const exercises = Array.isArray(t.exercises)
      ? t.exercises
          .map(sanitizePlannedExercise)
          .filter((x): x is PlannedExerciseItem => x !== null)
      : [];
    if (exercises.length > 0) {
      out.push({ id, name, note, exercises });
    }
  }
  return out;
}

/**
 * Конвертирует старое расписание по дням недели (v0.2.0 schedule) в список шаблонов,
 * группируя подряд идущие серии одного упражнения с тем же весом.
 */
export function convertLegacyScheduleToTemplates(
  rawSchedule: unknown
): WorkoutTemplate[] {
  if (!rawSchedule || typeof rawSchedule !== "object") {
    return cloneDefaultTemplates();
  }
  const map = rawSchedule as Record<string, unknown>;
  const templates: WorkoutTemplate[] = [];

  for (let d = 1; d <= 7; d++) {
    const dayObj = (map[String(d)] ?? map[d]) as LegacyDayProgram | undefined;
    if (!dayObj || typeof dayObj !== "object") continue;
    if (dayObj.isRestDay === true) continue;
    const rawExs = Array.isArray(dayObj.exercises)
      ? (dayObj.exercises as LegacyProgramExercise[])
      : [];
    if (rawExs.length === 0) continue;

    const merged: PlannedExerciseItem[] = [];
    for (const rx of rawExs) {
      const parsed = sanitizePlannedExercise(rx);
      if (!parsed) continue;
      const last = merged[merged.length - 1];
      if (
        last &&
        last.name === parsed.name &&
        Math.abs(last.weight - parsed.weight) < 0.01 &&
        last.target === parsed.target
      ) {
        last.sets += parsed.sets;
      } else {
        merged.push(parsed);
      }
    }

    if (merged.length === 0) continue;
    const rawTitle = typeof dayObj.title === "string" ? dayObj.title.trim() : "";
    const cleanName = rawTitle.includes("·")
      ? rawTitle.split("·").slice(1).join("·").trim() || rawTitle
      : rawTitle || `Шаблон дня ${d}`;
    const note = typeof dayObj.note === "string" ? dayObj.note.trim() : undefined;

    templates.push({
      id: `tpl_migrated_day_${d}`,
      name: cleanName,
      note,
      exercises: merged,
    });
  }

  return templates.length > 0 ? templates : cloneDefaultTemplates();
}

export class ProgramStore {
  private app: App;
  private filePath: string;
  private data: ProgramStoreData;
  private saveTimer: number | null = null;

  constructor(app: App, pluginDir: string) {
    this.app = app;
    this.filePath = normalizePath(`${pluginDir}/program.json`);
    this.data = {
      version: 2,
      catalog: cloneDefaultCatalog(),
      templates: cloneDefaultTemplates(),
    };
  }

  async load(legacySettingsRaw?: unknown): Promise<void> {
    const adapter = this.app.vault.adapter;
    let loadedFromDisk = false;

    try {
      if (await adapter.exists(this.filePath)) {
        const rawText = await adapter.read(this.filePath);
        const parsed = JSON.parse(rawText) as Record<string, unknown>;
        if (parsed && typeof parsed === "object") {
          const catalog = sanitizeCatalog(parsed.catalog);
          let templates: WorkoutTemplate[];
          if (Array.isArray(parsed.templates)) {
            templates = sanitizeTemplates(parsed.templates);
          } else if (parsed.schedule) {
            templates = convertLegacyScheduleToTemplates(parsed.schedule);
          } else {
            templates = cloneDefaultTemplates();
          }
          this.data = { version: 2, catalog, templates };
          loadedFromDisk = true;
        }
      }
    } catch {
      loadedFromDisk = false;
    }

    if (!loadedFromDisk && legacySettingsRaw && typeof legacySettingsRaw === "object") {
      const leg = legacySettingsRaw as Record<string, unknown>;
      const catalog = sanitizeCatalog(leg.catalog);
      const templates = leg.schedule
        ? convertLegacyScheduleToTemplates(leg.schedule)
        : cloneDefaultTemplates();
      this.data = { version: 2, catalog, templates };
      await this.saveNow();
    } else if (!loadedFromDisk) {
      await this.saveNow();
    }
  }

  getCatalog(): readonly ExerciseCatalogItem[] {
    return this.data.catalog;
  }

  getTemplates(): readonly WorkoutTemplate[] {
    return this.data.templates;
  }

  findExercise(name: string): ExerciseCatalogItem | undefined {
    const low = name.trim().toLowerCase();
    return this.data.catalog.find((c) => c.name.toLowerCase() === low);
  }

  addCustomExercise(
    name: string,
    field: "повторы" | "секунды"
  ): ExerciseCatalogItem | null {
    const clean = name.replace(/\s+/g, " ").trim();
    if (!clean) return null;
    const existing = this.findExercise(clean);
    if (existing) return existing;

    const item: ExerciseCatalogItem = {
      name: clean,
      field,
      unit: field === "секунды" ? "с" : "повт.",
      isCustom: true,
    };
    this.data.catalog.push(item);
    this.requestSave();
    return item;
  }

  removeExerciseFromCatalog(name: string): boolean {
    const low = name.trim().toLowerCase();
    const idx = this.data.catalog.findIndex((c) => c.name.toLowerCase() === low);
    if (idx === -1) return false;
    this.data.catalog.splice(idx, 1);
    this.requestSave();
    return true;
  }

  saveTemplate(
    name: string,
    exercises: PlannedExerciseItem[],
    note?: string
  ): WorkoutTemplate | null {
    const cleanName = name.replace(/\s+/g, " ").trim();
    if (!cleanName || exercises.length === 0) return null;

    const cleanExs = exercises.map((e) => ({
      id: makePlanItemId(),
      name: e.name,
      weight: e.weight,
      sets: e.sets,
      target: e.target || "MAX",
      rest: e.rest || 120,
    }));

    const existing = this.data.templates.find(
      (t) => t.name.toLowerCase() === cleanName.toLowerCase()
    );
    if (existing) {
      existing.name = cleanName;
      existing.note = note?.trim() || existing.note;
      existing.exercises = cleanExs;
      this.requestSave();
      return existing;
    }

    const created: WorkoutTemplate = {
      id: "tpl_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6),
      name: cleanName,
      note: note?.trim() || undefined,
      exercises: cleanExs,
    };
    this.data.templates.push(created);
    this.requestSave();
    return created;
  }

  deleteTemplate(templateId: string): void {
    const idx = this.data.templates.findIndex((t) => t.id === templateId);
    if (idx !== -1) {
      this.data.templates.splice(idx, 1);
      this.requestSave();
    }
  }

  resetTemplatesToDefaults(): void {
    this.data.templates = cloneDefaultTemplates();
    this.requestSave();
  }

  requestSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.saveNow();
    }, 200);
  }

  async saveNow(): Promise<void> {
    try {
      await this.app.vault.adapter.write(
        this.filePath,
        JSON.stringify(this.data, null, 2)
      );
    } catch {
      // игнорируем ошибки записи адаптера
    }
  }

  flush(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
      void this.saveNow();
    }
  }
}
