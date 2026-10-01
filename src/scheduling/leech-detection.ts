import { LeechAction, SRSettings } from "src/data/settings";
import { RepItemScheduleInfo } from "src/scheduling/algorithms/base/rep-item-schedule-info";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";
import { RepItemScheduleInfoFsrs } from "src/scheduling/algorithms/fsrs/rep-item-schedule-info-fsrs";

/**
 * Result of the leech check for a single review.
 */
export interface ILeechCheckResult {
    isLeech: boolean;
    lapses: number;
    action: LeechAction;
}

/**
 * Determines whether a review just turned a card into a leech.
 *
 * A card is a leech when an "Again" answer increases its lapse count and the lapse count reaches
 * (or exceeds) `settings.leechThreshold`. A threshold of 0 disables leech detection.
 *
 * NOTE: Only FSRS tracks lapses in its schedule data. The SM-2/OSR comment format
 * (`!date,interval,ease`) has no lapse counter, so leech detection is FSRS-only.
 *
 * @param settings - The plugin settings.
 * @param response - The review response.
 * @param oldSchedule - The schedule before the review (null for a new card).
 * @param newSchedule - The schedule after the review.
 * @returns The leech check result.
 */
export function checkForLeech(
    settings: SRSettings,
    response: ReviewResponse,
    oldSchedule: RepItemScheduleInfo | null,
    newSchedule: RepItemScheduleInfo | null,
): ILeechCheckResult {
    const threshold = settings.leechThreshold;
    const action = settings.leechAction;
    const notLeech: ILeechCheckResult = { isLeech: false, lapses: 0, action };

    if (response !== ReviewResponse.Again || !threshold || threshold <= 0) {
        return notLeech;
    }

    if (!(newSchedule instanceof RepItemScheduleInfoFsrs)) {
        return notLeech;
    }

    const oldLapses = oldSchedule instanceof RepItemScheduleInfoFsrs ? oldSchedule.lapses : 0;
    const newLapses = newSchedule.lapses;
    if (newLapses > oldLapses && newLapses >= threshold) {
        return { isLeech: true, lapses: newLapses, action };
    }

    return { ...notLeech, lapses: newLapses };
}
