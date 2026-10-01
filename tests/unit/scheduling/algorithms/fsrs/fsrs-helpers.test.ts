import {
    default_learning_steps as defaultLearningSteps,
    default_relearning_steps as defaultRelearningSteps,
    Rating,
    State,
} from "ts-fsrs";

import { DEFAULT_SETTINGS } from "src/data/settings";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";
import {
    buildFsrsParameters,
    difficultyToEase,
    easeToDifficulty,
    formatFsrsSteps,
    formatFsrsTimestamp,
    FSRS_COMMENT_PREFIX,
    parseFsrsSteps,
    parseFsrsStepsOrDefault,
    parseFsrsTimestamp,
    reviewResponseToFsrsGrade,
    sm2ScheduleToFsrsCard,
} from "src/scheduling/algorithms/fsrs/fsrs-helpers";
import { RepItemScheduleInfoOsr } from "src/scheduling/algorithms/osr/rep-item-schedule-info-osr";
import { globalDateProvider, setupStaticDateProvider20230906 } from "src/utils/dates";

beforeAll(() => {
    setupStaticDateProvider20230906();
});

test("buildFsrsParameters", () => {
    expect(buildFsrsParameters(DEFAULT_SETTINGS)).toMatchObject({
        ["request_retention"]: DEFAULT_SETTINGS.fsrsDesiredRetention,
        ["maximum_interval"]: DEFAULT_SETTINGS.maximumInterval,
        ["enable_short_term"]: true,
        ["enable_fuzz"]: true,
        ["learning_steps"]: ["1m", "10m"],
        ["relearning_steps"]: ["10m"],
    });
});

test("buildFsrsParameters passes through fuzz and step settings", () => {
    expect(
        buildFsrsParameters({
            ...DEFAULT_SETTINGS,
            fsrsEnableFuzz: false,
            fsrsLearningSteps: "5m 1h 1d",
            fsrsRelearningSteps: "",
        }),
    ).toMatchObject({
        ["enable_fuzz"]: false,
        ["learning_steps"]: ["5m", "1h", "1d"],
        ["relearning_steps"]: [],
    });
});

test("buildFsrsParameters falls back to defaults for invalid or missing steps", () => {
    expect(
        buildFsrsParameters({
            ...DEFAULT_SETTINGS,
            fsrsEnableFuzz: undefined,
            fsrsLearningSteps: "1x 10m",
            fsrsRelearningSteps: undefined,
        }),
    ).toMatchObject({
        ["enable_fuzz"]: true,
        ["learning_steps"]: [...defaultLearningSteps],
        ["relearning_steps"]: [...defaultRelearningSteps],
    });
});

test("default step settings match ts-fsrs defaults", () => {
    expect(parseFsrsSteps(DEFAULT_SETTINGS.fsrsLearningSteps)).toEqual([...defaultLearningSteps]);
    expect(parseFsrsSteps(DEFAULT_SETTINGS.fsrsRelearningSteps)).toEqual([
        ...defaultRelearningSteps,
    ]);
});

describe("parseFsrsSteps", () => {
    test.each([
        ["1m 10m", ["1m", "10m"]],
        ["  1m   10m  ", ["1m", "10m"]],
        ["1m,10m", ["1m", "10m"]],
        ["1m, 1h, 2d", ["1m", "1h", "2d"]],
        ["15M 2H 3D", ["15m", "2h", "3d"]],
        ["10 m 1 h", ["10m", "1h"]],
        ["010m", ["10m"]],
        ["", []],
        ["   ", []],
    ])("parses %p", (input, expected) => {
        expect(parseFsrsSteps(input)).toEqual(expected);
    });

    test.each([
        "1",
        "m",
        "10",
        "0m",
        "-1m",
        "1.5h",
        "1w",
        "1m 10",
        "1m; 10m",
        "abc",
        "1mm",
        "99999999999999999999m",
    ])("rejects %p", (input) => {
        expect(parseFsrsSteps(input)).toBeNull();
    });

    test("rejects non-string input", () => {
        expect(parseFsrsSteps(undefined as unknown as string)).toBeNull();
        expect(parseFsrsSteps(10 as unknown as string)).toBeNull();
    });
});

test("parseFsrsStepsOrDefault", () => {
    expect(parseFsrsStepsOrDefault("2m", ["1m"])).toEqual(["2m"]);
    expect(parseFsrsStepsOrDefault("", ["1m"])).toEqual([]);
    expect(parseFsrsStepsOrDefault("bad", ["1m"])).toEqual(["1m"]);
    expect(parseFsrsStepsOrDefault(null, ["1m"])).toEqual(["1m"]);
    expect(parseFsrsStepsOrDefault(undefined, ["1m"])).toEqual(["1m"]);
});

test("formatFsrsSteps", () => {
    expect(formatFsrsSteps(["1m", "10m"])).toEqual("1m 10m");
    expect(formatFsrsSteps([])).toEqual("");
});

test("reviewResponseToFsrsGrade", () => {
    expect(reviewResponseToFsrsGrade(ReviewResponse.Again)).toEqual(Rating.Again);
    expect(reviewResponseToFsrsGrade(ReviewResponse.Hard)).toEqual(Rating.Hard);
    expect(reviewResponseToFsrsGrade(ReviewResponse.Good)).toEqual(Rating.Good);
    expect(reviewResponseToFsrsGrade(ReviewResponse.Easy)).toEqual(Rating.Easy);
});

test("difficulty and ease conversion are inverse enough for legacy migration", () => {
    expect(easeToDifficulty(130)).toEqual(10);
    expect(easeToDifficulty(370)).toEqual(1);
    expect(difficultyToEase(10)).toEqual(130);
    expect(difficultyToEase(1)).toEqual(370);
    expect(difficultyToEase(easeToDifficulty(250))).toBeGreaterThanOrEqual(240);
});

test("legacyScheduleToFsrsCard keeps due date and derives review state", () => {
    const legacySchedule = RepItemScheduleInfoOsr.fromDueDateStr("2023-09-10", 4, 270);
    const actual = sm2ScheduleToFsrsCard(legacySchedule, globalDateProvider.now);

    expect(actual).toMatchObject({
        state: State.Review,
        ["scheduled_days"]: 4,
        stability: 4,
        reps: 2,
        lapses: 0,
    });
    expect(new Date(actual.due).toISOString()).toContain("2023-09-10");
    expect(new Date(actual.last_review).toISOString()).toContain("2023-09-06");
});

test("FSRS timestamp helpers", () => {
    const timestamp = formatFsrsTimestamp(globalDateProvider.now);
    expect(timestamp).toEqual("2023-09-06T00:00:00.000Z");
    expect(parseFsrsTimestamp(timestamp).toDate().toISOString()).toEqual(timestamp);
    expect(parseFsrsTimestamp("-")).toBeNull();
    expect(FSRS_COMMENT_PREFIX).toEqual("fsrs");
});

test("FSRS helpers handle unsupported responses and missing legacy values", () => {
    expect(() => reviewResponseToFsrsGrade(ReviewResponse.Reset)).toThrow(
        "Unsupported FSRS response: 4",
    );
    expect(easeToDifficulty(null)).toEqual(5.5);
    expect(easeToDifficulty(undefined as never)).toEqual(5.5);
    expect(formatFsrsTimestamp(null)).toEqual("-");

    const migrated = sm2ScheduleToFsrsCard(null, globalDateProvider.now);
    expect(migrated).toMatchObject({
        ["scheduled_days"]: 1,
        difficulty: 5.5,
    });
    expect(new Date(migrated.due).toISOString()).toEqual("2023-09-06T00:00:00.000Z");
});
