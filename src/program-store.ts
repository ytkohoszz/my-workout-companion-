import { App, normalizePath } from "obsidian";
import {
  ExerciseCatalogItem,
  ProgramStoreData,
  cloneDefaultCatalog,
} from "./types";

function sanitizeCatalog(raw: unknown): ExerciseCatalogItem[] {
  const defaults = cloneDefaultCatalog();
  if (!Array.isArray(raw) || raw.length === 0) return defaults;

  const out: ExerciseCatalogItem[] = [];
  const seen = new Set<string>();
  const defaultMap = new Map(
    defaults.map((d) => [d.name.toLowerCase(), d])
  );

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const c = item as Partial<ExerciseCatalogItem>;
    const name = typeof c.name === "string" ? c.name.trim() : "";
    if (!name) continue;
    const low = name.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);

    const defMatch = defaultMap.get(low);
    const isSec = c.field === "секунды" || c.unit === "с";
    out.push({
      name,
      field: isSec ? "секунды" : "повторы",
      unit: isSec ? "с" : "повт.",
      defaultWeight:
        typeof c.defaultWeight === "number"
          ? c.defaultWeight
          : defMatch?.defaultWeight ?? 0,
      defaultSets:
        typeof c.defaultSets === "number"
          ? c.defaultSets
          : defMatch?.defaultSets ?? 4,
      defaultTarget:
        typeof c.defaultTarget === "string" && c.defaultTarget.trim()
          ? c.defaultTarget.trim()
          : defMatch?.defaultTarget ?? "MAX",
      defaultRest:
        typeof c.defaultRest === "number"
          ? c.defaultRest
          : defMatch?.defaultRest ?? 120,
      isQuickBase:
        typeof c.isQuickBase === "boolean"
          ? c.isQuickBase
          : Boolean(defMatch?.isQuickBase || c.isCustom),
      isCustom: Boolean(c.isCustom),
    });
  }

  for (const def of defaults) {
    if (!seen.has(def.name.toLowerCase())) {
      seen.add(def.name.toLowerCase());
      out.push({ ...def });
    }
  }

  return out;
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
      version: 3,
      catalog: cloneDefaultCatalog(),
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
          this.data = {
            version: 3,
            catalog: sanitizeCatalog(parsed.catalog),
          };
          loadedFromDisk = true;
        }
      }
    } catch {
      loadedFromDisk = false;
    }

    if (
      !loadedFromDisk &&
      legacySettingsRaw &&
      typeof legacySettingsRaw === "object"
    ) {
      const leg = legacySettingsRaw as Record<string, unknown>;
      this.data = {
        version: 3,
        catalog: sanitizeCatalog(leg.catalog),
      };
      await this.saveNow();
    } else if (!loadedFromDisk) {
      await this.saveNow();
    }
  }

  getCatalog(): readonly ExerciseCatalogItem[] {
    return this.data.catalog;
  }

  getQuickExercises(): readonly ExerciseCatalogItem[] {
    return this.data.catalog.filter((c) => c.isQuickBase || c.isCustom);
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
    if (existing) {
      existing.isQuickBase = true;
      this.requestSave();
      return existing;
    }

    const item: ExerciseCatalogItem = {
      name: clean,
      field,
      unit: field === "секунды" ? "с" : "повт.",
      defaultWeight: 0,
      defaultSets: 4,
      defaultTarget: "MAX",
      defaultRest: 120,
      isQuickBase: true,
      isCustom: true,
    };
    this.data.catalog.push(item);
    this.requestSave();
    return item;
  }

  toggleQuickButton(name: string, enabled: boolean): void {
    const item = this.findExercise(name);
    if (item) {
      item.isQuickBase = enabled;
      this.requestSave();
    }
  }

  removeExerciseFromCatalog(name: string): boolean {
    const low = name.trim().toLowerCase();
    const idx = this.data.catalog.findIndex(
      (c) => c.name.toLowerCase() === low
    );
    if (idx === -1) return false;
    this.data.catalog.splice(idx, 1);
    this.requestSave();
    return true;
  }

  resetCatalogToDefaults(): void {
    this.data.catalog = cloneDefaultCatalog();
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
      // игнорируем ошибки адаптера
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
