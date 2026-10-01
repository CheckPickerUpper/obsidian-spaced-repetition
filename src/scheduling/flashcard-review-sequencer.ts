import { Notice } from "obsidian";

import { TICKS_PER_DAY } from "src/data/constants";
import { DataStore, StorageType } from "src/data/data-store/base/data-store";
import { Card } from "src/data/data-structures/card/card";
import { Question, QuestionText } from "src/data/data-structures/card/questions/question";
import { IQuestionPostponementList } from "src/data/data-structures/card/questions/question-postponement-list";
import {
    CardFrontBack,
    CardFrontBackUtil,
} from "src/data/data-structures/card/questions/question-type";
import { Deck } from "src/data/data-structures/deck/deck";
import { IDeckTreeIterator } from "src/data/data-structures/deck/deck-tree-iterator";
import { TopicPath } from "src/data/data-structures/deck/topic-path";
import { createReviewLogEntry, IReviewLog, ReviewLogEntry } from "src/data/review-log/review-log";
import { SRSettings } from "src/data/settings";
import { t } from "src/lang/helpers";
import { Note } from "src/note/note";
import { ISRAlgorithm } from "src/scheduling/algorithms/base/isr-algorithm";
import { RepItemScheduleInfo } from "src/scheduling/algorithms/base/rep-item-schedule-info";
import { RepItemState, ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";
import { DailyReviewLimiter } from "src/scheduling/daily-review-limits";
import { DueDateHistogram } from "src/scheduling/due-date-histogram";
import { checkForLeech } from "src/scheduling/leech-detection";
import { globalDateProvider } from "src/utils/dates";
import { MultiLineTextFinder } from "src/utils/strings";

export interface IFlashcardReviewSequencer {
    get hasCurrentCard(): boolean;
    get hasPendingCards(): boolean;
    get currentCard(): Card | null;
    get currentQuestion(): Question;
    get currentNote(): Note;
    get currentDeck(): Deck | null;
    get nextPendingDueUnix(): number | null;
    get originalDeckTree(): Deck;

    setDeckTree(originalDeckTree: Deck, remainingDeckTree: Deck): void;
    setCurrentDeck(topicPath: TopicPath): void;
    refreshCurrentDeck(): void;
    getDeckStats(topicPath: TopicPath): DeckStats;
    getSubDecksWithCardsInQueue(deck: Deck): Deck[];
    skipCurrentCard(): void;
    determineCardSchedule(response: ReviewResponse, card: Card): RepItemScheduleInfo;
    processReview(response: ReviewResponse): Promise<void>;
    updateCurrentQuestionTextAndCards(text: string): Promise<void>;
    deleteCurrentCardFromNote(): Promise<void>;
    setDailyReviewLimiter(limiter: DailyReviewLimiter | null): void;
    suspendCurrentCard(): Promise<void>;

    // Undo & review log
    get canUndo(): boolean;
    markCurrentCardShown(): void;
    undoLastReview(): Promise<boolean>;
}

/**
 * Represents statistics for a deck and its subdecks.
 *
 * @property {number} totalCount - Total number of cards in this deck and all subdecks.
 * @property {number} dueCount - Number of due cards in this deck and all subdecks.
 * @property {number} newCount - Number of new cards in this deck and all subdecks.
 * @property {number} cardsInQueueCount - Number of cards in the queue of this deck and all subdecks.
 * @property {number} dueCardsInQueueOfThisDeckCount - Number of due cards just in this deck.
 * @property {number} newCardsInQueueOfThisDeckCount - Number of new cards just in this deck.
 * @property {number} cardsInQueueOfThisDeckCount - Total number of cards in queue just in this deck.
 * @property {number} subDecksInQueueOfThisDeckCount - Number of subdecks in the queue just in this deck.
 * @property {number} decksInQueueOfThisDeckCount - Total number of decks in the queue including this deck and its subdecks.
 *
 * @constructor
 * @param {number} totalCount - Initializes the total count of cards.
 * @param {number} dueCount - Initializes the due count of cards.
 * @param {number} newCount - Initializes the new count of cards.
 * @param {number} cardsInQueueCount - Initializes the count of cards in the queue.
 * @param {number} dueCardsInQueueOfThisDeckCount - Initializes the count of due cards just in this deck.
 * @param {number} newCardsInQueueOfThisDeckCount - Initializes the count of new cards just in this deck.
 * @param {number} cardsInQueueOfThisDeckCount - Initializes the count of all cards in the queue just in this deck.
 * @param {number} subDecksInQueueOfThisDeckCount - Initializes the count of subdecks in the queue just in this deck.
 * @param {number} decksInQueueOfThisDeckCount - Initializes the count of all decks in the queue including this deck and its subdecks.
 */
export class DeckStats {
    totalCount: number;
    dueCount: number;
    newCount: number;
    cardsInQueueCount: number;
    dueCardsInQueueOfThisDeckCount: number;
    newCardsInQueueOfThisDeckCount: number;
    cardsInQueueOfThisDeckCount: number;
    subDecksInQueueOfThisDeckCount: number;
    decksInQueueOfThisDeckCount: number;

    constructor(
        totalCount: number,
        dueCount: number,
        newCount: number,
        cardsInQueueCount: number,
        dueCardsInQueueOfThisDeckCount: number,
        newCardsInQueueOfThisDeckCount: number,
        cardsInQueueOfThisDeckCount: number,
        subDecksInQueueOfThisDeckCount: number,
        decksInQueueOfThisDeckCount: number,
    ) {
        this.dueCount = dueCount;
        this.newCount = newCount;
        this.totalCount = totalCount;
        this.cardsInQueueCount = cardsInQueueCount;
        this.dueCardsInQueueOfThisDeckCount = dueCardsInQueueOfThisDeckCount;
        this.newCardsInQueueOfThisDeckCount = newCardsInQueueOfThisDeckCount;
        this.cardsInQueueOfThisDeckCount = cardsInQueueOfThisDeckCount;
        this.subDecksInQueueOfThisDeckCount = subDecksInQueueOfThisDeckCount;
        this.decksInQueueOfThisDeckCount = decksInQueueOfThisDeckCount;
    }
}

export enum FlashcardReviewMode {
    Cram,
    Review,
}

interface PendingCard {
    card: Card;
    dueUnix: number;
}

/**
 * Everything that is required to revert a single review.
 */
interface UndoRecord {
    card: Card;
    previousSchedule: RepItemScheduleInfo | null;
    // The question text (incl. scheduling comment) before the review, used to restore the note exactly
    previousQuestionText: QuestionText;
    scheduleChanged: boolean;
    // Histogram changes made by the review
    histogramDecrementedDays: number | null;
    histogramIncrementedDays: number | null;
    // Cards of the question that were in the remaining deck tree before the review
    cardsInRemainingDeckTree: Card[];
    wasPostponedBeforeReview: boolean;
    logEntry: ReviewLogEntry | null;
    // Whether this review was counted against the daily limits
    countedInDailyLimit: boolean;
    // Whether this review suspended the card (leech detection)
    suspendedByReview: boolean;
}

export const MAX_UNDO_STACK_SIZE = 50;

export class FlashcardReviewSequencer implements IFlashcardReviewSequencer {
    // We need the original deck tree so that we can still provide the total cards in each deck
    private _originalDeckTree: Deck;

    // This is set by the caller, and must have the same deck hierarchy as originalDeckTree.
    private remainingDeckTree: Deck;

    private reviewMode: FlashcardReviewMode;
    private cardSequencer: IDeckTreeIterator;
    private settings: SRSettings;
    private srsAlgorithm: ISRAlgorithm;
    private questionPostponementList: IQuestionPostponementList;
    private dueDateFlashcardHistogram: DueDateHistogram;
    private pendingCards: PendingCard[] = [];
    private currentTopicPath: TopicPath = TopicPath.emptyPath;
    // Enforces the daily new card / review limits (null = unlimited, e.g. cram mode)
    private dailyReviewLimiter: DailyReviewLimiter | null = null;

    // Undo & review log
    private reviewLog: IReviewLog | null;
    private undoStack: UndoRecord[] = [];
    private shownCard: Card | null = null;
    private shownAtMs: number | null = null;

    constructor(
        reviewMode: FlashcardReviewMode,
        cardSequencer: IDeckTreeIterator,
        settings: SRSettings,
        srsAlgorithm: ISRAlgorithm,
        questionPostponementList: IQuestionPostponementList,
        dueDateFlashcardHistogram: DueDateHistogram,
        reviewLog: IReviewLog | null = null,
    ) {
        this.reviewMode = reviewMode;
        this.cardSequencer = cardSequencer;
        this.settings = settings;
        this.srsAlgorithm = srsAlgorithm;
        this.questionPostponementList = questionPostponementList;
        this.dueDateFlashcardHistogram = dueDateFlashcardHistogram;
        this.reviewLog = reviewLog;
    }

    get hasCurrentCard(): boolean {
        return (
            this.cardSequencer.currentRepItem !== null &&
            this.cardSequencer.currentRepItem !== undefined
        );
    }

    get hasPendingCards(): boolean {
        return this.pendingCards.length > 0;
    }

    get currentCard(): Card | null {
        if (this.cardSequencer.currentRepItem === null) return null;

        return this.cardSequencer.currentRepItem as Card;
    }

    get currentQuestion(): Question {
        return this.currentCard?.question;
    }

    get currentDeck(): Deck | null {
        return this.cardSequencer.currentDeck;
    }

    get nextPendingDueUnix(): number | null {
        return this.pendingCards.length > 0
            ? Math.min(...this.pendingCards.map((pendingCard) => pendingCard.dueUnix))
            : null;
    }

    get currentNote(): Note {
        return this.currentQuestion.note;
    }

    // originalDeckTree isn't modified by the review process
    // Only remainingDeckTree
    setDeckTree(originalDeckTree: Deck, remainingDeckTree: Deck): void {
        this.cardSequencer.setBaseDeck(remainingDeckTree);
        this._originalDeckTree = originalDeckTree;
        this.remainingDeckTree = remainingDeckTree;
        this.pendingCards = [];
        this.undoStack = [];
        this.setCurrentDeck(TopicPath.emptyPath);
    }

    setCurrentDeck(topicPath: TopicPath): void {
        this.currentTopicPath = topicPath;
        this.wakeDuePendingCards();
        this.cardSequencer.setIteratorTopicPath(topicPath);
        this.cardSequencer.nextRepItem();
        this.enforceDailyLimits();
    }

    refreshCurrentDeck(): void {
        this.setCurrentDeck(this.currentTopicPath);
    }

    get originalDeckTree(): Deck {
        return this._originalDeckTree;
    }

    getDeckStats(topicPath: TopicPath): DeckStats {
        this.wakeDuePendingCards();
        const totalCount: number = this._originalDeckTree
            .getDeck(topicPath)
            .getDistinctRepItemCount(RepItemState.AnyItem, true);
        const remainingDeck: Deck = this.remainingDeckTree.getDeck(topicPath);
        const { newCount, dueCount } = this.getQueueCounts(remainingDeck, true);

        // Sry for the long variable names, but I needed all these distinct counts in the UI
        const {
            newCount: newCardsInQueueOfThisDeckCount,
            dueCount: dueCardsInQueueOfThisDeckCount,
        } = this.getQueueCounts(remainingDeck, false);
        const cardsInQueueOfThisDeckCount =
            newCardsInQueueOfThisDeckCount + dueCardsInQueueOfThisDeckCount;

        const subDecksInQueueOfThisDeckCount =
            this.getSubDecksWithCardsInQueue(remainingDeck).length;
        const decksInQueueOfThisDeckCount =
            cardsInQueueOfThisDeckCount > 0
                ? subDecksInQueueOfThisDeckCount + 1
                : subDecksInQueueOfThisDeckCount;

        return new DeckStats(
            totalCount,
            dueCount,
            newCount,
            dueCount + newCount,
            dueCardsInQueueOfThisDeckCount,
            newCardsInQueueOfThisDeckCount,
            cardsInQueueOfThisDeckCount,
            subDecksInQueueOfThisDeckCount,
            decksInQueueOfThisDeckCount,
        );
    }

    getSubDecksWithCardsInQueue(deck: Deck): Deck[] {
        this.wakeDuePendingCards();
        let subDecksWithCardsInQueue: Deck[] = [];

        deck.subdecks.forEach((subDeck) => {
            subDecksWithCardsInQueue = subDecksWithCardsInQueue.concat(
                this.getSubDecksWithCardsInQueue(subDeck),
            );

            const { newCount, dueCount } = this.getQueueCounts(subDeck, false);
            if (newCount + dueCount > 0) subDecksWithCardsInQueue.push(subDeck);
        });

        return subDecksWithCardsInQueue;
    }

    skipCurrentCard(): void {
        this.cardSequencer.deleteCurrentQuestionFromAllDecks();
        this.enforceDailyLimits();
    }

    private deleteCurrentCard(): void {
        this.cardSequencer.deleteCurrentRepItemFromAllDecks();
    }

    async processReview(response: ReviewResponse): Promise<void> {
        const card: Card | null = this.currentCard;
        const undoRecord: UndoRecord | null = card ? this.createUndoRecord(card) : null;

        switch (this.reviewMode) {
            case FlashcardReviewMode.Review:
                await this.processReviewReviewMode(response, undoRecord);
                break;

            case FlashcardReviewMode.Cram:
                this.processReviewCramMode(response);
                break;
        }
        if (undoRecord !== null) {
            this.undoStack.push(undoRecord);
            if (this.undoStack.length > MAX_UNDO_STACK_SIZE) this.undoStack.shift();
        }
        this.enforceDailyLimits();
    }

    async processReviewReviewMode(
        response: ReviewResponse,
        undoRecord: UndoRecord | null = null,
    ): Promise<void> {
        // Count against the daily limits (before the schedule changes, so new cards can be identified)
        if (
            this.dailyReviewLimiter &&
            (response !== ReviewResponse.Reset || this.currentCard.hasSchedule)
        ) {
            if (undoRecord && !this.dailyReviewLimiter.isCountedThisSession(this.currentCard)) {
                undoRecord.countedInDailyLimit = true;
            }
            await this.dailyReviewLimiter.recordReview(this.currentCard);
        }
        let shortTermRequeue: "none" | "immediate" | "pending" = "none";
        if (response !== ReviewResponse.Reset || this.currentCard.hasSchedule) {
            const oldSchedule = this.currentCard.scheduleInfo;

            // We need to update the schedule if:
            //  (1) the user reviewed with easy/good/hard (either a new or due card),
            //  (2) or reset a due card
            // Nothing to do if a user resets a new card
            this.currentCard.scheduleInfo = this.determineCardSchedule(response, this.currentCard);
            this.applyLeechDetection(response, oldSchedule);
            shortTermRequeue = this.getShortTermRequeueMode(this.currentCard.scheduleInfo);

            // Update the source file with the updated schedule
            await DataStore.getInstance().writeSchedule(this.currentQuestion);

            if (oldSchedule) {
                const now: number = globalDateProvider.now.valueOf();
                const nDays: number = Math.ceil((oldSchedule.dueDateAsUnix - now) / TICKS_PER_DAY);

                // (decrement() doesn't go below zero, so only remember it if it had an effect)
                if (undoRecord && (this.dueDateFlashcardHistogram.get(nDays) ?? 0) > 0) {
                    undoRecord.histogramDecrementedDays = nDays;
                }
                this.dueDateFlashcardHistogram.decrement(nDays);
            }
            this.dueDateFlashcardHistogram.increment(this.currentCard.scheduleInfo.interval);

            if (undoRecord) {
                undoRecord.scheduleChanged = true;
                undoRecord.histogramIncrementedDays = this.currentCard.scheduleInfo.interval;
                undoRecord.logEntry = this.logReview(
                    this.currentCard,
                    response,
                    oldSchedule,
                    this.currentCard.scheduleInfo,
                );
            }
        } else if (response === ReviewResponse.Reset) {
            shortTermRequeue = "immediate";
        }

        // A card suspended as a leech must not be requeued
        if (this.currentCard.isSuspended) {
            if (undoRecord) undoRecord.suspendedByReview = true;
            this.removeCurrentCardFromSession();
            return;
        }

        if (shortTermRequeue === "pending") {
            await this.handlePendingRequeue();
        } else if (shortTermRequeue === "immediate" || response === ReviewResponse.Reset) {
            if (this.settings.burySiblingCards) {
                await this.burySiblingCards();
                this.deleteSiblingCardsFromAllDecks();
            }
            this.cardSequencer.moveCurrentRepItemToEndOfList();
            this.cardSequencer.nextRepItem();
        } else {
            if (this.settings.burySiblingCards) {
                await this.burySiblingCards();
                this.cardSequencer.deleteCurrentQuestionFromAllDecks();
            } else {
                this.deleteCurrentCard();
            }
        }
    }

    private async burySiblingCards(): Promise<void> {
        // We check if there are any sibling cards still in the deck,
        // We do this because otherwise we would be adding every reviewed card to the postponement list, even for a
        // question with a single card. That isn't consistent with the 1.10.1 behavior
        const remaining = this.currentDeck.getQuestionRepItemCount(this.currentQuestion);
        if (remaining > 1) {
            this.questionPostponementList.add(this.currentQuestion);
            await this.questionPostponementList.write();
        }
    }

    private deleteSiblingCardsFromAllDecks(): void {
        for (const siblingCard of this.currentQuestion.cards) {
            if (Object.is(siblingCard, this.currentCard)) {
                continue;
            }

            this.remainingDeckTree.deleteCardFromAllDecks(siblingCard, false);
        }
    }

    private async handlePendingRequeue(): Promise<void> {
        const pendingCard = this.currentCard;
        const dueUnix = pendingCard.scheduleInfo?.dueDateAsUnix;

        if (this.settings.burySiblingCards) {
            await this.burySiblingCards();
            this.cardSequencer.deleteCurrentQuestionFromAllDecks();
        } else {
            this.cardSequencer.deleteCurrentRepItemFromAllDecks();
        }

        this.pendingCards.push({ card: pendingCard, dueUnix });
    }

    processReviewCramMode(response: ReviewResponse): void {
        if (response === ReviewResponse.Easy) this.deleteCurrentCard();
        else {
            this.cardSequencer.moveCurrentRepItemToEndOfList();
            this.cardSequencer.nextRepItem();
        }
    }

    private getShortTermRequeueMode(
        scheduleInfo: RepItemScheduleInfo | null,
    ): "none" | "immediate" | "pending" {
        if (!scheduleInfo || scheduleInfo.interval >= 1) {
            return "none";
        }

        return scheduleInfo.isDue() ? "immediate" : "pending";
    }

    private wakeDuePendingCards(): void {
        if (this.pendingCards.length === 0) {
            return;
        }

        const nowUnix = globalDateProvider.now.valueOf();
        const remainingPendingCards: PendingCard[] = [];
        for (const pendingCard of this.pendingCards) {
            if (pendingCard.dueUnix <= nowUnix) {
                this.remainingDeckTree.appendRepItem(
                    pendingCard.card.question.topicPathList,
                    pendingCard.card,
                );
            } else {
                remainingPendingCards.push(pendingCard);
            }
        }

        this.pendingCards = remainingPendingCards;
    }

    // #region Undo & review log

    get canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    /**
     * Records the time at which the current card was shown to the user,
     * so that the time spent on the card can be logged.
     */
    markCurrentCardShown(): void {
        this.shownCard = this.currentCard;
        this.shownAtMs = Date.now();
    }

    private logReview(
        card: Card,
        response: ReviewResponse,
        before: RepItemScheduleInfo | null,
        after: RepItemScheduleInfo | null,
    ): ReviewLogEntry | null {
        if (this.reviewLog === null || !this.settings.enableReviewLog) return null;

        const timeMs: number | null =
            this.shownCard === card && this.shownAtMs !== null
                ? Math.max(0, Date.now() - this.shownAtMs)
                : null;
        const entry: ReviewLogEntry = createReviewLogEntry(
            card,
            response,
            before,
            after,
            globalDateProvider.now.valueOf(),
            timeMs,
        );
        this.reviewLog.add(entry);
        return entry;
    }

    private createUndoRecord(card: Card): UndoRecord {
        const cardsInRemainingDeckTree: Card[] = (card.question.cards ?? [card]).filter(
            (questionCard) => this.isCardInRemainingDeckTree(questionCard),
        );
        if (!cardsInRemainingDeckTree.includes(card)) cardsInRemainingDeckTree.push(card);

        return {
            card,
            previousSchedule: card.scheduleInfo,
            previousQuestionText: card.question.questionText,
            scheduleChanged: false,
            histogramDecrementedDays: null,
            histogramIncrementedDays: null,
            cardsInRemainingDeckTree,
            wasPostponedBeforeReview: this.questionPostponementList.includes(card.question),
            logEntry: null,
            countedInDailyLimit: false,
            suspendedByReview: false,
        };
    }

    private getTopicPathsOfCard(card: Card): TopicPath[] {
        return card.question.topicPathList.list.length > 0
            ? card.question.topicPathList.list
            : [TopicPath.emptyPath];
    }

    private isCardInRemainingDeckTree(card: Card): boolean {
        return this.getTopicPathsOfCard(card).some((topicPath) => {
            const deck: Deck | null = this.remainingDeckTree.getDeck(topicPath);
            return (
                deck !== null &&
                (deck.newRepItems.includes(card) || deck.dueRepItems.includes(card))
            );
        });
    }

    private prependCardToRemainingDeckTree(card: Card): void {
        for (const topicPath of this.getTopicPathsOfCard(card)) {
            const deck: Deck = this.remainingDeckTree.getOrCreateDeck(topicPath);
            deck.getRepItemListForRepItemState(card.repItemState).unshift(card);
        }
    }

    /**
     * Restores the exact text of the question (incl. its scheduling comment) within the note.
     *
     * @returns false if the text couldn't be restored (e.g. because the note was modified meanwhile)
     */
    private async restorePreviousQuestionText(
        question: Question,
        previousQuestionText: QuestionText,
    ): Promise<boolean> {
        if (!previousQuestionText || DataStore.getInstance().storageType !== StorageType.NOTES) {
            return false;
        }
        if (previousQuestionText === question.questionText) return true;

        const fileText: string = await question.note.file.read();
        const newText: string | null = MultiLineTextFinder.findAndReplace(
            fileText,
            question.questionText.original,
            previousQuestionText.original,
        );
        if (!newText) return false;

        await question.note.file.write(newText);
        question.questionText = previousQuestionText;
        return true;
    }

    /**
     * Reverts the last review: restores the previous schedule of the card (in the note as well),
     * puts the card back at the front of the queue, reverts the deck counts and removes the
     * review log entry.
     *
     * @returns true if a review was undone
     */
    async undoLastReview(): Promise<boolean> {
        const record: UndoRecord | undefined = this.undoStack.pop();
        if (record === undefined) return false;

        const card: Card = record.card;
        const question: Question = card.question;

        // Take the question's cards out of the queue, they are added back below
        this.remainingDeckTree.deleteQuestionFromAllDecks(question, false);
        this.pendingCards = this.pendingCards.filter(
            (pendingCard) => !question.cards.includes(pendingCard.card),
        );

        // Un-bury the siblings, if they were buried by the review
        if (!record.wasPostponedBeforeReview && this.questionPostponementList.includes(question)) {
            this.questionPostponementList.remove(question);
            await this.questionPostponementList.write();
        }

        // Un-suspend the card, if it was suspended by the review (leech detection)
        if (record.suspendedByReview) card.isSuspended = false;

        // Restore the previous schedule
        if (record.scheduleChanged) {
            card.scheduleInfo = record.previousSchedule;
            if (!(await this.restorePreviousQuestionText(question, record.previousQuestionText))) {
                await DataStore.getInstance().writeSchedule(question);
            }

            if (record.histogramIncrementedDays !== null) {
                this.dueDateFlashcardHistogram.decrement(record.histogramIncrementedDays);
            }
            if (record.histogramDecrementedDays !== null) {
                this.dueDateFlashcardHistogram.increment(record.histogramDecrementedDays);
            }
        }

        if (record.logEntry !== null && this.reviewLog !== null) {
            await this.reviewLog.remove(record.logEntry);
        }

        if (record.countedInDailyLimit && this.dailyReviewLimiter !== null) {
            await this.dailyReviewLimiter.unrecordReview(card);
        }

        // A suspended card was removed from the deck totals, so add it back
        if (record.suspendedByReview) {
            for (const topicPath of this.getTopicPathsOfCard(card)) {
                const deck: Deck = this._originalDeckTree.getOrCreateDeck(topicPath);
                const list: Card[] = deck.getRepItemListForRepItemState(card.repItemState);
                if (!list.includes(card)) list.push(card);
            }
        }

        // Put the cards back into the queue, the reviewed card at the very front
        for (const questionCard of [...record.cardsInRemainingDeckTree].reverse()) {
            if (questionCard !== card) this.prependCardToRemainingDeckTree(questionCard);
        }
        this.prependCardToRemainingDeckTree(card);

        this.cardSequencer.setIteratorTopicPath(this.currentTopicPath);
        if (!this.cardSequencer.setCurrentRepItem(card)) {
            this.cardSequencer.nextRepItem();
        }
        this.shownCard = null;
        this.shownAtMs = null;
        return true;
    }

    // #endregion

    determineCardSchedule(response: ReviewResponse, card: Card): RepItemScheduleInfo {
        let result: RepItemScheduleInfo;

        if (response === ReviewResponse.Reset) {
            // Resetting the card schedule
            result = this.srsAlgorithm.cardGetResetSchedule();
        } else {
            // scheduled card
            if (card.hasSchedule) {
                result = this.srsAlgorithm.cardCalcUpdatedSchedule(
                    response,
                    card.scheduleInfo,
                    this.dueDateFlashcardHistogram,
                );
            } else {
                const currentNote: Note = card.question.note;
                result = this.srsAlgorithm.cardGetNewSchedule(
                    response,
                    currentNote.filePath,
                    this.dueDateFlashcardHistogram,
                );
            }
        }
        return result;
    }

    async updateCurrentQuestionTextAndCards(text: string): Promise<void> {
        const question = this.currentQuestion;
        const q: QuestionText = question.questionText;

        // Update front/back properties of all cards which question is linked to
        const cardFrontBackList: CardFrontBack[] = CardFrontBackUtil.expand(
            question.questionType,
            text,
            this.settings,
        );

        q.actualQuestion = text;

        await this.currentQuestion.writeQuestion(this.settings);

        if (cardFrontBackList.length !== question.cards.length) {
            console.warn("SR: Cards count does not match question text. Skipping redraw.");
            new Notice("Cards count does not match cards from question text. Skipping redraw.");
            return;
        }
        question.cards.forEach((card, i) => {
            const { front, back } = cardFrontBackList[i];
            card.front = front;
            card.back = back;
        });
    }

    async deleteCurrentCardFromNote(): Promise<void> {
        const question = this.currentQuestion;
        await DataStore.getInstance().delete(question);
        this.undoStack = this.undoStack.filter((record) => record.card.question !== question);
        this._originalDeckTree.deleteQuestionFromAllDecks(question, false);
        this.cardSequencer.deleteCurrentQuestionFromAllDecks();
        this.enforceDailyLimits();
    }

    // #region Daily limits

    setDailyReviewLimiter(limiter: DailyReviewLimiter | null): void {
        this.dailyReviewLimiter = limiter;
        if (this._originalDeckTree) this.enforceDailyLimits();
    }

    private get isDailyLimitActive(): boolean {
        return this.dailyReviewLimiter !== null && this.reviewMode === FlashcardReviewMode.Review;
    }

    /**
     * Gets the distinct new/due counts of the deck, limited to the remaining daily budget (if any).
     */
    private getQueueCounts(
        deck: Deck,
        includeSubdecks: boolean,
    ): { newCount: number; dueCount: number } {
        if (this.isDailyLimitActive) {
            return this.dailyReviewLimiter.getLimitedCounts(deck, includeSubdecks);
        }
        return {
            newCount: deck.getDistinctRepItemCount(RepItemState.NewItem, includeSubdecks),
            dueCount: deck.getDistinctRepItemCount(RepItemState.DueItem, includeSubdecks),
        };
    }

    /**
     * Removes cards from the queue (for the rest of this session) while the current card exceeds the daily budget.
     */
    private enforceDailyLimits(): void {
        if (!this.isDailyLimitActive) return;
        while (this.hasCurrentCard && !this.dailyReviewLimiter.isAllowed(this.currentCard)) {
            this.cardSequencer.deleteCurrentRepItemFromAllDecks();
        }
    }

    // #endregion

    /**
     * Suspends the current card: the suspended marker is written to the note and the card is removed from
     * this review session (and from the deck totals).
     */
    async suspendCurrentCard(): Promise<void> {
        const card = this.currentCard;
        if (!card) return;

        card.isSuspended = true;
        await DataStore.getInstance().writeSchedule(this.currentQuestion);
        this.removeCurrentCardFromSession();
        this.enforceDailyLimits();
    }

    private removeCurrentCardFromSession(): void {
        const card = this.currentCard;
        this._originalDeckTree.deleteCardFromAllDecks(card, false);
        this.cardSequencer.deleteCurrentRepItemFromAllDecks();
    }

    /**
     * Checks whether the latest review turned the current card into a leech, and if so shows a notice and
     * (depending on the settings) marks the card as suspended. The caller is responsible for persisting the card.
     */
    private applyLeechDetection(
        response: ReviewResponse,
        oldSchedule: RepItemScheduleInfo | null,
    ): void {
        const card = this.currentCard;
        const leech = checkForLeech(this.settings, response, oldSchedule, card.scheduleInfo);
        if (!leech.isLeech) return;

        if (leech.action === "suspend") {
            card.isSuspended = true;
            new Notice(t("LEECH_SUSPENDED", { lapses: leech.lapses }));
        } else {
            new Notice(t("LEECH_DETECTED", { lapses: leech.lapses }));
        }
    }
}
