import moment from "moment";
import { State } from "ts-fsrs";

import { MULTI_SCHEDULING_EXTRACTOR } from "src/data/constants";
import { RepItemScheduleInfoFsrs } from "src/scheduling/algorithms/fsrs/rep-item-schedule-info-fsrs";
import { RepItemScheduleInfoOsr } from "src/scheduling/algorithms/osr/rep-item-schedule-info-osr";
import { CommentParser, SUSPENDED_MARKER } from "src/utils/comment-parser";
import { setupStaticDateProvider20230906 } from "src/utils/dates";

const FSRS_SEGMENT = "fsrs,2023-09-06T00:10:00.000Z,3,0.4,5.5,2,12,8,0,2023-09-06T00:00:00.000Z";

beforeAll(() => {
    setupStaticDateProvider20230906();
});

describe("CommentParser - suspended marker", () => {
    test("Marker constant", () => {
        expect(SUSPENDED_MARKER).toEqual("suspended");
    });

    describe("SM-2 / OSR", () => {
        test("Parses the same schedule with and without the marker", () => {
            const plain = CommentParser.parseMultiScheduleComment("!2023-09-02,4,270");
            const suspended = CommentParser.parseMultiScheduleComment(
                "!2023-09-02,4,270,suspended",
            );
            expect(suspended).toEqual(plain);
            expect(plain).toHaveLength(1);
            expect(plain[0]).toBeInstanceOf(RepItemScheduleInfoOsr);
            expect(plain[0].interval).toEqual(4);
            expect(plain[0].latestEase).toEqual(270);
        });

        test("Suspended flags per sibling, including new (placeholder) cards", () => {
            const comment =
                "!2023-09-02,4,270,suspended!2000-01-01,1,250,suspended!2023-09-02,6,270";
            expect(CommentParser.parseSuspendedFlags(comment)).toEqual([true, true, false]);

            const schedules = CommentParser.parseMultiScheduleComment(comment);
            expect(schedules).toHaveLength(3);
            expect(schedules[0]).not.toBeNull();
            expect(schedules[1]).toBeNull(); // still a new card
            expect(schedules[2].interval).toEqual(6);
        });

        test("Comments without the marker report no suspended cards", () => {
            expect(CommentParser.parseSuspendedFlags("!2023-09-02,4,270!2023-09-02,5,270")).toEqual(
                [false, false],
            );
        });

        test("Round trip: format -> append marker -> parse", () => {
            const schedule = RepItemScheduleInfoOsr.fromDueDateStr("2023-09-02", 4, 270);
            const segment = CommentParser.appendSuspendedMarker(
                schedule.formatScheduleAsSRHtmlComment(),
            );
            expect(segment).toEqual("!2023-09-02,4,270,suspended");

            const [parsed] = CommentParser.parseMultiScheduleComment(segment);
            expect(parsed.formatScheduleAsSRHtmlComment()).toEqual("!2023-09-02,4,270");
            expect(CommentParser.parseSuspendedFlags(segment)).toEqual([true]);
        });

        test("Older plugin versions (regex based parsing) still read the schedule", () => {
            const text = "<!--SR:!2023-09-02,4,270,suspended!2023-09-03,5,280-->";
            const matches = [...text.matchAll(MULTI_SCHEDULING_EXTRACTOR)].map((m) => [
                m[1],
                m[2],
                m[3],
            ]);
            expect(matches).toEqual([
                ["2023-09-02", "4", "270"],
                ["2023-09-03", "5", "280"],
            ]);
        });
    });

    describe("FSRS", () => {
        test("Parses the same schedule with and without the marker", () => {
            const plain = CommentParser.parseMultiScheduleComment("!" + FSRS_SEGMENT);
            const suspended = CommentParser.parseMultiScheduleComment(
                "!" + FSRS_SEGMENT + ",suspended",
            );
            expect(suspended).toEqual(plain);

            const schedule = plain[0] as RepItemScheduleInfoFsrs;
            expect(schedule).toBeInstanceOf(RepItemScheduleInfoFsrs);
            expect(schedule.lapses).toEqual(8);
            expect(schedule.reps).toEqual(12);
            expect(schedule.learningSteps).toEqual(0);
            expect(schedule.lastReview?.toISOString()).toEqual("2023-09-06T00:00:00.000Z");
        });

        test("Round trip: format -> append marker -> parse -> format", () => {
            const original = new RepItemScheduleInfoFsrs(
                moment("2023-09-16T00:00:00.000Z"),
                10,
                6.2,
                12.5,
                State.Review,
                9,
                3,
                0,
                moment("2023-09-06T00:00:00.000Z"),
            );
            const formatted = original.formatScheduleAsSRHtmlComment();
            const withMarker = CommentParser.appendSuspendedMarker(formatted);
            expect(withMarker).toEqual(formatted + ",suspended");

            const [parsed] = CommentParser.parseMultiScheduleComment(withMarker);
            expect(parsed.formatScheduleAsSRHtmlComment()).toEqual(formatted);
            expect(CommentParser.parseSuspendedFlags(withMarker)).toEqual([true]);
        });

        test("Mixed SM-2 and FSRS siblings", () => {
            const comment = `!2023-09-02,4,270!${FSRS_SEGMENT},suspended`;
            expect(CommentParser.parseSuspendedFlags(comment)).toEqual([false, true]);
            const schedules = CommentParser.parseMultiScheduleComment(comment);
            expect(schedules[0]).toBeInstanceOf(RepItemScheduleInfoOsr);
            expect(schedules[1]).toBeInstanceOf(RepItemScheduleInfoFsrs);
        });
    });

    describe("removeSuspendedMarkers", () => {
        test("Removes markers from all SR comments and counts them", () => {
            const text = `#flashcards
Q1::A1
<!--SR:!2023-09-02,4,270,suspended-->
Q2::A2 <!--SR:!2023-09-02,4,270!2000-01-01,1,250,suspended-->
Q3::A3 <!--SR:!${FSRS_SEGMENT},suspended-->
Q4::suspended,stays <!--SR:!2023-09-02,4,270-->`;
            const expected = `#flashcards
Q1::A1
<!--SR:!2023-09-02,4,270-->
Q2::A2 <!--SR:!2023-09-02,4,270!2000-01-01,1,250-->
Q3::A3 <!--SR:!${FSRS_SEGMENT}-->
Q4::suspended,stays <!--SR:!2023-09-02,4,270-->`;

            const result = CommentParser.removeSuspendedMarkers(text);
            expect(result.text).toEqual(expected);
            expect(result.count).toEqual(3);
        });

        test("Text without markers is unchanged", () => {
            const text = "Q1::A1 <!--SR:!2023-09-02,4,270-->";
            expect(CommentParser.removeSuspendedMarkers(text)).toEqual({ text, count: 0 });
        });
    });
});
