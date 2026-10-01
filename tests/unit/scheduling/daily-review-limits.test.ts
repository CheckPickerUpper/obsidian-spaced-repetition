import moment from "moment";

import { QuestionPostponementList } from "src/data/data-structures/card/questions/question-postponement-list";
import { Deck, DeckTreeFilter } from "src/data/data-structures/deck/deck";
import {
    DeckOrder,
    DeckTreeIterator,
    IIteratorOrder,
    RepItemOrder,
} from "src/data/data-structures/deck/deck-tree-iterator";
import { TopicPath } from "src/data/data-structures/deck/topic-path";
import { DEFAULT_DATA, IDailyReviewCounts } from "src/data/plugin-data";
import { DEFAULT_SETTINGS, SRSettings } from "src/data/settings";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";
import { SRAlgorithm } from "src/scheduling/algorithms/base/sr-algorithm";
import {
    DailyReviewLimiter,
    getReviewDayKey,
    IDailyReviewCountsHolder,
    normalizeDailyLimit,
} from "src/scheduling/daily-review-limits";
import { CardDueDateHistogram } from "src/scheduling/due-date-histogram";
import {
    FlashcardReviewMode,
    FlashcardReviewSequencer,
} from "src/scheduling/flashcard-review-sequencer";
import { setupStaticDateProvider, setupStaticDateProvider20230906 } from "src/utils/dates";

import { UnitTestSRFile } from "../helpers/unit-test-file";
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

const flashcardsPath: TopicPath = TopicPath.getTopicPathFromTag("#flashcards");

// 5 new cards & 4 due cards (static "today" is 2023-09-06)
const mixedText: string = `#flashcards Q1::A1
#flashcards Q2::A2
#flashcards Q3::A3
#flashcards Q4::A4
#flashcards Q5::A5
#flashcards Q6::A6 <!--SR:!2023-09-02,4,270-->
#flashcards Q7::A7 <!--SR:!2023-09-02,3,270-->
#flashcards Q8::A8 <!--SR:!2023-09-02,5,270-->
#flashcards Q9::A9 <!--SR:!2023-09-02,5,270-->`;

function createHolder(counts?: Partial<IDailyReviewCounts>): IDailyReviewCountsHolder {
    return { dailyReviewCounts: { date: "", newCards: 0, reviews: 0, ...counts } };
}

async function createSequencer(
    text: string,
    settings: Partial<SRSettings>,
    reviewMode: FlashcardReviewMode,
    holder: IDailyReviewCountsHolder | null,
    iteratorOrder: IIteratorOrder = orderDueFirstSequential,
): Promise<{ sequencer: FlashcardReviewSequencer; limiter: DailyReviewLimiter | null }> {
    const settingsClone: SRSettings = { ...DEFAULT_SETTINGS, ...settings };
    unitTestSetupStandardDataStoreAlgorithm(settingsClone);
    const postponementList = new QuestionPostponementList(null, settingsClone, []);
    const sequencer = new FlashcardReviewSequencer(
        reviewMode,
        new DeckTreeIterator(iteratorOrder, null),
        settingsClone,
        SRAlgorithm.getInstance(),
        postponementList,
        new CardDueDateHistogram(),
    );

    const file = new UnitTestSRFile(text, "test-file");
    const deckTree: Deck = await SampleItemDecks.createDeckFromFile(file, new TopicPath(["Root"]));
    const remainingDeckTree = DeckTreeFilter.filterForRemainingRepItems(
        postponementList,
        deckTree,
        reviewMode,
    );
    sequencer.setDeckTree(deckTree, remainingDeckTree);

    let limiter: DailyReviewLimiter | null = null;
    if (holder !== null) {
        limiter = new DailyReviewLimiter(holder, settingsClone);
        sequencer.setDailyReviewLimiter(limiter);
    }
    return { sequencer, limiter };
}

async function reviewAll(sequencer: FlashcardReviewSequencer): Promise<number> {
    let count = 0;
    while (sequencer.hasCurrentCard) {
        await sequencer.processReview(ReviewResponse.Good);
        count++;
        if (count > 100) throw new Error("Too many reviews");
    }
    return count;
}

describe("getReviewDayKey", () => {
    test("Midnight start of day uses the calendar date", () => {
        expect(getReviewDayKey(moment("2024-01-02 00:00:00"), "00:00:00")).toEqual("2024-01-02");
        expect(getReviewDayKey(moment("2024-01-02 23:59:59"), "00:00:00")).toEqual("2024-01-02");
    });

    test("Before the start of day belongs to the previous day", () => {
        expect(getReviewDayKey(moment("2024-01-02 03:59:59"), "04:00:00")).toEqual("2024-01-01");
        expect(getReviewDayKey(moment("2024-01-02 04:00:00"), "04:00:00")).toEqual("2024-01-02");
        expect(getReviewDayKey(moment("2024-03-01 01:30:00"), "02:30:15")).toEqual("2024-02-29");
    });

    test("Invalid start of day falls back to midnight", () => {
        expect(getReviewDayKey(moment("2024-01-02 03:00:00"), "garbage")).toEqual("2024-01-02");
        expect(getReviewDayKey(moment("2024-01-02 03:00:00"), undefined)).toEqual("2024-01-02");
    });
});

describe("normalizeDailyLimit", () => {
    test.each([
        [0, Infinity],
        [null, Infinity],
        [undefined, Infinity],
        [-5, Infinity],
        [NaN, Infinity],
        [1, 1],
        [20, 20],
        [7.8, 7],
    ])("%p -> %p", (value, expected) => {
        expect(normalizeDailyLimit(value)).toEqual(expected);
    });
});

describe("DailyReviewLimiter", () => {
    beforeEach(() => {
        setupStaticDateProvider20230906();
    });

    test("Default settings & data", () => {
        expect(DEFAULT_SETTINGS.newCardsPerDay).toEqual(20);
        expect(DEFAULT_SETTINGS.maxReviewsPerDay).toEqual(200);
        expect(DEFAULT_DATA.dailyReviewCounts).toEqual({ date: "", newCards: 0, reviews: 0 });
    });

    test("Counters of the same day are kept", () => {
        const holder = createHolder({ date: "2023-09-06", newCards: 3, reviews: 10 });
        const limiter = new DailyReviewLimiter(holder, {
            ...DEFAULT_SETTINGS,
            newCardsPerDay: 5,
            maxReviewsPerDay: 12,
        });
        expect(limiter.counts).toEqual({ date: "2023-09-06", newCards: 3, reviews: 10 });
        expect(limiter.remainingNewCards).toEqual(2);
        expect(limiter.remainingReviews).toEqual(2);
    });

    test("Counters reset when the day rolls over", () => {
        const holder = createHolder({ date: "2023-09-05", newCards: 3, reviews: 10 });
        const limiter = new DailyReviewLimiter(holder, { ...DEFAULT_SETTINGS, newCardsPerDay: 5 });
        expect(holder.dailyReviewCounts).toEqual({ date: "2023-09-06", newCards: 0, reviews: 0 });
        expect(limiter.remainingNewCards).toEqual(5);

        holder.dailyReviewCounts.newCards = 4;
        expect(limiter.remainingNewCards).toEqual(1);

        // Simulate time passing into the next day while the plugin keeps running
        setupStaticDateProvider("2023-09-07");
        expect(limiter.rolloverIfNewDay()).toEqual(true);
        expect(limiter.remainingNewCards).toEqual(5);
        expect(holder.dailyReviewCounts.date).toEqual("2023-09-07");
        expect(limiter.rolloverIfNewDay()).toEqual(false);
    });

    test("Rollover respects the start of day setting", () => {
        // Static "now" is 2023-09-06 00:00:00, which with a start of day of 04:00 is still 2023-09-05
        const holder = createHolder({ date: "2023-09-05", newCards: 3, reviews: 10 });
        new DailyReviewLimiter(holder, { ...DEFAULT_SETTINGS, startOfDay: "04:00:00" });
        expect(holder.dailyReviewCounts).toEqual({ date: "2023-09-05", newCards: 3, reviews: 10 });

        const holder2 = createHolder({ date: "2023-09-05", newCards: 3, reviews: 10 });
        new DailyReviewLimiter(holder2, { ...DEFAULT_SETTINGS, startOfDay: "00:00:00" });
        expect(holder2.dailyReviewCounts).toEqual({ date: "2023-09-06", newCards: 0, reviews: 0 });
    });

    test("Missing counters are created", () => {
        const holder = { dailyReviewCounts: undefined } as unknown as IDailyReviewCountsHolder;
        const limiter = new DailyReviewLimiter(holder, DEFAULT_SETTINGS);
        expect(holder.dailyReviewCounts).toEqual({ date: "2023-09-06", newCards: 0, reviews: 0 });
        expect(limiter.remainingNewCards).toEqual(20);
    });

    test("Zero means unlimited", () => {
        const holder = createHolder({ date: "2023-09-06", newCards: 1000, reviews: 1000 });
        const limiter = new DailyReviewLimiter(holder, {
            ...DEFAULT_SETTINGS,
            newCardsPerDay: 0,
            maxReviewsPerDay: 0,
        });
        expect(limiter.remainingNewCards).toEqual(Infinity);
        expect(limiter.remainingReviews).toEqual(Infinity);
    });

    test("Recording reviews persists via the save callback", async () => {
        const holder = createHolder();
        const save = jest.fn(async () => {});
        const { sequencer } = await createSequencer(
            mixedText,
            {},
            FlashcardReviewMode.Review,
            null,
        );
        const limiter = new DailyReviewLimiter(holder, DEFAULT_SETTINGS, save);
        sequencer.setDailyReviewLimiter(limiter);

        // Due first: a due card
        await sequencer.processReview(ReviewResponse.Good);
        expect(holder.dailyReviewCounts).toEqual({ date: "2023-09-06", newCards: 0, reviews: 1 });
        expect(save).toHaveBeenCalledTimes(1);
    });
});

describe("FlashcardReviewSequencer with daily limits", () => {
    beforeEach(() => {
        setupStaticDateProvider20230906();
    });

    test("Without a limiter everything is queued", async () => {
        const { sequencer } = await createSequencer(
            mixedText,
            { newCardsPerDay: 1, maxReviewsPerDay: 1 },
            FlashcardReviewMode.Review,
            null,
        );
        const stats = sequencer.getDeckStats(flashcardsPath);
        expect(stats.newCount).toEqual(5);
        expect(stats.dueCount).toEqual(4);
        expect(await reviewAll(sequencer)).toEqual(9);
    });

    test("Deck counts reflect the remaining budget", async () => {
        const holder = createHolder({ date: "2023-09-06", newCards: 1, reviews: 1 });
        const { sequencer } = await createSequencer(
            mixedText,
            { newCardsPerDay: 3, maxReviewsPerDay: 3 },
            FlashcardReviewMode.Review,
            holder,
        );
        const stats = sequencer.getDeckStats(flashcardsPath);
        expect(stats.totalCount).toEqual(9);
        expect(stats.newCount).toEqual(2);
        expect(stats.dueCount).toEqual(2);
        expect(stats.cardsInQueueCount).toEqual(4);
        expect(stats.newCardsInQueueOfThisDeckCount).toEqual(2);
        expect(stats.dueCardsInQueueOfThisDeckCount).toEqual(2);

        const rootStats = sequencer.getDeckStats(TopicPath.emptyPath);
        expect(rootStats.cardsInQueueCount).toEqual(4);
    });

    test("Queue only contains up to the remaining budget", async () => {
        const holder = createHolder();
        const { sequencer } = await createSequencer(
            mixedText,
            { newCardsPerDay: 2, maxReviewsPerDay: 3 },
            FlashcardReviewMode.Review,
            holder,
        );

        expect(await reviewAll(sequencer)).toEqual(5);
        expect(holder.dailyReviewCounts).toEqual({ date: "2023-09-06", newCards: 2, reviews: 3 });

        const stats = sequencer.getDeckStats(flashcardsPath);
        expect(stats.cardsInQueueCount).toEqual(0);
        expect(sequencer.hasCurrentCard).toEqual(false);
    });

    test("New cards first order is limited too", async () => {
        const holder = createHolder();
        const { sequencer } = await createSequencer(
            mixedText,
            { newCardsPerDay: 1, maxReviewsPerDay: 0 },
            FlashcardReviewMode.Review,
            holder,
            orderNewFirstSequential,
        );

        expect(await reviewAll(sequencer)).toEqual(5);
        expect(holder.dailyReviewCounts).toEqual({ date: "2023-09-06", newCards: 1, reviews: 4 });
    });

    test("Exhausted budget results in an empty queue", async () => {
        const holder = createHolder({ date: "2023-09-06", newCards: 20, reviews: 200 });
        const { sequencer } = await createSequencer(
            mixedText,
            {},
            FlashcardReviewMode.Review,
            holder,
        );

        expect(sequencer.hasCurrentCard).toEqual(false);
        expect(sequencer.getDeckStats(flashcardsPath).cardsInQueueCount).toEqual(0);
        expect(sequencer.getSubDecksWithCardsInQueue(sequencer.originalDeckTree)).toEqual([]);
    });

    test("Budget persists across sessions (new limiter with the same holder)", async () => {
        const holder = createHolder();
        const settings = { newCardsPerDay: 3, maxReviewsPerDay: 0 };

        const first = await createSequencer(
            mixedText,
            settings,
            FlashcardReviewMode.Review,
            holder,
            orderNewFirstSequential,
        );
        await first.sequencer.processReview(ReviewResponse.Good);
        await first.sequencer.processReview(ReviewResponse.Good);
        expect(holder.dailyReviewCounts.newCards).toEqual(2);

        // e.g. Obsidian restarted: same persisted counters, fresh session
        const second = await createSequencer(
            mixedText,
            settings,
            FlashcardReviewMode.Review,
            holder,
            orderNewFirstSequential,
        );
        expect(second.sequencer.getDeckStats(flashcardsPath).newCount).toEqual(1);

        // Next day the budget is available again
        setupStaticDateProvider("2023-09-07");
        const third = await createSequencer(
            mixedText,
            settings,
            FlashcardReviewMode.Review,
            holder,
            orderNewFirstSequential,
        );
        expect(third.sequencer.getDeckStats(flashcardsPath).newCount).toEqual(3);
        expect(holder.dailyReviewCounts).toEqual({ date: "2023-09-07", newCards: 0, reviews: 0 });
    });

    test("Subdecks share the global budget", async () => {
        const text: string = `#flashcards/a Qa1::A
#flashcards/a Qa2::A
#flashcards/a Qa3::A
#flashcards/b Qb1::A
#flashcards/b Qb2::A
#flashcards/b Qb3::A`;
        const holder = createHolder();
        const { sequencer } = await createSequencer(
            text,
            { newCardsPerDay: 4 },
            FlashcardReviewMode.Review,
            holder,
        );
        const pathA = TopicPath.getTopicPathFromTag("#flashcards/a");
        const pathB = TopicPath.getTopicPathFromTag("#flashcards/b");

        expect(sequencer.getDeckStats(flashcardsPath).newCount).toEqual(4);
        expect(sequencer.getDeckStats(pathA).newCount).toEqual(3);
        expect(sequencer.getDeckStats(pathB).newCount).toEqual(3);

        sequencer.setCurrentDeck(pathA);
        expect(await reviewAll(sequencer)).toEqual(3);

        // Only one new card left in the global budget
        expect(sequencer.getDeckStats(pathB).newCount).toEqual(1);
        expect(sequencer.getDeckStats(flashcardsPath).newCount).toEqual(1);
        sequencer.setCurrentDeck(pathB);
        expect(await reviewAll(sequencer)).toEqual(1);
        expect(holder.dailyReviewCounts.newCards).toEqual(4);
    });

    test("A card requeued in the same session is not counted twice", async () => {
        const holder = createHolder();
        const { sequencer } = await createSequencer(
            "#flashcards Q1::A1 <!--SR:!2023-09-02,4,270-->\n#flashcards Q2::A2 <!--SR:!2023-09-02,4,270-->",
            { maxReviewsPerDay: 1 },
            FlashcardReviewMode.Review,
            holder,
        );
        const card = sequencer.currentCard;
        // Reset moves the card to the end of the list (shown again in this session)
        await sequencer.processReview(ReviewResponse.Reset);
        expect(holder.dailyReviewCounts.reviews).toEqual(1);
        // The other due card is over budget, so the requeued card is shown again
        expect(sequencer.currentCard).toBe(card);
        await sequencer.processReview(ReviewResponse.Good);
        expect(holder.dailyReviewCounts.reviews).toEqual(1);
        expect(sequencer.hasCurrentCard).toEqual(false);
    });

    test("Cram mode ignores the limits", async () => {
        const holder = createHolder({ date: "2023-09-06", newCards: 20, reviews: 200 });
        const { sequencer } = await createSequencer(
            mixedText,
            { newCardsPerDay: 1, maxReviewsPerDay: 1 },
            FlashcardReviewMode.Cram,
            holder,
        );
        const stats = sequencer.getDeckStats(flashcardsPath);
        expect(stats.newCount).toEqual(5);
        expect(stats.dueCount).toEqual(4);

        let count = 0;
        while (sequencer.hasCurrentCard && count < 100) {
            await sequencer.processReview(ReviewResponse.Easy);
            count++;
        }
        expect(count).toEqual(9);
        expect(holder.dailyReviewCounts).toEqual({
            date: "2023-09-06",
            newCards: 20,
            reviews: 200,
        });
    });
});
