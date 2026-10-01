import { QuestionPostponementList } from "src/data/data-structures/card/questions/question-postponement-list";
import { Deck, DeckTreeFilter } from "src/data/data-structures/deck/deck";
import {
    DeckOrder,
    DeckTreeIterator,
    IDeckTreeIterator,
    IIteratorOrder,
    RepItemOrder,
} from "src/data/data-structures/deck/deck-tree-iterator";
import { TopicPath } from "src/data/data-structures/deck/topic-path";
import { ReviewLog } from "src/data/review-log/review-log";
import { DEFAULT_SETTINGS, SRSettings } from "src/data/settings";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";
import { SRAlgorithm } from "src/scheduling/algorithms/base/sr-algorithm";
import { DailyReviewLimiter } from "src/scheduling/daily-review-limits";
import { CardDueDateHistogram } from "src/scheduling/due-date-histogram";
import {
    DeckStats,
    FlashcardReviewMode,
    FlashcardReviewSequencer,
    MAX_UNDO_STACK_SIZE,
} from "src/scheduling/flashcard-review-sequencer";
import { setupStaticDateProvider20230906 } from "src/utils/dates";

import { UnitTestSRFile } from "../helpers/unit-test-file";
import { UnitTestReviewLogStorage } from "../helpers/unit-test-review-log-storage";
import { unitTestSetupStandardDataStoreAlgorithm } from "../helpers/unit-test-setup";
import { SampleItemDecks } from "../sample-items";

const orderDueFirstSequential: IIteratorOrder = {
    repItemOrder: RepItemOrder.DueFirstSequential,
    deckOrder: DeckOrder.PrevDeckComplete_Sequential,
};

const orderNewFirstSequential: IIteratorOrder = {
    repItemOrder: RepItemOrder.NewFirstSequential,
    deckOrder: DeckOrder.PrevDeckComplete_Sequential,
};

class UndoTestContext {
    settings: SRSettings;
    file: UnitTestSRFile;
    reviewSequencer: FlashcardReviewSequencer;
    cardSequencer: IDeckTreeIterator;
    questionPostponementList: QuestionPostponementList;
    histogram: CardDueDateHistogram;
    reviewLog: ReviewLog;
    storage: UnitTestReviewLogStorage;

    static async create(
        text: string,
        settingsOverride: Partial<SRSettings> = {},
        reviewMode: FlashcardReviewMode = FlashcardReviewMode.Review,
        iteratorOrder: IIteratorOrder = orderDueFirstSequential,
    ): Promise<UndoTestContext> {
        const c = new UndoTestContext();
        c.settings = { ...DEFAULT_SETTINGS, ...settingsOverride };
        unitTestSetupStandardDataStoreAlgorithm(c.settings);
        c.file = new UnitTestSRFile(text, "notes/test.md");
        c.cardSequencer = new DeckTreeIterator(iteratorOrder, null);
        c.questionPostponementList = new QuestionPostponementList(null, c.settings, []);
        c.histogram = new CardDueDateHistogram();
        c.storage = new UnitTestReviewLogStorage();
        c.reviewLog = new ReviewLog(c.storage, () => "Spaced Repetition", 60000);
        c.reviewSequencer = new FlashcardReviewSequencer(
            reviewMode,
            c.cardSequencer,
            c.settings,
            SRAlgorithm.getInstance(),
            c.questionPostponementList,
            c.histogram,
            c.reviewLog,
        );

        const deckTree: Deck = await SampleItemDecks.createDeckFromFile(
            c.file,
            new TopicPath(["Root"]),
        );
        const remainingDeckTree = DeckTreeFilter.filterForRemainingRepItems(
            c.questionPostponementList,
            deckTree,
            reviewMode,
        );
        c.reviewSequencer.setDeckTree(deckTree, remainingDeckTree);
        return c;
    }

    stats(): DeckStats {
        return this.reviewSequencer.getDeckStats(TopicPath.getTopicPathFromTag("#flashcards"));
    }
}

beforeEach(() => {
    setupStaticDateProvider20230906();
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe("Undo last review", () => {
    test("Nothing to undo", async () => {
        const c = await UndoTestContext.create("#flashcards Q1::A1");
        expect(c.reviewSequencer.canUndo).toBe(false);
        expect(await c.reviewSequencer.undoLastReview()).toBe(false);
        expect(c.reviewSequencer.currentCard.front).toEqual("Q1");
    });

    test("Undo of a new card removes the scheduling comment, restores queue, counts & log", async () => {
        const text = `#flashcards Q1::A1
#flashcards Q2::A2
#flashcards Q3::A3`;
        const c = await UndoTestContext.create(text);
        const statsBefore = c.stats();
        expect(statsBefore.newCount).toEqual(3);

        const card = c.reviewSequencer.currentCard;
        expect(card.front).toEqual("Q1");

        await c.reviewSequencer.processReview(ReviewResponse.Good);
        expect(c.reviewSequencer.currentCard.front).toEqual("Q2");
        expect(c.file.content).toContain("Q1::A1\n<!--SR:!2023-09-09,3,250-->");
        expect(c.stats().newCount).toEqual(2);
        expect(c.reviewSequencer.canUndo).toBe(true);
        expect((await c.reviewLog.loadEntries()).length).toEqual(1);

        expect(await c.reviewSequencer.undoLastReview()).toBe(true);
        expect(c.reviewSequencer.canUndo).toBe(false);
        expect(c.file.content).toEqual(text);
        expect(card.scheduleInfo).toBeNull();
        expect(c.reviewSequencer.currentCard).toBe(card);
        expect(c.stats()).toEqual(statsBefore);
        expect(await c.reviewLog.loadEntries()).toEqual([]);

        // Review continues normally after the undo
        await c.reviewSequencer.processReview(ReviewResponse.Easy);
        expect(c.reviewSequencer.currentCard.front).toEqual("Q2");
        await c.reviewSequencer.processReview(ReviewResponse.Easy);
        expect(c.reviewSequencer.currentCard.front).toEqual("Q3");
    });

    test("Undo of a due card restores the previous scheduling comment & histogram", async () => {
        const text = `#flashcards Q1::A1
#flashcards Q2::A2 <!--SR:!2023-09-02,4,270-->`;
        const c = await UndoTestContext.create(text);
        const card = c.reviewSequencer.currentCard;
        expect(card.front).toEqual("Q2");
        const previousSchedule = card.scheduleInfo;
        const histogramBefore = new Map(c.histogram.dueDatesMap);

        await c.reviewSequencer.processReview(ReviewResponse.Hard);
        expect(c.file.content).not.toEqual(text);
        expect(c.reviewSequencer.currentCard.front).toEqual("Q1");

        await c.reviewSequencer.undoLastReview();
        expect(c.file.content).toEqual(text);
        expect(card.scheduleInfo).toBe(previousSchedule);
        expect(c.reviewSequencer.currentCard).toBe(card);
        // Histogram entries are reverted (zero counts may remain as keys)
        for (const [days, count] of c.histogram.dueDatesMap) {
            expect(count).toEqual(histogramBefore.get(days) ?? 0);
        }
    });

    test("Undone card is put back at the front even with new-first ordering", async () => {
        const text = `#flashcards Q1::A1
#flashcards Q2::A2 <!--SR:!2023-09-02,4,270-->
#flashcards Q3::A3`;
        const c = await UndoTestContext.create(
            text,
            {},
            FlashcardReviewMode.Review,
            orderNewFirstSequential,
        );
        // New first: Q1, Q3, then the due card Q2
        await c.reviewSequencer.processReview(ReviewResponse.Good);
        await c.reviewSequencer.processReview(ReviewResponse.Good);
        const dueCard = c.reviewSequencer.currentCard;
        expect(dueCard.front).toEqual("Q2");
        await c.reviewSequencer.processReview(ReviewResponse.Good);
        expect(c.reviewSequencer.hasCurrentCard).toBe(false);

        // Undo all three reviews (multi-level undo)
        await c.reviewSequencer.undoLastReview();
        expect(c.reviewSequencer.currentCard).toBe(dueCard);
        await c.reviewSequencer.undoLastReview();
        expect(c.reviewSequencer.currentCard.front).toEqual("Q3");
        await c.reviewSequencer.undoLastReview();
        expect(c.reviewSequencer.currentCard.front).toEqual("Q1");
        expect(c.file.content).toEqual(text);
        expect(c.stats().newCount).toEqual(2);
        expect(c.stats().dueCount).toEqual(1);

        // All three cards are shown again, none is skipped
        const seen: string[] = [];
        while (c.reviewSequencer.hasCurrentCard) {
            seen.push(c.reviewSequencer.currentCard.front);
            await c.reviewSequencer.processReview(ReviewResponse.Easy);
        }
        expect(seen.sort()).toEqual(["Q1", "Q2", "Q3"]);
    });

    test("Undo of a reset of a new card (requeued) restores the queue", async () => {
        const text = `#flashcards Q1::A1
#flashcards Q2::A2`;
        const c = await UndoTestContext.create(text);
        const statsBefore = c.stats();
        await c.reviewSequencer.processReview(ReviewResponse.Reset);
        expect(c.reviewSequencer.currentCard.front).toEqual("Q2");
        // No schedule change, so nothing logged
        expect(c.reviewLog.pendingEntryCount).toEqual(0);

        await c.reviewSequencer.undoLastReview();
        expect(c.reviewSequencer.currentCard.front).toEqual("Q1");
        expect(c.stats()).toEqual(statsBefore);
        expect(c.file.content).toEqual(text);
    });

    test("Undo with buried siblings un-buries them", async () => {
        const text = `#flashcards This single ==question== turns into ==3 separate== ==cards==

#flashcards
Q1::A1`;
        const c = await UndoTestContext.create(text, { burySiblingCards: true });
        const statsBefore = c.stats();
        const card = c.reviewSequencer.currentCard;
        expect(card.question.cards.length).toEqual(3);

        await c.reviewSequencer.processReview(ReviewResponse.Easy);
        expect(c.reviewSequencer.currentCard.front).toEqual("Q1");
        expect(c.questionPostponementList.list.length).toEqual(1);

        await c.reviewSequencer.undoLastReview();
        expect(c.questionPostponementList.list.length).toEqual(0);
        expect(c.reviewSequencer.currentCard).toBe(card);
        expect(c.stats()).toEqual(statsBefore);
        expect(c.file.content).toEqual(text);
    });

    test("Cram mode: undo restores the queue, nothing is logged", async () => {
        const text = `#flashcards Q1::A1 <!--SR:!2023-09-02,4,270-->
#flashcards Q2::A2 <!--SR:!2023-09-02,3,270-->`;
        const c = await UndoTestContext.create(text, {}, FlashcardReviewMode.Cram);
        const first = c.reviewSequencer.currentCard;
        await c.reviewSequencer.processReview(ReviewResponse.Easy);
        expect(c.reviewSequencer.currentCard).not.toBe(first);
        expect(c.reviewLog.pendingEntryCount).toEqual(0);

        await c.reviewSequencer.undoLastReview();
        expect(c.reviewSequencer.currentCard).toBe(first);
        expect(c.file.content).toEqual(text);
    });

    test("Undo stack is limited", async () => {
        const lines: string[] = [];
        for (let i = 0; i < MAX_UNDO_STACK_SIZE + 2; i++) lines.push(`#flashcards Q${i}::A${i}`);
        const c = await UndoTestContext.create(lines.join("\n"));
        for (let i = 0; i < MAX_UNDO_STACK_SIZE + 2; i++) {
            await c.reviewSequencer.processReview(ReviewResponse.Easy);
        }
        let undoCount = 0;
        while (await c.reviewSequencer.undoLastReview()) undoCount++;
        expect(undoCount).toEqual(MAX_UNDO_STACK_SIZE);
    });

    test("Deleting a card removes its undo records", async () => {
        const text = `#flashcards Q1::A1
#flashcards Q2::A2`;
        const c = await UndoTestContext.create(text);
        await c.reviewSequencer.processReview(ReviewResponse.Again);
        // Again on a new card requeues it, Q2 is next
        expect(c.reviewSequencer.currentCard.front).toEqual("Q2");
        await c.reviewSequencer.processReview(ReviewResponse.Good);
        expect(c.reviewSequencer.currentCard.front).toEqual("Q1");
        await c.reviewSequencer.deleteCurrentCardFromNote();
        // Only the review of Q2 is left
        await c.reviewSequencer.undoLastReview();
        expect(c.reviewSequencer.currentCard.front).toEqual("Q2");
        expect(c.reviewSequencer.canUndo).toBe(false);
    });
});

describe("Undo & daily limits", () => {
    test("Undo gives the review back to the daily budget", async () => {
        const c = await UndoTestContext.create(`#flashcards Q1::A1
#flashcards Q2::A2`);
        const holder = { dailyReviewCounts: { date: "", newCards: 0, reviews: 0 } };
        const limiter = new DailyReviewLimiter(holder, { ...c.settings, newCardsPerDay: 1 });
        c.reviewSequencer.setDailyReviewLimiter(limiter);

        const card = c.reviewSequencer.currentCard;
        await c.reviewSequencer.processReview(ReviewResponse.Good);
        expect(holder.dailyReviewCounts.newCards).toEqual(1);
        // The budget of 1 new card is used up
        expect(c.reviewSequencer.hasCurrentCard).toEqual(false);

        expect(await c.reviewSequencer.undoLastReview()).toEqual(true);
        expect(holder.dailyReviewCounts.newCards).toEqual(0);
        expect(limiter.isCountedThisSession(card)).toEqual(false);
        expect(c.reviewSequencer.currentCard).toBe(card);
    });
});

describe("Undo when the note was modified in the meantime", () => {
    test("Schedule is restored in memory, note is left untouched", async () => {
        const c = await UndoTestContext.create(`#flashcards Q1::A1
#flashcards Q2::A2`);
        const card = c.reviewSequencer.currentCard;
        await c.reviewSequencer.processReview(ReviewResponse.Good);
        c.file.content = "completely different content";

        expect(await c.reviewSequencer.undoLastReview()).toBe(true);
        expect(card.scheduleInfo).toBeNull();
        expect(c.file.content).toEqual("completely different content");
        expect(c.reviewSequencer.currentCard).toBe(card);
    });
});

describe("Review log", () => {
    test("Entries are logged with schedule before/after & time spent", async () => {
        const text = `#flashcards Q1::A1
#flashcards Q2::A2 <!--SR:!2023-09-02,4,270-->`;
        const c = await UndoTestContext.create(text);
        const nowSpy = jest.spyOn(Date, "now");
        nowSpy.mockReturnValue(10000);
        c.reviewSequencer.markCurrentCardShown();
        nowSpy.mockReturnValue(13500);
        await c.reviewSequencer.processReview(ReviewResponse.Good);
        // Card not marked as shown -> time unknown
        await c.reviewSequencer.processReview(ReviewResponse.Easy);

        const entries = await c.reviewLog.loadEntries();
        expect(entries.length).toEqual(2);
        expect(entries[0]).toMatchObject({
            notePath: "notes/test.md",
            lineNo: 1,
            cardIdx: 0,
            deck: "#flashcards",
            response: "Good",
            timeMs: 3500,
            before: { interval: 4, ease: 270 },
            after: { interval: expect.any(Number) as number },
        });
        expect(entries[0].cardId).toEqual(`notes/test.md:1:${entries[0].questionHash}:0`);
        expect(entries[1]).toMatchObject({
            notePath: "notes/test.md",
            lineNo: 0,
            response: "Easy",
            before: null,
            timeMs: null,
        });

        // The log is stored in the vault as markdown
        expect([...c.storage.files.keys()]).toEqual(["Spaced Repetition/review-log-2023-09.sr.md"]);
        const content = c.storage.files.get("Spaced Repetition/review-log-2023-09.sr.md");
        expect(content).not.toContain("#flashcards");
    });

    test("Nothing is logged when the review log is disabled", async () => {
        const c = await UndoTestContext.create("#flashcards Q1::A1", { enableReviewLog: false });
        await c.reviewSequencer.processReview(ReviewResponse.Good);
        expect(await c.reviewLog.loadEntries()).toEqual([]);
        // Undo still works
        await c.reviewSequencer.undoLastReview();
        expect(c.file.content).toEqual("#flashcards Q1::A1");
    });

    test("Undo removes an entry that was already written", async () => {
        const c = await UndoTestContext.create(`#flashcards Q1::A1
#flashcards Q2::A2`);
        await c.reviewSequencer.processReview(ReviewResponse.Good);
        await c.reviewSequencer.processReview(ReviewResponse.Good);
        await c.reviewLog.flush();
        expect((await c.reviewLog.loadEntries()).length).toEqual(2);

        await c.reviewSequencer.undoLastReview();
        const entries = await c.reviewLog.loadEntries();
        expect(entries.length).toEqual(1);
        expect(entries[0].lineNo).toEqual(0);
    });
});
