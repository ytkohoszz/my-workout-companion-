import type { TFile } from "obsidian";

export const WORKOUT_KEYS = {
  type: "тип",
  date: "дата",
  start: "начало",
  title: "название_тренировки",
  programDay: "день_программы",
  durationMin: "длительность_мин",
  diaryWorkoutFlag: "тренировка",
} as const;

export const WORKOUT_TYPE_VALUE = "Тренировка";
export const MANUAL_HABITS_PREFIX = "dh_today_manual_habits_v1:";

export const DAYS_SHORT: readonly string[] = [
  "Пн",
  "Вт",
  "Ср",
  "Чт",
  "Пт",
  "Сб",
  "Вс",
];

export const DAYS_FULL: readonly string[] = [
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
  "Воскресенье",
];

export const REST_PRESETS: readonly number[] = [60, 90, 120, 150, 180, 210];

export type ExerciseFieldKind = "повторы" | "секунды";

export interface ExerciseCatalogItem {
  name: string;
  unit: "повт." | "с";
  field: ExerciseFieldKind;
  defaultWeight?: number;
  defaultSets?: number;
  defaultTarget?: string;
  defaultRest?: number;
  isQuickBase?: boolean;
  isCustom?: boolean;
}

export interface PlannedExerciseItem {
  id: string;
  name: string;
  weight: number;
  sets: number;
  target: string;
  rest: number;
}

export interface ProgramStoreData {
  version: number;
  catalog: ExerciseCatalogItem[];
}

/**
 * Базовый каталог упражнений. Первые 6 с `isQuickBase: true` выводятся как быстрые кнопки
 * добавления в список сегодняшней тренировки, остальные также доступны в каталоге и для совместимости с health.js.
 */
export const EXERCISES_CATALOG: readonly ExerciseCatalogItem[] = [
  {
    name: "Выходы силой",
    unit: "повт.",
    field: "повторы",
    defaultWeight: 0,
    defaultSets: 4,
    defaultTarget: "MAX",
    defaultRest: 150,
    isQuickBase: true,
  },
  {
    name: "Подтягивания",
    unit: "повт.",
    field: "повторы",
    defaultWeight: 16,
    defaultSets: 4,
    defaultTarget: "MAX",
    defaultRest: 180,
    isQuickBase: true,
  },
  {
    name: "Брусья",
    unit: "повт.",
    field: "повторы",
    defaultWeight: 16,
    defaultSets: 4,
    defaultTarget: "MAX",
    defaultRest: 180,
    isQuickBase: true,
  },
  {
    name: "Брусья на кольцах",
    unit: "повт.",
    field: "повторы",
    defaultWeight: 0,
    defaultSets: 4,
    defaultTarget: "MAX",
    defaultRest: 150,
    isQuickBase: true,
  },
  {
    name: "Приседания",
    unit: "повт.",
    field: "повторы",
    defaultWeight: 16,
    defaultSets: 4,
    defaultTarget: "12–15",
    defaultRest: 150,
    isQuickBase: true,
  },
  {
    name: "Выпады",
    unit: "повт.",
    field: "повторы",
    defaultWeight: 36,
    defaultSets: 4,
    defaultTarget: "10–12",
    defaultRest: 120,
    isQuickBase: true,
  },
  { name: "Высокие подтягивания", unit: "повт.", field: "повторы", defaultRest: 150 },
  { name: "Жим на кольцах", unit: "повт.", field: "повторы", defaultRest: 150 },
  { name: "Подтягивания на кольцах", unit: "повт.", field: "повторы", defaultRest: 150 },
  { name: "Подводящие к выходу на кольцах", unit: "повт.", field: "повторы", defaultRest: 150 },
  { name: "Отжимания на кольцах", unit: "повт.", field: "повторы", defaultRest: 150 },
  { name: "Отжимания от пола", unit: "повт.", field: "повторы", defaultRest: 120 },
  { name: "Подъёмы на носки", unit: "повт.", field: "повторы", defaultTarget: "15–20", defaultRest: 75 },
  { name: "Вис на турнике", unit: "с", field: "секунды", defaultRest: 120 },
  { name: "Передний вис", unit: "с", field: "секунды", defaultRest: 120 },
  { name: "Уголок на турнике", unit: "с", field: "секунды", defaultRest: 120 },
  { name: "Уголок на паралетсах", unit: "с", field: "секунды", defaultRest: 120 },
];

export function makePlanItemId(): string {
  return (
    "ex_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 7)
  );
}

export function cloneDefaultCatalog(): ExerciseCatalogItem[] {
  return EXERCISES_CATALOG.map((e) => ({ ...e }));
}

export interface LoggedWorkoutSet {
  lineIndex: number;
  name: string;
  field: ExerciseFieldKind;
  reps: number;
  weight: number;
  variant: string;
}

export interface WorkoutSessionSummary {
  file: TFile;
  path: string;
  dateISO: string;
  programDay: number | null;
  durationMin: number | null;
  startStr: string;
  title: string;
}

export interface HydratedWorkoutSession extends WorkoutSessionSummary {
  loggedSets: LoggedWorkoutSet[];
}

export interface ExerciseRecordEntry {
  key: string;
  name: string;
  variant: string;
  weight: number;
  unit: "повт." | "с";
  allTimeBest: number;
  latestBest: number;
  previousBest: number | null;
  latestDateISO: string;
  latestSessionPath: string;
}

export interface ActiveRestTimerState {
  sessionPath: string;
  startAt: number;
  endAt: number;
  durationSec: number;
  notifiedEndAt: number;
}

export interface SessionDraftState {
  selectedPlanItemId: string;
  selectedExName: string;
  customWeight: number;
  draftReps: number;
  restDurationSec: number;
  plannedExercises: PlannedExerciseItem[];
}

export interface WorkoutPluginSettings {
  workoutsFolder: string;
  diaryFolder: string;
  soundEnabled: boolean;
  timer: ActiveRestTimerState;
  draftBySession: Record<string, SessionDraftState>;
}

export const DEFAULT_SETTINGS: WorkoutPluginSettings = {
  workoutsFolder: "Знания",
  diaryFolder: "Ежедневник",
  soundEnabled: true,
  timer: {
    sessionPath: "",
    startAt: 0,
    endAt: 0,
    durationSec: 120,
    notifiedEndAt: 0,
  },
  draftBySession: {},
};
