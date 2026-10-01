import { Moment } from "moment";

import { Card } from "src/data/data-structures/card/card";
import { Deck } from "src/data/data-structures/deck/deck";
import { DEFAULT_DAILY_REVIEW_COUNTS, IDailyReviewCounts } from "src/data/plugin-data";
import { SRSettings } from "src/data/settings";
import { RepItemState } from "src/scheduling/algorithms/base/repetition-item";
import { DateUtil, globalDateProvider } from "src/utils/dates";

/**
 * Anything that holds the persisted daily counters (in practice the plugin data).
 */
export interface IDailyReviewCountsHolder {
    dailyReviewCounts: IDailyReviewCounts;
}

/**
 * Returns the key ("YYYY-MM-DD") of the review day that `now` belongs to.
 *
 * The review day starts at `startOfDay` (format "HH:MM:SS"). E.g. with a start of day of "04:00:00",
 * 2024-01-02 03:59:59 still belongs to the review day "2024-01-01".
 * An invalid `startOfDay` is treated as midnight.
 *
 * @param {Moment} now - The current moment.
 * @param {string} startOfDay - The start of day setting.
 * @returns {string} - The review day key.
 */
export function getReviewDayKey(now: Moment, startOfDay: string): string {
    const day: Moment = now.clone();
    const boundary = DateUtil.strToDayBoundary(startOfDay ?? "");
    if (boundary !== null) {
        const boundaryToday: Moment = now
            .clone()
            .hour(boundary.hour)
            .minute(boundary.minute)
            .second(boundary.second)
            .millisecond(0);
        if (now.isBefore(boundaryToday)) {
            day.subtract(1, "day");
        }
    }
    return day.format("YYYY-MM-DD");
}

/**
 * Converts a daily limit setting into a usable limit.
 *
 * A value of 0, an empty value or an invalid/negative value means "unlimited".
 *
 * @param {number | null | undefined} value - The setting value.
 * @returns {number} - The limit, or Infinity if unlimited.
 */
export function normalizeDailyLimit(value: number | null | undefined): number {
    if (value === null || value === undefined) return Infinity;
    const n: number = Number(value);
    if (!Number.isFinite(n) || n <= 0) return Infinity;
    return Math.floor(n);
}

/**
 * Tracks and enforces the daily limits for new cards and reviews (settings `newCardsPerDay` and
 * `maxReviewsPerDay`).
 *
 * - The budget is global: it is shared by all decks, so reviewing a subdeck consumes the same budget.
 * - The counters are persisted in the plugin data and reset when the review day rolls over
 *   (respecting the `startOfDay` setting).
 * - Each card is counted at most once per review session (i.e. learning-step requeues of a card within the
 *   same session don't consume additional budget, and are always allowed to be shown again).
 * - Cram mode doesn't use a limiter at all.
 */
export class DailyReviewLimiter {
    private holder: IDailyReviewCountsHolder;
    private settings: SRSettings;
    private save: (() => Promise<void>) | null;
    private countedThisSession: Set<Card> = new Set();

    constructor(
        holder: IDailyReviewCountsHolder,
        settings: SRSettings,
        save: (() => Promise<void>) | null = null,
    ) {
        this.holder = holder;
        this.settings = settings;
        this.save = save;
        this.rolloverIfNewDay();
    }

    get newCardLimit(): number {
        return normalizeDailyLimit(this.settings.newCardsPerDay);
    }

    get reviewLimit(): number {
        return normalizeDailyLimit(this.settings.maxReviewsPerDay);
    }

    /**
     * Returns the counters for the current review day (resetting them first if the day rolled over).
     */
    get counts(): IDailyReviewCounts {
        this.rolloverIfNewDay();
        return this.holder.dailyReviewCounts;
    }

    get remainingNewCards(): number {
        return Math.max(0, this.newCardLimit - this.counts.newCards);
    }

    get remainingReviews(): number {
        return Math.max(0, this.reviewLimit - this.counts.reviews);
    }

    /**
     * Resets the counters if they belong to a previous review day.
     *
     * @returns {boolean} - True if the counters were reset.
     */
    rolloverIfNewDay(): boolean {
        const today: string = getReviewDayKey(globalDateProvider.now, this.settings.startOfDay);
        let counts: IDailyReviewCounts | undefined = this.holder.dailyReviewCounts;
        if (counts === null || counts === undefined || typeof counts !== "object") {
            counts = { ...DEFAULT_DAILY_REVIEW_COUNTS };
            this.holder.dailyReviewCounts = counts;
        }
        if (counts.date === today) return false;

        counts.date = today;
        counts.newCards = 0;
        counts.reviews = 0;
        this.countedThisSession.clear();
        return true;
    }

    /**
     * Whether the card has already been counted against the budget in this session.
     */
    isCountedThisSession(card: Card): boolean {
        return this.countedThisSession.has(card);
    }

    /**
     * Whether the card may (still) be shown, given the remaining budget.
     *
     * @param {Card} card - The card.
     * @returns {boolean} - True if the card is within the budget.
     */
    isAllowed(card: Card): boolean {
        if (this.countedThisSession.has(card)) return true;
        return card.isNew ? this.remainingNewCards > 0 : this.remainingReviews > 0;
    }

    /**
     * Records that the card was answered. Must be called before the card's schedule is updated,
     * so that new cards can be distinguished from reviews.
     *
     * @param {Card} card - The answered card.
     * @returns {Promise<void>}
     */
    async recordReview(card: Card): Promise<void> {
        if (!card) return;
        const counts: IDailyReviewCounts = this.counts;
        if (this.countedThisSession.has(card)) return;

        this.countedThisSession.add(card);
        if (card.isNew) counts.newCards++;
        else counts.reviews++;

        if (this.save) await this.save();
    }

    /**
     * Reverts {@link recordReview} for the card (e.g. when the review is undone).
     * Must be called after the card's previous schedule has been restored, so new cards can be identified.
     *
     * @param {Card} card - The card.
     */
    async unrecordReview(card: Card): Promise<void> {
        if (!card || !this.countedThisSession.has(card)) return;
        const counts: IDailyReviewCounts = this.counts;

        this.countedThisSession.delete(card);
        if (card.isNew) counts.newCards = Math.max(0, counts.newCards - 1);
        else counts.reviews = Math.max(0, counts.reviews - 1);

        if (this.save) await this.save();
    }

    /**
     * Calculates the number of (distinct) new & due cards within the deck that fit in the remaining budget.
     *
     * @param {Deck} deck - The deck.
     * @param {boolean} includeSubdecks - Whether to include the subdecks.
     * @returns {{ newCount: number; dueCount: number }} - The limited counts.
     */
    getLimitedCounts(deck: Deck, includeSubdecks: boolean): { newCount: number; dueCount: number } {
        return {
            newCount: this.limitCount(
                deck.getFlattenedRepItemArray(RepItemState.NewItem, includeSubdecks),
                this.remainingNewCards,
            ),
            dueCount: this.limitCount(
                deck.getFlattenedRepItemArray(RepItemState.DueItem, includeSubdecks),
                this.remainingReviews,
            ),
        };
    }

    private limitCount(items: Card[], remaining: number): number {
        const distinct: Set<Card> = new Set(items);
        let counted: number = 0;
        for (const card of distinct) {
            if (this.countedThisSession.has(card)) counted++;
        }
        return counted + Math.min(distinct.size - counted, remaining);
    }
}
