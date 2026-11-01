import { App, TFile, normalizePath } from "obsidian";
import {
  DAYS_FULL,
  DAYS_SHORT,
  EXERCISES_CATALOG,
  ExerciseCatalogItem,
  ExerciseFieldKind,
  ExerciseRecordEntry,
  HydratedWorkoutSession,
  LoggedWorkoutSet,
  MANUAL_HABITS_PREFIX,
  PlannedExerciseItem,
  WORKOUT_KEYS,
  WORKOUT_TYPE_VALUE,
  WorkoutPluginSettings,
  WorkoutSessionSummary,
  makePlanItemId,
} from "./types";
import type { ProgramStore } from "./program-store";

const SET_LINE_REGEX =
  /-\s*\(упражнение::\s*([^)]+)\)\s*\((повторы|секунды)::\s*(\d+(?:[.,]\d+)?)\)\s*\(доп_вес_кг::\s*([\d.,]+)\)\s*\(вариант::\s*([^)]+)\)/;

export function getExerciseMeta(
  name: string,
  store?: ProgramStore
): ExerciseCatalogItem {
  const clean = name.trim();
  const fromStore = store?.findExercise(clean);
  if (fromStore) return fromStore;
  const fromDefault = EXERCISES_CATALOG.find(
    (e) => e.name.toLowerCase() === clean.toLowerCase()
  );
  return (
    fromDefault ?? {
      name: clean,
      unit: "повт.",
      field: "повторы",
    }
  );
}

export function todayLocalISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function currentTimeHHMM(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function isoWeekdayOf(iso: string): number {
  const parts = iso.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) {
    const day = new Date().getDay();
    return day === 0 ? 7 : day;
  }
  const dt = new Date(y, m - 1, d);
  const day = dt.getDay();
  return day === 0 ? 7 : day;
}

export function formatShortDateRu(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  return `${parts[2]}.${parts[1]}`;
}

export function formatDateWithWeekdayRu(iso: string): string {
  const wNum = isoWeekdayOf(iso);
  const wFull = DAYS_FULL[wNum - 1] ?? "Сегодня";
  const parts = iso.split("-");
  if (parts.length === 3) {
    return `${wFull}, ${parts[2]}.${parts[1]}.${parts[0]}`;
  }
  return wFull;
}

export function formatDefaultSessionTitle(
  dateISO: string,
  planned: PlannedExerciseItem[]
): string {
  const wNum = isoWeekdayOf(dateISO);
  const dayFull = DAYS_FULL[wNum - 1] ?? "Тренировка";
  const uniqueNames: string[] = [];
  for (const p of planned) {
    if (!uniqueNames.includes(p.name)) uniqueNames.push(p.name);
  }
  if (uniqueNames.length === 0) {
    return `${dayFull} · Тренировка`;
  }
  const summary = uniqueNames.slice(0, 2).join(" + ");
  return `${dayFull} · ${summary}`;
}

function readStr(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

function readNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function extractISODate(v: unknown): string {
  const s = readStr(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

export function readOptionalProgramDay(
  fm: Record<string, unknown>
): number | null {
  const explicit = readNum(fm[WORKOUT_KEYS.programDay]);
  if (explicit && explicit >= 1 && explicit <= 7) {
    return Math.round(explicit);
  }
  return null;
}

export function parseSetsFromContent(content: string): LoggedWorkoutSet[] {
  const sets: LoggedWorkoutSet[] = [];
  if (!content) return sets;
  const lines = content.split(/\r?\n/);

  lines.forEach((line, idx) => {
    const m = line.match(SET_LINE_REGEX);
    if (!m) return;
    const name = (m[1] ?? "").trim();
    const fieldRaw = (m[2] ?? "").trim();
    const field: ExerciseFieldKind =
      fieldRaw === "секунды" ? "секунды" : "повторы";
    const val = Number((m[3] ?? "").replace(",", "."));
    const weight = Number((m[4] ?? "").replace(",", "."));
    const variant = (m[5] ?? "").trim() || "Основной";
    if (
      name &&
      Number.isFinite(val) &&
      val > 0 &&
      Number.isFinite(weight) &&
      weight >= 0
    ) {
      sets.push({ lineIndex: idx, name, field, reps: val, weight, variant });
    }
  });

  return sets;
}

export function collectWorkoutSessions(
  app: App,
  settings: WorkoutPluginSettings
): WorkoutSessionSummary[] {
  const folderPrefix =
    normalizePath(settings.workoutsFolder || "Знания").replace(/\/+$/, "") + "/";
  const result: WorkoutSessionSummary[] = [];

  for (const file of app.vault.getMarkdownFiles()) {
    if (!file.path.startsWith(folderPrefix)) continue;
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    const isWorkoutByFm =
      fm && readStr(fm[WORKOUT_KEYS.type]) === WORKOUT_TYPE_VALUE;
    const isWorkoutByName = /^Тренировка\s+\d{4}-\d{2}-\d{2}$/i.test(
      file.basename
    );
    if (!isWorkoutByFm && !isWorkoutByName) continue;

    const fallbackDate = extractISODate(
      file.basename.replace(/^Тренировка\s+/i, "")
    );
    const dateISO =
      (fm ? extractISODate(fm[WORKOUT_KEYS.date]) : "") || fallbackDate;
    const programDay = fm ? readOptionalProgramDay(fm) : null;
    const durationMin = fm ? readNum(fm[WORKOUT_KEYS.durationMin]) : null;
    const startStr = fm ? readStr(fm[WORKOUT_KEYS.start]) : "";
    const title = (fm ? readStr(fm[WORKOUT_KEYS.title]) : "") || file.basename;

    result.push({
      file,
      path: file.path,
      dateISO,
      programDay,
      durationMin,
      startStr,
      title,
    });
  }

  result.sort(
    (a, b) =>
      b.dateISO.localeCompare(a.dateISO) || b.path.localeCompare(a.path, "ru")
  );
  return result;
}

export async function hydrateWorkoutSession(
  app: App,
  summary: WorkoutSessionSummary
): Promise<HydratedWorkoutSession> {
  let content = "";
  try {
    content = await app.vault.read(summary.file);
  } catch {
    content = "";
  }
  return {
    ...summary,
    loggedSets: parseSetsFromContent(content),
  };
}

export function buildPlanFromLoggedSets(
  sets: LoggedWorkoutSet[],
  defaultRestSec = 120
): PlannedExerciseItem[] {
  const map = new Map<string, PlannedExerciseItem>();
  const order: PlannedExerciseItem[] = [];

  for (const s of sets) {
    const key = `${s.name}__${s.weight}`;
    const existing = map.get(key);
    if (existing) {
      existing.sets += 1;
    } else {
      const item: PlannedExerciseItem = {
        id: makePlanItemId(),
        name: s.name,
        weight: s.weight,
        sets: 1,
        target: "MAX",
        rest: defaultRestSec,
      };
      map.set(key, item);
      order.push(item);
    }
  }
  return order;
}

export interface PreviousExerciseReference {
  dateISO: string;
  sets: number[];
  best: number;
  lastReps: number;
  weight: number;
  allTimeBestForExactWeight: number;
}

export async function findPreviousExerciseResult(
  app: App,
  allSessions: WorkoutSessionSummary[],
  currentSessionPath: string,
  exerciseName: string,
  targetWeight: number
): Promise<PreviousExerciseReference | null> {
  const candidates = allSessions.filter((s) => s.path !== currentSessionPath);

  let latestExact: { dateISO: string; sets: number[]; best: number } | null =
    null;
  let fallbackOtherWeight: {
    dateISO: string;
    sets: number[];
    best: number;
    weight: number;
  } | null = null;
  let allTimeBestExact = 0;

  for (const sess of candidates) {
    let content = "";
    try {
      content = await app.vault.cachedRead(sess.file);
    } catch {
      continue;
    }
    const sets = parseSetsFromContent(content).filter(
      (s) => s.name === exerciseName
    );
    if (sets.length === 0) continue;

    const exactSets = sets.filter(
      (s) => Math.abs(s.weight - targetWeight) < 0.01
    );
    if (exactSets.length > 0) {
      const vals = exactSets.map((s) => s.reps);
      const sessBest = Math.max(...vals);
      if (sessBest > allTimeBestExact) {
        allTimeBestExact = sessBest;
      }
      if (!latestExact) {
        latestExact = { dateISO: sess.dateISO, sets: vals, best: sessBest };
      }
    } else if (!fallbackOtherWeight) {
      const firstW = sets[0]?.weight ?? 0;
      const sameW = sets
        .filter((s) => Math.abs(s.weight - firstW) < 0.01)
        .map((s) => s.reps);
      fallbackOtherWeight = {
        dateISO: sess.dateISO,
        sets: sameW,
        best: Math.max(...sameW),
        weight: firstW,
      };
    }
  }

  if (latestExact) {
    return {
      dateISO: latestExact.dateISO,
      sets: latestExact.sets,
      best: latestExact.best,
      lastReps: latestExact.sets[0] ?? 10,
      weight: targetWeight,
      allTimeBestForExactWeight: allTimeBestExact,
    };
  }

  if (fallbackOtherWeight) {
    return {
      dateISO: fallbackOtherWeight.dateISO,
      sets: fallbackOtherWeight.sets,
      best: fallbackOtherWeight.best,
      lastReps: fallbackOtherWeight.sets[0] ?? 10,
      weight: fallbackOtherWeight.weight,
      allTimeBestForExactWeight: 0,
    };
  }

  return null;
}

export async function computeAllExerciseRecords(
  app: App,
  allSessions: WorkoutSessionSummary[],
  store?: ProgramStore
): Promise<ExerciseRecordEntry[]> {
  interface SessionGroup {
    dateISO: string;
    path: string;
    best: number;
  }

  const byKey = new Map<
    string,
    {
      name: string;
      variant: string;
      weight: number;
      unit: "повт." | "с";
      history: SessionGroup[];
    }
  >();

  for (const sess of allSessions) {
    let content = "";
    try {
      content = await app.vault.cachedRead(sess.file);
    } catch {
      continue;
    }
    const sets = parseSetsFromContent(content);
    if (sets.length === 0) continue;

    const perSessionMax = new Map<
      string,
      { name: string; variant: string; weight: number; best: number }
    >();
    for (const s of sets) {
      const key = JSON.stringify([s.name, s.variant, s.weight]);
      const prev = perSessionMax.get(key);
      if (!prev || s.reps > prev.best) {
        perSessionMax.set(key, {
          name: s.name,
          variant: s.variant,
          weight: s.weight,
          best: s.reps,
        });
      }
    }

    for (const [key, g] of perSessionMax.entries()) {
      let entry = byKey.get(key);
      if (!entry) {
        const meta = getExerciseMeta(g.name, store);
        entry = {
          name: g.name,
          variant: g.variant,
          weight: g.weight,
          unit: meta.unit,
          history: [],
        };
        byKey.set(key, entry);
      }
      entry.history.push({
        dateISO: sess.dateISO,
        path: sess.path,
        best: g.best,
      });
    }
  }

  const out: ExerciseRecordEntry[] = [];
  for (const [key, val] of byKey.entries()) {
    const latest = val.history[0];
    if (!latest) continue;
    const previous = val.history[1] ?? null;
    const allTimeBest = Math.max(...val.history.map((h) => h.best));
    out.push({
      key,
      name: val.name,
      variant: val.variant,
      weight: val.weight,
      unit: val.unit,
      allTimeBest,
      latestBest: latest.best,
      previousBest: previous ? previous.best : null,
      latestDateISO: latest.dateISO,
      latestSessionPath: latest.path,
    });
  }

  return out;
}

export async function ensureFolder(app: App, folderPath: string): Promise<void> {
  let current = "";
  for (const part of normalizePath(folderPath).split("/").filter(Boolean)) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) {
      try {
        await app.vault.createFolder(current);
      } catch {
        // уже существует
      }
    }
  }
}

export function clearManualHabitOverrideForDate(
  dateISO: string,
  habitKey: string
): void {
  try {
    const storageKey = MANUAL_HABITS_PREFIX + dateISO;
    const raw = window.localStorage?.getItem(storageKey);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed && typeof parsed === "object" && habitKey in parsed) {
      delete parsed[habitKey];
      window.localStorage?.setItem(storageKey, JSON.stringify(parsed));
    }
  } catch {
    // игнорируем
  }
}

export async function syncWorkoutHabitToDiary(
  app: App,
  settings: WorkoutPluginSettings,
  targetDateISO: string
): Promise<void> {
  if (!targetDateISO) return;
  clearManualHabitOverrideForDate(targetDateISO, WORKOUT_KEYS.diaryWorkoutFlag);

  const diaryFolder = normalizePath(settings.diaryFolder || "Ежедневник").replace(
    /\/+$/,
    ""
  );
  const directPath = normalizePath(`${diaryFolder}/${targetDateISO}.md`);
  let diaryFile: TFile | null = null;

  const directAbstract = app.vault.getAbstractFileByPath(directPath);
  if (directAbstract instanceof TFile) {
    diaryFile = directAbstract;
  } else {
    const prefix = `${diaryFolder}/`;
    for (const f of app.vault.getMarkdownFiles()) {
      if (!f.path.startsWith(prefix)) continue;
      const fm = app.metadataCache.getFileCache(f)?.frontmatter;
      if (fm && extractISODate(fm[WORKOUT_KEYS.date]) === targetDateISO) {
        diaryFile = f;
        break;
      }
    }
  }

  if (!diaryFile) {
    await ensureFolder(app, diaryFolder);
    const content = [
      "---",
      `${WORKOUT_KEYS.date}: "${targetDateISO}"`,
      `${WORKOUT_KEYS.diaryWorkoutFlag}: true`,
      "---",
      "",
    ].join("\n");
    await app.vault.create(directPath, content);
    return;
  }

  await app.fileManager.processFrontMatter(
    diaryFile,
    (fm: Record<string, unknown>) => {
      fm[WORKOUT_KEYS.diaryWorkoutFlag] = true;
    }
  );
}

export async function createOrOpenWorkoutSessionFile(
  app: App,
  settings: WorkoutPluginSettings,
  dateISO: string,
  sessionTitle: string
): Promise<TFile> {
  const folder = normalizePath(settings.workoutsFolder || "Знания").replace(
    /\/+$/,
    ""
  );
  await ensureFolder(app, folder);
  const targetPath = normalizePath(`${folder}/Тренировка ${dateISO}.md`);
  const existing = app.vault.getAbstractFileByPath(targetPath);
  if (existing instanceof TFile) {
    await syncWorkoutHabitToDiary(app, settings, dateISO);
    return existing;
  }

  const timeNow = currentTimeHHMM();
  const cleanTitle = sessionTitle.trim() || `Тренировка ${dateISO}`;
  const lines = [
    "---",
    `${WORKOUT_KEYS.type}: ${WORKOUT_TYPE_VALUE}`,
    `${WORKOUT_KEYS.date}: "${dateISO}"`,
    `${WORKOUT_KEYS.start}: "${timeNow}"`,
    `${WORKOUT_KEYS.title}: ${JSON.stringify(cleanTitle)}`,
    `${WORKOUT_KEYS.durationMin}:`,
    "---",
    "",
    "## Подходы",
    "",
  ];
  const created = await app.vault.create(targetPath, lines.join("\n"));
  await syncWorkoutHabitToDiary(app, settings, dateISO);
  return created;
}

export async function appendSetToWorkoutFile(
  app: App,
  settings: WorkoutPluginSettings,
  store: ProgramStore,
  session: HydratedWorkoutSession,
  exerciseName: string,
  repsOrSec: number,
  weightKg: number,
  variant = "Основной"
): Promise<void> {
  const meta = getExerciseMeta(exerciseName, store);
  const curContent = await app.vault.read(session.file);
  const prefix =
    curContent.length > 0 && !curContent.endsWith("\n") ? "\n" : "";
  const line = `${prefix}- (упражнение:: ${exerciseName}) (${meta.field}:: ${repsOrSec}) (доп_вес_кг:: ${weightKg}) (вариант:: ${variant})\n`;
  await app.vault.append(session.file, line);
  await syncWorkoutHabitToDiary(
    app,
    settings,
    session.dateISO || todayLocalISO()
  );
}

export async function deleteSetFromWorkoutFile(
  app: App,
  file: TFile,
  lineIndex: number
): Promise<void> {
  const raw = await app.vault.read(file);
  const lines = raw.split(/\r?\n/);
  if (lineIndex < 0 || lineIndex >= lines.length) return;
  if (!SET_LINE_REGEX.test(lines[lineIndex] ?? "")) return;
  lines.splice(lineIndex, 1);
  await app.vault.modify(file, lines.join("\n"));
}

export function computeSessionDurationMinutes(
  startStr: string,
  fallbackMin: number | null,
  sessionDateISO?: string
): number {
  if (/^\d{2}:\d{2}$/.test(startStr)) {
    const hh = Number(startStr.slice(0, 2));
    const mm = Number(startStr.slice(3, 5));
    if (
      Number.isInteger(hh) &&
      hh >= 0 &&
      hh <= 23 &&
      Number.isInteger(mm) &&
      mm >= 0 &&
      mm <= 59
    ) {
      const now = new Date();
      if (sessionDateISO && /^\d{4}-\d{2}-\d{2}$/.test(sessionDateISO)) {
        const parts = sessionDateISO.split("-").map(Number);
        const y = parts[0];
        const m = parts[1];
        const d = parts[2];
        if (y && m && d) {
          const startDt = new Date(y, m - 1, d, hh, mm, 0, 0);
          let diffMin = Math.round((now.getTime() - startDt.getTime()) / 60000);
          if (diffMin < 0) diffMin += 1440;
          if (diffMin > 0 && diffMin <= 600) return diffMin;
        }
      }
      const nowTotal = now.getHours() * 60 + now.getMinutes();
      const startTotal = hh * 60 + mm;
      let diff = nowTotal - startTotal;
      if (diff < 0) diff += 1440;
      if (diff > 0 && diff <= 600) return diff;
    }
  }
  return fallbackMin && fallbackMin > 0 ? fallbackMin : 60;
}
