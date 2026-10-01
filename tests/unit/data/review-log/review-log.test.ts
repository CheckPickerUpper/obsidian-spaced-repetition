import moment from "moment";
import { State } from "ts-fsrs";

import { Card } from "src/data/data-structures/card/card";
import { Question } from "src/data/data-structures/card/questions/question";
import { TopicPath, TopicPathList } from "src/data/data-structures/deck/topic-path";
import {
    createReviewLogEntry,
    generateReviewLogEntryId,
    parseReviewLogLine,
    REVIEW_LOG_FILE_HEADER,
    ReviewLog,
    ReviewLogEntry,
    reviewResponseToLogResponse,
    scheduleToSnapshot,
    serializeReviewLogEntry,
} from "src/data/review-log/review-log";
import { DEFAULT_SETTINGS, SRSettings, upgradeSettings } from "src/data/settings";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";
import { RepItemScheduleInfoFsrs } from "src/scheduling/algorithms/fsrs/rep-item-schedule-info-fsrs";
import { RepItemScheduleInfoOsr } from "src/scheduling/algorithms/osr/rep-item-schedule-info-osr";

import { UnitTestReviewLogStorage } from "../../helpers/unit-test-review-log-storage";

function makeEntry(id: string, ts: string, deck: string = "#flashcards/math"): ReviewLogEntry {
    return {
        v: 1,
        id,
        ts,
        cardId: "notes/a.md:3:abc:0",
        notePath: "notes/a.md",
        lineNo: 3,
        questionHash: "abc",
        cardIdx: 0,
        deck,
        response: "Good",
        before: null,
        after: { algorithm: "SM-2-OSR", due: "2026-10-05T00:00:00.000Z", interval: 4, ease: 250 },
        timeMs: 1234,
    };
}

describe("serialization", () => {
    test("Round trip", () => {
        const entry = makeEntry(
            "id1",
            "2026-10-01T10:00:00.000Z",
            "#flashcards/[[math]] <b>`x`%%$",
        );
        const line = serializeReviewLogEntry(entry);
        expect(line).not.toContain("\n");
        expect(line).not.toMatch(/[#[\]<>`%$]/);
        expect(parseReviewLogLine(line)).toEqual(entry);
    });

    test("Invalid lines are ignored", () => {
        expect(parseReviewLogLine("")).toBeNull();
        expect(parseReviewLogLine(REVIEW_LOG_FILE_HEADER)).toBeNull();
        expect(parseReviewLogLine("{ broken json")).toBeNull();
        expect(parseReviewLogLine('{"foo": 1}')).toBeNull();
        expect(parseReviewLogLine("null")).toBeNull();
    });

    test("Response names", () => {
        expect(reviewResponseToLogResponse(ReviewResponse.Again)).toEqual("Again");
        expect(reviewResponseToLogResponse(ReviewResponse.Hard)).toEqual("Hard");
        expect(reviewResponseToLogResponse(ReviewResponse.Good)).toEqual("Good");
        expect(reviewResponseToLogResponse(ReviewResponse.Easy)).toEqual("Easy");
        expect(reviewResponseToLogResponse(ReviewResponse.Reset)).toEqual("Reset");
    });

    test("Entry ids are unique", () => {
        const ids = new Set<string>();
        for (let i = 0; i < 100; i++) ids.add(generateReviewLogEntryId(1000));
        expect(ids.size).toEqual(100);
    });
});

describe("scheduleToSnapshot", () => {
    test("null", () => {
        expect(scheduleToSnapshot(null)).toBeNull();
    });

    test("SM-2", () => {
        const schedule = new RepItemScheduleInfoOsr(moment.utc("2026-10-05"), 4, 270, 0);
        expect(scheduleToSnapshot(schedule)).toEqual({
            algorithm: schedule.algorithmType,
            due: "2026-10-05T00:00:00.000Z",
            interval: 4,
            ease: 270,
        });
    });

    test("FSRS", () => {
        const schedule = new RepItemScheduleInfoFsrs(
            moment.utc("2026-10-05"),
            4,
            5.5,
            12.25,
            State.Review,
            3,
            1,
            0,
            moment.utc("2026-10-01"),
        );
        expect(scheduleToSnapshot(schedule)).toEqual({
            algorithm: schedule.algorithmType,
            due: "2026-10-05T00:00:00.000Z",
            interval: 4,
            stability: 12.25,
            difficulty: 5.5,
            state: State.Review,
            reps: 3,
            lapses: 1,
        });
    });
});

describe("createReviewLogEntry", () => {
    test("Card identifier & deck", () => {
        const question = new Question({
            topicPathList: new TopicPathList([new TopicPath(["flashcards", "math"])]),
        });
        question.parsedQuestionInfo = { firstLineNum: 7 } as Question["parsedQuestionInfo"];
        question.questionText = { textHash: "hash1" } as Question["questionText"];
        question.note = { filePath: "folder/note.md" } as Question["note"];
        const card = new Card({ question, cardIdx: 2 });

        const after = new RepItemScheduleInfoOsr(moment.utc("2026-10-05"), 4, 250, 0);
        const entry = createReviewLogEntry(
            card,
            ReviewResponse.Good,
            null,
            after,
            Date.UTC(2026, 9, 1, 12),
            500,
        );
        expect(entry).toMatchObject({
            v: 1,
            ts: "2026-10-01T12:00:00.000Z",
            cardId: "folder/note.md:7:hash1:2",
            notePath: "folder/note.md",
            lineNo: 7,
            questionHash: "hash1",
            cardIdx: 2,
            deck: "#flashcards/math",
            response: "Good",
            before: null,
            timeMs: 500,
        });
        expect(entry.after.interval).toEqual(4);
    });
});

describe("ReviewLog", () => {
    let storage: UnitTestReviewLogStorage;
    let log: ReviewLog;

    beforeEach(() => {
        storage = new UnitTestReviewLogStorage();
        log = new ReviewLog(storage, () => "Spaced Repetition", 60000);
    });

    afterEach(async () => {
        await log.flush();
    });

    test("File paths", () => {
        expect(log.getFilePathForTimestamp("2026-10-01T10:00:00.000Z")).toEqual(
            "Spaced Repetition/review-log-2026-10.sr.md",
        );
        expect(log.isReviewLogFile("Spaced Repetition/review-log-2026-10.sr.md")).toBe(true);
        expect(log.isReviewLogFile("Spaced Repetition/schedule-data.sr.md")).toBe(false);
        expect(log.isReviewLogFile("Other/review-log-2026-10.sr.md")).toBe(false);
        expect(log.isReviewLogFile("Spaced Repetition/sub/review-log-2026-10.sr.md")).toBe(false);

        const rootLog = new ReviewLog(storage, () => "/", 0);
        expect(rootLog.getFilePathForTimestamp("2026-10-01T10:00:00.000Z")).toEqual(
            "review-log-2026-10.sr.md",
        );
        expect(rootLog.isReviewLogFile("review-log-2026-10.sr.md")).toBe(true);
    });

    test("Entries are buffered and written in batches", async () => {
        log.add(makeEntry("a", "2026-10-01T10:00:00.000Z"));
        log.add(makeEntry("b", "2026-10-01T10:01:00.000Z"));
        expect(log.pendingEntryCount).toEqual(2);
        expect(storage.files.size).toEqual(0);

        await log.flush();
        expect(log.pendingEntryCount).toEqual(0);
        expect(storage.writeCount).toEqual(1);
        expect(storage.folders.has("Spaced Repetition")).toBe(true);
        const content = storage.files.get("Spaced Repetition/review-log-2026-10.sr.md");
        expect(content.startsWith(REVIEW_LOG_FILE_HEADER)).toBe(true);
        expect(content.split("\n").filter((l) => l.startsWith("{")).length).toEqual(2);

        // Subsequent entries are appended, not rewritten
        log.add(makeEntry("c", "2026-10-02T10:00:00.000Z"));
        await log.flush();
        expect(storage.writeCount).toEqual(1);
        expect(storage.appendCount).toEqual(1);

        const entries = await log.loadEntries();
        expect(entries.map((e) => e.id)).toEqual(["a", "b", "c"]);
    });

    test("Flush is triggered automatically after the delay", async () => {
        jest.useFakeTimers();
        try {
            const timedLog = new ReviewLog(storage, () => "SR", 1000);
            timedLog.add(makeEntry("a", "2026-10-01T10:00:00.000Z"));
            timedLog.add(makeEntry("b", "2026-10-01T10:00:01.000Z"));
            expect(storage.files.size).toEqual(0);
            jest.advanceTimersByTime(1000);
        } finally {
            jest.useRealTimers();
        }
        // Let the flush complete
        await new Promise((resolve) => setTimeout(resolve, 0));
        await log.flush();
        const content = storage.files.get("SR/review-log-2026-10.sr.md");
        expect(content).toBeDefined();
        expect(content.split("\n").filter((l) => l.startsWith("{")).length).toEqual(2);
    });

    test("Entries are split into monthly files & filtered by date", async () => {
        log.add(makeEntry("sep", "2026-09-30T23:59:59.000Z"));
        log.add(makeEntry("oct1", "2026-10-01T00:00:00.000Z"));
        log.add(makeEntry("oct2", "2026-10-15T00:00:00.000Z"));
        log.add(makeEntry("nov", "2026-11-01T00:00:00.000Z"));
        await log.flush();
        expect([...storage.files.keys()].sort()).toEqual([
            "Spaced Repetition/review-log-2026-09.sr.md",
            "Spaced Repetition/review-log-2026-10.sr.md",
            "Spaced Repetition/review-log-2026-11.sr.md",
        ]);

        const october = await log.loadEntries({
            from: new Date("2026-10-01T00:00:00.000Z"),
            to: new Date("2026-11-01T00:00:00.000Z"),
        });
        expect(october.map((e) => e.id)).toEqual(["oct1", "oct2"]);

        const fromMid = await log.loadEntries({ from: new Date("2026-10-10T00:00:00.000Z") });
        expect(fromMid.map((e) => e.id)).toEqual(["oct2", "nov"]);
    });

    test("Unflushed entries are included when loading", async () => {
        log.add(makeEntry("a", "2026-10-01T10:00:00.000Z"));
        const entries = await log.loadEntries();
        expect(entries.map((e) => e.id)).toEqual(["a"]);
    });

    test("Remove an entry that has not been written yet", async () => {
        const entry = makeEntry("a", "2026-10-01T10:00:00.000Z");
        log.add(entry);
        expect(await log.remove(entry)).toBe(true);
        expect(log.pendingEntryCount).toEqual(0);
        await log.flush();
        expect(storage.files.size).toEqual(0);
    });

    test("Remove an entry that has already been written", async () => {
        const a = makeEntry("a", "2026-10-01T10:00:00.000Z");
        const b = makeEntry("b", "2026-10-01T10:01:00.000Z");
        log.add(a);
        log.add(b);
        await log.flush();

        expect(await log.remove(b)).toBe(true);
        expect((await log.loadEntries()).map((e) => e.id)).toEqual(["a"]);

        // Removing again / non existing entries
        expect(await log.remove(b)).toBe(false);
        expect(await log.remove(makeEntry("x", "2025-01-01T00:00:00.000Z"))).toBe(false);

        // Appending after a removal still produces valid lines
        log.add(makeEntry("c", "2026-10-01T10:02:00.000Z"));
        expect((await log.loadEntries()).map((e) => e.id)).toEqual(["a", "c"]);
    });

    test("Appending to a file without trailing newline", async () => {
        const path = "Spaced Repetition/review-log-2026-10.sr.md";
        storage.files.set(
            path,
            serializeReviewLogEntry(makeEntry("a", "2026-10-01T10:00:00.000Z")),
        );
        log.add(makeEntry("b", "2026-10-01T11:00:00.000Z"));
        expect((await log.loadEntries()).map((e) => e.id)).toEqual(["a", "b"]);
    });

    test("Corrupt lines are skipped", async () => {
        const path = "Spaced Repetition/review-log-2026-10.sr.md";
        storage.files.set(
            path,
            REVIEW_LOG_FILE_HEADER +
                "garbage\n{not json\n" +
                serializeReviewLogEntry(makeEntry("a", "2026-10-01T10:00:00.000Z")) +
                "\n",
        );
        storage.files.set("Spaced Repetition/notes.md", "{}");
        expect((await log.loadEntries()).map((e) => e.id)).toEqual(["a"]);
    });
});

describe("settings", () => {
    test("enableReviewLog defaults to true & is filled in on upgrade", () => {
        expect(DEFAULT_SETTINGS.enableReviewLog).toBe(true);
        const settings = { ...DEFAULT_SETTINGS } as Partial<SRSettings>;
        delete settings.enableReviewLog;
        upgradeSettings(settings as SRSettings);
        expect(settings.enableReviewLog).toBe(true);

        const disabled: SRSettings = { ...DEFAULT_SETTINGS, enableReviewLog: false };
        upgradeSettings(disabled);
        expect(disabled.enableReviewLog).toBe(false);
    });
});
