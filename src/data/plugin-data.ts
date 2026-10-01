import { DEFAULT_SETTINGS, SRSettings } from "src/data/settings";
import { SRAlgorithmType } from "src/scheduling/algorithms/base/isr-algorithm";
import { ISerializedFSRSScheduleData } from "src/scheduling/algorithms/fsrs/serialized-schedule-data";
import { ISerializedSM2ScheduleData } from "src/scheduling/algorithms/osr/serialized-schedule-data";

export interface ISerializedScheduleEntry {
    algorithm: SRAlgorithmType;
    scheduleData: ISerializedFSRSScheduleData | ISerializedSM2ScheduleData;
}

/**
 * Represents the schedule data stored in the plugin data.
 *
 * @interface ISerializedScheduleData
 */
export interface ISerializedScheduleData {
    version: number;
    noteSchedules: Record<string, ISerializedScheduleEntry | null>;
    cardSchedules: Record<string, (ISerializedScheduleEntry | null)[]>;
}

/**
 * The persisted counters of how many flashcards were reviewed on a given (review) day.
 * Used to enforce the daily limits (see src/scheduling/daily-review-limits.ts).
 *
 * @property {string} date - The review day the counters belong to ("YYYY-MM-DD"), respecting `startOfDay`.
 * @property {number} newCards - Number of new cards introduced (answered for the first time) on that day.
 * @property {number} reviews - Number of reviews of already scheduled cards done on that day.
 */
export interface IDailyReviewCounts {
    date: string;
    newCards: number;
    reviews: number;
}

export const DEFAULT_DAILY_REVIEW_COUNTS: IDailyReviewCounts = {
    date: "",
    newCards: 0,
    reviews: 0,
};

export interface PluginData {
    settings: SRSettings;
    buryDate: string;
    // hashes of card texts
    // should work as long as user doesn't modify card's text
    // which covers most of the cases
    buryList: string[];
    historyDeck: string | null;
    scheduleData: ISerializedScheduleData;
    // counters for the daily new card / review limits (reset when the review day rolls over)
    dailyReviewCounts: IDailyReviewCounts;
}

export const DEFAULT_DATA: PluginData = {
    settings: DEFAULT_SETTINGS,
    buryDate: "",
    buryList: [],
    historyDeck: null,
    scheduleData: {
        version: 1,
        noteSchedules: {},
        cardSchedules: {},
    },
    dailyReviewCounts: DEFAULT_DAILY_REVIEW_COUNTS,
};
