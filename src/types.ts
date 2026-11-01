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

export const REST_PRESETS: readonly number[] = [60, 90, 120, 150, 180, 210];

export type ExerciseFieldKind = "повторы" | "секунды";

export interface ExerciseCatalogItem {
  name: string;
  unit: "повт." | "с";
  field: ExerciseFieldKind;
}

export interface ProgramExerciseSpec {
  name: string;
  series?: number;
  sets: number;
  weight: number;
  target: string;
  rest: number;
}

export interface DayProgramSpec {
  dayNumber: number;
  title: string;
  restBetweenSets: number;
  isRestDay?: boolean;
  isVolumePullups?: boolean;
  targetVolume?: number;
  exercises: ProgramExerciseSpec[];
  note: string;
}

export const EXERCISES_CATALOG: readonly ExerciseCatalogItem[] = [
  { name: "Выходы силой", unit: "повт.", field: "повторы" },
  { name: "Подтягивания", unit: "повт.", field: "повторы" },
  { name: "Высокие подтягивания", unit: "повт.", field: "повторы" },
  { name: "Брусья", unit: "повт.", field: "повторы" },
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

export const DEFAULT_SCHEDULE: Readonly<Record<number, DayProgramSpec>> = {
  1: {
    dayNumber: 1,
    title: "Понедельник · Выходы силой",
    restBetweenSets: 150,
    exercises: [
      { name: "Выходы силой", series: 1, sets: 4, weight: 8, target: "MAX", rest: 150 },
      { name: "Выходы силой", series: 2, sets: 4, weight: 4, target: "MAX", rest: 150 },
      { name: "Выходы силой", series: 3, sets: 4, weight: 0, target: "MAX", rest: 150 },
    ],
    note: "Разные хваты. Отдых между подходами: 2–3 мин, между сериями: 15–20 мин.",
  },
  2: {
    dayNumber: 2,
    title: "Вторник · Подтягивания с весом",
    restBetweenSets: 210,
    exercises: [
      { name: "Подтягивания", series: 1, sets: 3, weight: 16, target: "3–5", rest: 210 },
      { name: "Подтягивания", series: 2, sets: 3, weight: 16, target: "3–5", rest: 210 },
      { name: "Подтягивания", series: 3, sets: 3, weight: 16, target: "3–5", rest: 210 },
    ],
    note: "3 серии по 3 подхода. Отдых между подходами: 3–4 мин, между сериями: 10–15 мин.",
  },
  3: {
    dayNumber: 3,
    title: "Среда · Ноги",
    restBetweenSets: 120,
    exercises: [
      { name: "Приседания", sets: 4, weight: 16, target: "12–15", rest: 150 },
      { name: "Выпады", sets: 4, weight: 36, target: "10–12", rest: 120 },
      { name: "Подъёмы на носки", sets: 5, weight: 0, target: "15–20", rest: 75 },
    ],
    note: "Приседания с жилетом 16 кг, выпады с весом 36 кг. Заверши растяжкой.",
  },
  4: {
    dayNumber: 4,
    title: "Четверг · Объёмные подтягивания",
    restBetweenSets: 60,
    isVolumePullups: true,
    targetVolume: 100,
    exercises: [
      { name: "Подтягивания", series: 1, sets: 6, weight: 0, target: "6–10", rest: 60 },
      { name: "Подтягивания", series: 2, sets: 6, weight: 0, target: "6–10", rest: 60 },
      { name: "Подтягивания", series: 3, sets: 6, weight: 0, target: "6–10", rest: 60 },
    ],
    note: "3 серии по 5–6 подходов без веса. Суммарно не меньше 100 повторений. Растяжка между сериями.",
  },
  5: {
    dayNumber: 5,
    title: "Пятница · Брусья",
    restBetweenSets: 210,
    exercises: [
      { name: "Брусья", sets: 4, weight: 16, target: "MAX", rest: 210 },
      { name: "Брусья", sets: 2, weight: 0, target: "MAX", rest: 210 },
    ],
    note: "4 подхода с весом на максимум + 2 подхода без веса на максимум. Отдых 3–4 мин.",
  },
  6: {
    dayNumber: 6,
    title: "Суббота · Кольца",
    restBetweenSets: 150,
    exercises: [
      { name: "Жим на кольцах", sets: 4, weight: 0, target: "MAX", rest: 150 },
      { name: "Подтягивания на кольцах", sets: 4, weight: 0, target: "MAX", rest: 150 },
      { name: "Подводящие к выходу на кольцах", sets: 3, weight: 0, target: "MAX", rest: 150 },
      { name: "Отжимания на кольцах", sets: 4, weight: 0, target: "MAX", rest: 150 },
    ],
    note: "Жим, подтягивания, подводящие, отжимания. Отдых 2–3 мин.",
  },
  7: {
    dayNumber: 7,
    title: "Воскресенье · Восстановление",
    restBetweenSets: 120,
    isRestDay: true,
    exercises: [],
    note: "Полное восстановление. Без тренировки.",
  },
};

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
  programDay: number;
  durationMin: number | null;
  startStr: string;
  title: string;
}

export interface HydratedWorkoutSession extends WorkoutSessionSummary {
  loggedSets: LoggedWorkoutSet[];
}

export interface ActiveRestTimerState {
  sessionPath: string;
  startAt: number;
  endAt: number;
  durationSec: number;
  notifiedEndAt: number;
}

export interface SessionDraftState {
  selectedExKey: string;
  customWeight: number;
  draftReps: number;
  restDurationSec: number;
}

export interface WorkoutPluginSettings {
  workoutsFolder: string;
  diaryFolder: string;
  soundEnabled: boolean;
  pinnedSessionPath: string;
  selectedDay: number;
  viewMode: "session" | "preview";
  timer: ActiveRestTimerState;
  draftBySession: Record<string, SessionDraftState>;
}

export const DEFAULT_SETTINGS: WorkoutPluginSettings = {
  workoutsFolder: "Знания",
  diaryFolder: "Ежедневник",
  soundEnabled: true,
  pinnedSessionPath: "",
  selectedDay: 0,
  viewMode: "session",
  timer: {
    sessionPath: "",
    startAt: 0,
    endAt: 0,
    durationSec: 120,
    notifiedEndAt: 0,
  },
  draftBySession: {},
};