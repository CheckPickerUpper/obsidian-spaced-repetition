import moment from "moment";
import { State } from "ts-fsrs";

import { DEFAULT_SETTINGS } from "src/data/settings";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";
import { RepItemScheduleInfoFsrs } from "src/scheduling/algorithms/fsrs/rep-item-schedule-info-fsrs";
import { SrsAlgorithmFsrs } from "src/scheduling/algorithms/fsrs/sr-algorithm-fsrs";
import { OsrNoteGraph } from "src/scheduling/algorithms/osr/osr-note-graph";
import { RepItemScheduleInfoOsr } from "src/scheduling/algorithms/osr/rep-item-schedule-info-osr";
import { CardDueDateHistogram } from "src/scheduling/due-date-histogram";
import { setupStaticDateProvider20230906 } from "src/utils/dates";

beforeAll(() => {
    setupStaticDateProvider20230906();
});

test("creates short-term FSRS schedules for new cards", () => {
    const algorithm = new SrsAlgorithmFsrs(DEFAULT_SETTINGS);
    const result = algorithm.cardGetNewSchedule(
        ReviewResponse.Again,
        "note.md",
        new CardDueDateHistogram(),
    );

    expect(result).toBeInstanceOf(RepItemScheduleInfoFsrs);
    expect(result.interval).toEqual(0);
    expect(result.dueDateAsUnix).toBeGreaterThan(Date.parse("2023-09-06T00:00:00.000Z"));
});

test("imports legacy schedules into FSRS state on update", () => {
    const algorithm = new SrsAlgorithmFsrs(DEFAULT_SETTINGS);
    const legacySchedule = RepItemScheduleInfoOsr.fromDueDateStr("2023-09-10", 4, 270);
    const result = algorithm.cardCalcUpdatedSchedule(
        ReviewResponse.Good,
        legacySchedule,
        new CardDueDateHistogram(),
    );

    expect(result).toBeInstanceOf(RepItemScheduleInfoFsrs);
    expect(result.interval).toBeGreaterThanOrEqual(1);
    expect((result as RepItemScheduleInfoFsrs).state).toEqual(State.Review);
});

test("reset schedule returns an immediate FSRS reset state", () => {
    const algorithm = new SrsAlgorithmFsrs(DEFAULT_SETTINGS);
    const result = algorithm.cardGetResetSchedule() as RepItemScheduleInfoFsrs;

    expect(result).toBeInstanceOf(RepItemScheduleInfoFsrs);
    expect(result.interval).toEqual(0);
    expect(result.state).toEqual(State.New);
});

test("delegates note scheduling to OSR and keeps existing FSRS schedules in FSRS", () => {
    const algorithm = new SrsAlgorithmFsrs(DEFAULT_SETTINGS);
    algorithm.noteOnLoadedNote("note.md", null, 260);
    expect(algorithm.noteStats().getEaseByPath("note.md")).toEqual(260);

    const noteGraph = new OsrNoteGraph({
        getResolvedTargetLinksForNotePath: () => ({}),
    });
    expect(
        algorithm.noteCalcNewSchedule(
            "note.md",
            noteGraph,
            ReviewResponse.Good,
            new CardDueDateHistogram(),
        ),
    ).toBeInstanceOf(RepItemScheduleInfoOsr);
    expect(
        algorithm.noteCalcUpdatedSchedule(
            "note.md",
            RepItemScheduleInfoOsr.fromDueDateStr("2023-09-10", 4, 270),
            ReviewResponse.Good,
            new CardDueDateHistogram(),
        ),
    ).toBeInstanceOf(RepItemScheduleInfoOsr);

    const fsrsSchedule = new RepItemScheduleInfoFsrs(
        moment("2023-09-06T00:10:00.000Z"),
        0,
        5.5,
        0.4,
        State.Learning,
        1,
        0,
        1,
        null,
    );
    expect(
        algorithm.cardCalcUpdatedSchedule(
            ReviewResponse.Good,
            fsrsSchedule,
            new CardDueDateHistogram(),
        ),
    ).toBeInstanceOf(RepItemScheduleInfoFsrs);
});

test("uses the configured learning and relearning steps", () => {
    const algorithm = new SrsAlgorithmFsrs({
        ...DEFAULT_SETTINGS,
        fsrsLearningSteps: "3m 2h",
        fsrsRelearningSteps: "30m",
    });

    const learning = algorithm.cardGetNewSchedule(
        ReviewResponse.Again,
        "note.md",
        new CardDueDateHistogram(),
    ) as RepItemScheduleInfoFsrs;
    expect(learning.state).toEqual(State.Learning);
    expect(learning.dueDate.diff(moment("2023-09-06T00:00:00.000Z"), "minutes")).toEqual(3);

    const learningGood = algorithm.cardGetNewSchedule(
        ReviewResponse.Good,
        "note.md",
        new CardDueDateHistogram(),
    ) as RepItemScheduleInfoFsrs;
    expect(learningGood.state).toEqual(State.Learning);
    expect(learningGood.dueDate.diff(moment("2023-09-06T00:00:00.000Z"), "minutes")).toEqual(120);

    const reviewCard = new RepItemScheduleInfoFsrs(
        moment("2023-09-06T00:00:00.000Z"),
        10,
        5,
        10,
        State.Review,
        5,
        0,
        0,
        moment("2023-08-27T00:00:00.000Z"),
    );
    const relearning = algorithm.cardCalcUpdatedSchedule(
        ReviewResponse.Again,
        reviewCard,
        new CardDueDateHistogram(),
    ) as RepItemScheduleInfoFsrs;
    expect(relearning.state).toEqual(State.Relearning);
    expect(relearning.dueDate.diff(moment("2023-09-06T00:00:00.000Z"), "minutes")).toEqual(30);
});

test("FSRS fuzz is deterministic for the same review and only changes long intervals", () => {
    const reviewCard = () =>
        new RepItemScheduleInfoFsrs(
            moment("2023-09-06T00:00:00.000Z"),
            30,
            5,
            30,
            State.Review,
            8,
            0,
            0,
            moment("2023-08-07T00:00:00.000Z"),
        );
    const review = (fsrsEnableFuzz: boolean) =>
        new SrsAlgorithmFsrs({ ...DEFAULT_SETTINGS, fsrsEnableFuzz }).cardCalcUpdatedSchedule(
            ReviewResponse.Good,
            reviewCard(),
            new CardDueDateHistogram(),
        );

    const fuzzed1 = review(true);
    const fuzzed2 = review(true);
    const unfuzzed = review(false);

    // ts-fsrs seeds its fuzz from the review time and card state, so it is reproducible.
    expect(fuzzed1.interval).toEqual(fuzzed2.interval);
    expect(fuzzed1.interval).not.toEqual(unfuzzed.interval);
    // Fuzz stays within a small fraction of the unfuzzed interval.
    expect(Math.abs(fuzzed1.interval - unfuzzed.interval)).toBeLessThanOrEqual(
        Math.ceil(unfuzzed.interval * 0.15) + 1,
    );
});

test("CardDueDateHistogram setter updates the due-now count", () => {
    const histogram = new CardDueDateHistogram();
    histogram.set(CardDueDateHistogram.dueNowNDays, 2);
    expect(histogram.dueNotesCount).toEqual(2);
});
