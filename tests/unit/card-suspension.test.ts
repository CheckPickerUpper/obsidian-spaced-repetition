import moment from "moment";
import { Notice } from "obsidian";
import { State } from "ts-fsrs";

import { QuestionPostponementList } from "src/data/data-structures/card/questions/question-postponement-list";
import { Deck, DeckTreeFilter } from "src/data/data-structures/deck/deck";
import {
    DeckOrder,
    DeckTreeIterator,
    RepItemOrder,
} from "src/data/data-structures/deck/deck-tree-iterator";
import { TopicPath } from "src/data/data-structures/deck/topic-path";
import { DEFAULT_SETTINGS, SRSettings } from "src/data/settings";
import { Note } from "src/note/note";
import { NoteFileLoader } from "src/note/note-file-loader";
import { RepItemState, ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";
import { SRAlgorithm } from "src/scheduling/algorithms/base/sr-algorithm";
import { RepItemScheduleInfoFsrs } from "src/scheduling/algorithms/fsrs/rep-item-schedule-info-fsrs";
import { CardDueDateHistogram } from "src/scheduling/due-date-histogram";
import {
    FlashcardReviewMode,
    FlashcardReviewSequencer,
} from "src/scheduling/flashcard-review-sequencer";
import { setupStaticDateProvider20230906 } from "src/utils/dates";
import { TextDirection } from "src/utils/strings";

import { UnitTestSRFile } from "./helpers/unit-test-file";
import { unitTestSetupStandardDataStoreAlgorithm } from "./helpers/unit-test-setup";

const FSRS_SEGMENT = "fsrs,2023-09-05T00:10:00.000Z,3,0.4,5.5,2,12,7,0,2023-09-01T00:00:00.000Z";

beforeAll(() => {
    setupStaticDateProvider20230906();
    unitTestSetupStandardDataStoreAlgorithm(DEFAULT_SETTINGS);
});

async function loadNote(text: string, settings: SRSettings = DEFAULT_SETTINGS) {
    const file = new UnitTestSRFile(text);
    const note: Note = await new NoteFileLoader(settings).load(
        file,
        TextDirection.Ltr,
        TopicPath.emptyPath,
    );
    return { file, note };
}

function fsrsSchedule(lapses: number): RepItemScheduleInfoFsrs {
    return new RepItemScheduleInfoFsrs(
        moment("2023-09-06T00:10:00.000Z"),
        0,
        6,
        0.5,
        State.Relearning,
        13,
        lapses,
        0,
        moment("2023-09-06T00:00:00.000Z"),
    );
}

async function createSequencer(text: string, settings: SRSettings) {
    unitTestSetupStandardDataStoreAlgorithm(settings);
    const { file, note } = await loadNote(text, settings);
    const deckTree = new Deck("Root", null);
    note.appendCardsToDeck(deckTree);
    const postponementList = new QuestionPostponementList(null, settings, []);
    const remaining = DeckTreeFilter.filterForRemainingRepItems(
        postponementList,
        deckTree,
        FlashcardReviewMode.Review,
    );
    const sequencer = new FlashcardReviewSequencer(
        FlashcardReviewMode.Review,
        new DeckTreeIterator(
            {
                repItemOrder: RepItemOrder.DueFirstSequential,
                deckOrder: DeckOrder.PrevDeckComplete_Sequential,
            },
            null,
        ),
        settings,
        SRAlgorithm.getInstance(),
        postponementList,
        new CardDueDateHistogram(),
    );
    sequencer.setDeckTree(deckTree, remaining);
    return { file, note, deckTree, sequencer };
}

describe("Parsing suspended cards from notes", () => {
    test("Cards without the marker are not suspended", async () => {
        const { note } = await loadNote(`#flashcards
Q1::A1
<!--SR:!2023-09-02,4,270-->
Q2::A2`);
        const cards = note.questionList.flatMap((q) => q.cards);
        expect(cards.map((c) => c.isSuspended)).toEqual([false, false]);
    });

    test("Suspended SM-2, FSRS and new cards are flagged per sibling", async () => {
        const { note } = await loadNote(`#flashcards
Q1::A1
<!--SR:!2023-09-02,4,270,suspended-->
Q2:::A2
<!--SR:!2000-01-01,1,250,suspended!2023-09-02,5,270-->
Q3::A3
<!--SR:!${FSRS_SEGMENT},suspended-->`);
        const [q1, q2, q3] = note.questionList;
        expect(q1.cards[0].isSuspended).toEqual(true);
        expect(q1.cards[0].scheduleInfo.interval).toEqual(4);
        expect(q2.cards.map((c) => c.isSuspended)).toEqual([true, false]);
        expect(q2.cards[0].isNew).toEqual(true);
        expect(q3.cards[0].isSuspended).toEqual(true);
        expect((q3.cards[0].scheduleInfo as RepItemScheduleInfoFsrs).lapses).toEqual(7);
    });

    test("Suspended cards are excluded from the deck (review, cram and counts)", async () => {
        const { note } = await loadNote(`#flashcards
Q1::A1
<!--SR:!2023-09-02,4,270,suspended-->
Q2::A2
<!--SR:!2023-09-02,4,270-->
Q3::A3`);
        const deck = new Deck("Root", null);
        note.appendCardsToDeck(deck);
        const fronts = deck
            .getFlattenedRepItemArray(RepItemState.AnyItem, true)
            .map((card) => card.front);
        expect(fronts.sort()).toEqual(["Q2", "Q3"]);
        expect(deck.getDistinctRepItemCount(RepItemState.DueItem, true)).toEqual(1);
        expect(deck.getDistinctRepItemCount(RepItemState.NewItem, true)).toEqual(1);
    });

    test("Writing the note keeps the suspended markers (SM-2 and FSRS)", async () => {
        const text = `#flashcards
Q1::A1
<!--SR:!2023-09-02,4,270,suspended-->
Q2:::A2
<!--SR:!2000-01-01,1,250,suspended!2023-09-02,5,270-->
Q3::A3
<!--SR:!${FSRS_SEGMENT},suspended-->
`;
        const { file, note } = await loadNote(text);
        note.questionList.forEach((q) => (q.hasChanged = true));
        await note.writeNoteFile(DEFAULT_SETTINGS);
        expect(file.content).toEqual(text);
    });

    test("Suspending a new card without any schedule writes a placeholder with the marker", async () => {
        const { file, note } = await loadNote(`#flashcards
Q1::A1
`);
        const question = note.questionList[0];
        question.cards[0].isSuspended = true;
        question.hasChanged = true;
        await note.writeNoteFile(DEFAULT_SETTINGS);
        expect(file.content).toEqual(`#flashcards
Q1::A1
<!--SR:!2000-01-01,1,250,suspended-->
`);

        const reloaded = await loadNote(file.content);
        expect(reloaded.note.questionList[0].cards[0].isSuspended).toEqual(true);
        expect(reloaded.note.questionList[0].cards[0].isNew).toEqual(true);
    });
});

describe("FlashcardReviewSequencer - suspension", () => {
    test("suspendCurrentCard writes the marker and removes the card from the session", async () => {
        const settings: SRSettings = { ...DEFAULT_SETTINGS };
        const { file, sequencer } = await createSequencer(
            `#flashcards
Q1::A1
<!--SR:!2023-09-02,4,270-->
Q2::A2
<!--SR:!2023-09-02,4,270-->`,
            settings,
        );

        expect(sequencer.currentCard.front).toEqual("Q1");
        expect(sequencer.getDeckStats(TopicPath.emptyPath).totalCount).toEqual(2);

        await sequencer.suspendCurrentCard();

        expect(file.content).toContain("Q1::A1\n<!--SR:!2023-09-02,4,270,suspended-->");
        expect(file.content).toContain("Q2::A2\n<!--SR:!2023-09-02,4,270-->");
        expect(sequencer.currentCard.front).toEqual("Q2");
        const stats = sequencer.getDeckStats(TopicPath.emptyPath);
        expect(stats.totalCount).toEqual(1);
        expect(stats.dueCount).toEqual(1);
    });
});

describe("FlashcardReviewSequencer - leech detection", () => {
    const text = `#flashcards
Q1::A1
<!--SR:!${FSRS_SEGMENT}-->
Q2::A2
<!--SR:!2023-09-02,4,270-->`;

    beforeEach(() => {
        (Notice as unknown as jest.Mock).mockClear();
    });

    test("Reaching the threshold suspends the card and shows a notice", async () => {
        const settings: SRSettings = { ...DEFAULT_SETTINGS, leechThreshold: 8 };
        const { file, sequencer } = await createSequencer(text, settings);
        jest.spyOn(sequencer, "determineCardSchedule").mockReturnValue(fsrsSchedule(8));

        expect(sequencer.currentCard.front).toEqual("Q1");
        await sequencer.processReview(ReviewResponse.Again);

        expect(Notice).toHaveBeenCalledTimes(1);
        expect(file.content).toMatch(/Q1::A1\n<!--SR:!fsrs,[^>]*,8,0,[^>]*,suspended-->/);
        // The card isn't requeued, even though FSRS scheduled it as short term
        expect(sequencer.hasPendingCards).toEqual(false);
        expect(sequencer.currentCard.front).toEqual("Q2");
        expect(sequencer.getDeckStats(TopicPath.emptyPath).totalCount).toEqual(1);
    });

    test("Notice-only action keeps the card in review", async () => {
        const settings: SRSettings = {
            ...DEFAULT_SETTINGS,
            leechThreshold: 8,
            leechAction: "notice",
        };
        const { file, sequencer } = await createSequencer(text, settings);
        jest.spyOn(sequencer, "determineCardSchedule").mockReturnValue(fsrsSchedule(8));

        await sequencer.processReview(ReviewResponse.Again);

        expect(Notice).toHaveBeenCalledTimes(1);
        expect(file.content).not.toContain("suspended");
        expect(sequencer.getDeckStats(TopicPath.emptyPath).totalCount).toEqual(2);
    });

    test("Below threshold or disabled: no leech", async () => {
        for (const leechThreshold of [9, 0]) {
            const settings: SRSettings = { ...DEFAULT_SETTINGS, leechThreshold };
            const { file, sequencer } = await createSequencer(text, settings);
            jest.spyOn(sequencer, "determineCardSchedule").mockReturnValue(fsrsSchedule(8));

            await sequencer.processReview(ReviewResponse.Again);

            expect(Notice).not.toHaveBeenCalled();
            expect(file.content).not.toContain("suspended");
        }
    });
});
