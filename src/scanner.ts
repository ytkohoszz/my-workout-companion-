import { App, TFile, normalizePath } from "obsidian";
import {
  DEFAULT_SCHEDULE,
  DayProgramSpec,
  EXERCISES_CATALOG,
  ExerciseCatalogItem,
  ExerciseFieldKind,
  HydratedWorkoutSession,
  LoggedWorkoutSet,
  MANUAL_HABITS_PREFIX,
  WORKOUT_KEYS,
  WORKOUT_TYPE_VALUE,
  WorkoutPluginSettings,
  WorkoutSessionSummary,
} from "./types";

const SET_LINE_REGEX =
  /-\s*\(упражнение::\s*([^)]+)\)\s*\((повторы|секунды)::\s*(\d+(?:[.,]\d+)?)\)\s*\(доп_вес_кг::\s*([\d.,]+)\)\s*\(вариант::\s*([^)]+)\)/;

const CATALOG_MAP = new Map<string, ExerciseCatalogItem>(
  EXERCISES_CATALOG.map((e) => [e.name, e])
);

export function getExerciseMeta(name: string): ExerciseCatalogItem {
  return (
    CATALOG_MAP.get(name) ?? {
      name,
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

export function yesterdayLocalISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
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

export function resolveProgramDay(
  fm: Record<string, unknown>,
  fallbackDateISO: string
): number {
  const explicit = readNum(fm[WORKOUT_KEYS.programDay]);
  if (explicit && DEFAULT_SCHEDULE[explicit]) return explicit;

  const title = readStr(fm[WORKOUT_KEYS.title]);
  if (title) {
    for (const [k, prog] of Object.entries(DEFAULT_SCHEDULE)) {
      if (prog.title === title) return Number(k);
    }
    const low = title.toLowerCase();
    const prefixes: Array<[string, number]> = [
      ["понедельник", 1],
      ["вторник", 2],
      ["среда", 3],
      ["четверг", 4],
      ["пятница", 5],
      ["суббота", 6],
      ["воскресенье", 7],
    ];
    for (const [pref, dNum] of prefixes) {
      if (low.startsWith(pref)) return dNum;
    }
  }

  return isoWeekdayOf(fallbackDateISO || todayLocalISO());
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
    const isWorkoutByFm = fm && readStr(fm[WORKOUT_KEYS.type]) === WORKOUT_TYPE_VALUE;
    const isWorkoutByName = /^Тренировка\s+\d{4}-\d{2}-\d{2}$/i.test(file.basename);
    if (!isWorkoutByFm && !isWorkoutByName) continue;

    const fallbackDate = extractISODate(
      file.basename.replace(/^Тренировка\s+/i, "")
    );
    const dateISO =
      (fm ? extractISODate(fm[WORKOUT_KEYS.date]) : "") || fallbackDate;
    const programDay = resolveProgramDay(fm ?? {}, dateISO);
    const durationMin = fm ? readNum(fm[WORKOUT_KEYS.durationMin]) : null;
    const startStr = fm ? readStr(fm[WORKOUT_KEYS.start]) : "";
    const title =
      (fm ? readStr(fm[WORKOUT_KEYS.title]) : "") ||
      DEFAULT_SCHEDULE[programDay]?.title ||
      file.basename;

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

export interface PreviousExerciseReference {
  dateISO: string;
  sets: number[];
  best: number;
  lastReps: number;
  weight: number;
}

/**
 * Находит последнюю прошлую тренировку, где выполнялось это упражнение (с тем же весом или вообще),
 * чтобы предзаполнить поле повторений и показать ориентир.
 */
export async function findPreviousExerciseResult(
  app: App,
  allSessions: WorkoutSessionSummary[],
  currentSessionPath: string,
  exerciseName: string,
  targetWeight: number
): Promise<PreviousExerciseReference | null> {
  const candidates = allSessions
    .filter((s) => s.path !== currentSessionPath)
    .slice(0, 25);

  let fallbackOtherWeight: PreviousExerciseReference | null = null;

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

    const exactWeightSets = sets.filter(
      (s) => Math.abs(s.weight - targetWeight) < 0.01
    );
    if (exactWeightSets.length > 0) {
      const vals = exactWeightSets.map((s) => s.reps);
      return {
        dateISO: sess.dateISO,
        sets: vals,
        best: Math.max(...vals),
        lastReps: vals[0] ?? 10,
        weight: targetWeight,
      };
    }

    if (!fallbackOtherWeight) {
      const firstWeight = sets[0]?.weight ?? 0;
      const sameFirst = sets
        .filter((s) => Math.abs(s.weight - firstWeight) < 0.01)
        .map((s) => s.reps);
      fallbackOtherWeight = {
        dateISO: sess.dateISO,
        sets: sameFirst,
        best: Math.max(...sameFirst),
        lastReps: sameFirst[0] ?? 10,
        weight: firstWeight,
      };
    }
  }

  return fallbackOtherWeight;
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

/**
 * Синхронизирует `тренировка: true` в заметку ежедневника по правилу health.js:
 * сначала ищет `Ежедневник/YYYY-MM-DD.md`, затем любую заметку в папке `Ежедневник` с `дата: YYYY-MM-DD`.
 * Если заметки за эту дату ещё нет — создаёт её.
 */
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
  program: DayProgramSpec
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
  const lines = [
    "---",
    `${WORKOUT_KEYS.type}: ${WORKOUT_TYPE_VALUE}`,
    `${WORKOUT_KEYS.date}: "${dateISO}"`,
    `${WORKOUT_KEYS.start}: "${timeNow}"`,
    `${WORKOUT_KEYS.title}: ${JSON.stringify(program.title)}`,
    `${WORKOUT_KEYS.programDay}: ${program.dayNumber}`,
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
  session: HydratedWorkoutSession,
  exerciseName: string,
  repsOrSec: number,
  weightKg: number,
  variant = "Основной"
): Promise<void> {
  const meta = getExerciseMeta(exerciseName);
  const curContent = await app.vault.read(session.file);
  const prefix =
    curContent.length > 0 && !curContent.endsWith("\n") ? "\n" : "";
  const line = `${prefix}- (упражнение:: ${exerciseName}) (${meta.field}:: ${repsOrSec}) (доп_вес_кг:: ${weightKg}) (вариант:: ${variant})\n`;
  await app.vault.append(session.file, line);
  await syncWorkoutHabitToDiary(app, settings, session.dateISO || todayLocalISO());
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
  fallbackMin: number | null
): number {
  if (/^\d{2}:\d{2}$/.test(startStr)) {
    const hh = Number(startStr.slice(0, 2));
    const mm = Number(startStr.slice(3, 5));
    if (Number.isInteger(hh) && Number.isInteger(mm)) {
      const now = new Date();
      const nowTotal = now.getHours() * 60 + now.getMinutes();
      const startTotal = hh * 60 + mm;
      let diff = nowTotal - startTotal;
      if (diff < 0) diff += 1440;
      if (diff > 0 && diff <= 600) return diff;
    }
  }
  return fallbackMin && fallbackMin > 0 ? fallbackMin : 60;
}