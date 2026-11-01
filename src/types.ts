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

export interface WorkoutTemplate {
  id: string;
  name: string;
  note?: string;
  exercises: PlannedExerciseItem[];
}

export interface ProgramStoreData {
  version: number;
  catalog: ExerciseCatalogItem[];
  templates: WorkoutTemplate[];
}

export const EXERCISES_CATALOG: readonly ExerciseCatalogItem[] = [
  { name: "Выходы силой", unit: "повт.", field: "повторы" },
  { name: "Подтягивания", unit: "повт.", field: "повторы" },
  { name: "Высокие подтягивания", unit: "повт.", field: "повторы" },
  { name: "Брусья", unit: "повт.", field: "повторы" },
  { name: "Жим на брусьях", unit: "повт.", field: "повторы" },
  { name: "Жим на кольцах", unit: "повт.", field: "повторы" },
  { name: "Подтягивания на кольцах", unit: "повт.", field: "повторы" },
  { name: "Подводящие к выходу на кольцах", unit: "повт.", field: "повторы" },
  { name: "Отжимания на кольцах", unit: "повт.", field: "повторы" },
  { name: "Отжимания от пола", unit: "повт.", field: "повторы" },
  { name: "Приседания", unit: "повт.", field: "повторы" },
  { name: "Выпады", unit: "повт.", field: "повторы" },
  { name: "Подъёмы на носки", unit: "повт.", field: "повторы" },
  { name: "Вис на турнике", unit: "с", field: "секунды" },
  { name: "Передний вис", unit: "с", field: "секунды" },
  { name: "Уголок на турнике", unit: "с", field: "секунды" },
  { name: "Уголок на паралетсах", unit: "с", field: "секунды" },
];

export function makePlanItemId(): string {
  return "ex_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
}

export const DEFAULT_TEMPLATES: readonly WorkoutTemplate[] = [
  {
    id: "tpl_muscle_ups",
    name: "Выходы силой (лесенка веса)",
    note: "Разные хваты. Отдых между подходами: 2–3 мин, между сериями: 15–20 мин.",
    exercises: [
      { id: "mu_1", name: "Выходы силой", weight: 8, sets: 4, target: "MAX", rest: 150 },
      { id: "mu_2", name: "Выходы силой", weight: 4, sets: 4, target: "MAX", rest: 150 },
      { id: "mu_3", name: "Выходы силой", weight: 0, sets: 4, target: "MAX", rest: 150 },
    ],
  },
  {
    id: "tpl_weighted_pullups",
    name: "Тяжёлые подтягивания с весом",
    note: "3 серии по 3 подхода. Отдых между подходами: 3–4 мин.",
    exercises: [
      { id: "wp_1", name: "Подтягивания", weight: 16, sets: 9, target: "3–5", rest: 210 },
    ],
  },
  {
    id: "tpl_legs",
    name: "Ноги (приседания и выпады)",
    note: "Приседания с жилетом 16 кг, выпады с весом 36 кг. Заверши растяжкой.",
    exercises: [
      { id: "lg_1", name: "Приседания", weight: 16, sets: 4, target: "12–15", rest: 150 },
      { id: "lg_2", name: "Выпады", weight: 36, sets: 4, target: "10–12", rest: 120 },
      { id: "lg_3", name: "Подъёмы на носки", weight: 0, sets: 5, target: "15–20", rest: 75 },
    ],
  },
  {
    id: "tpl_volume_pullups",
    name: "Объёмные подтягивания (база)",
    note: "3 серии по 6 подходов без веса. Суммарно от 100 повторений.",
    exercises: [
      { id: "vp_1", name: "Подтягивания", weight: 0, sets: 18, target: "6–10", rest: 60 },
    ],
  },
  {
    id: "tpl_dips",
    name: "Брусья (вес + база)",
    note: "4 подхода с весом на максимум + 2 подхода без веса на максимум.",
    exercises: [
      { id: "dp_1", name: "Брусья", weight: 16, sets: 4, target: "MAX", rest: 210 },
      { id: "dp_2", name: "Брусья", weight: 0, sets: 2, target: "MAX", rest: 210 },
    ],
  },
  {
    id: "tpl_rings",
    name: "Гимнастические кольца",
    note: "Жим, подтягивания, подводящие, отжимания. Отдых 2–3 мин.",
    exercises: [
      { id: "rg_1", name: "Жим на кольцах", weight: 0, sets: 4, target: "MAX", rest: 150 },
      { id: "rg_2", name: "Подтягивания на кольцах", weight: 0, sets: 4, target: "MAX", rest: 150 },
      { id: "rg_3", name: "Подводящие к выходу на кольцах", weight: 0, sets: 3, target: "MAX", rest: 150 },
      { id: "rg_4", name: "Отжимания на кольцах", weight: 0, sets: 4, target: "MAX", rest: 150 },
    ],
  },
];

export function cloneDefaultCatalog(): ExerciseCatalogItem[] {
  return EXERCISES_CATALOG.map((e) => ({ ...e }));
}

export function cloneDefaultTemplates(): WorkoutTemplate[] {
  return DEFAULT_TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    note: t.note,
    exercises: t.exercises.map((e) => ({ ...e })),
  }));
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
  customTitle?: string;
}

export interface WorkoutPluginSettings {
  workoutsFolder: string;
  diaryFolder: string;
  soundEnabled: boolean;
  pinnedSessionPath: string;
  selectedDateISO: string;
  timer: ActiveRestTimerState;
  draftBySession: Record<string, SessionDraftState>;
}

export const DEFAULT_SETTINGS: WorkoutPluginSettings = {
  workoutsFolder: "Знания",
  diaryFolder: "Ежедневник",
  soundEnabled: true,
  pinnedSessionPath: "",
  selectedDateISO: "",
  timer: {
    sessionPath: "",
    startAt: 0,
    endAt: 0,
    durationSec: 120,
    notifiedEndAt: 0,
  },
  draftBySession: {},
};
