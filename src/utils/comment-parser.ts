import { PREFERRED_DATE_FORMAT } from "src/data/constants";
import { RepItemScheduleInfo } from "src/scheduling/algorithms/base/rep-item-schedule-info";
import {
    FSRS_COMMENT_PREFIX,
    parseFsrsTimestamp,
} from "src/scheduling/algorithms/fsrs/fsrs-helpers";
import { RepItemScheduleInfoFsrs } from "src/scheduling/algorithms/fsrs/rep-item-schedule-info-fsrs";
import { RepItemScheduleInfoOsr } from "src/scheduling/algorithms/osr/rep-item-schedule-info-osr";
import { DateUtil, globalDateProvider } from "src/utils/dates";

/**
 * Marker appended as the final comma separated field of a card's schedule segment to flag the card
 * as suspended, e.g. `<!--SR:!2023-09-02,4,270,suspended-->` or
 * `<!--SR:!fsrs,2023-09-06T00:10:00.000Z,...,2023-09-06T00:00:00.000Z,suspended-->`.
 *
 * Parsers that don't know about the marker ignore trailing fields, so the format stays backward compatible.
 */
export const SUSPENDED_MARKER = "suspended";

const SUSPENDED_SUFFIX_REGEX = new RegExp(`,\\s*${SUSPENDED_MARKER}\\s*$`, "i");
const SUSPENDED_IN_COMMENT_REGEX = new RegExp(`,\\s*${SUSPENDED_MARKER}\\s*(?=!|-->)`, "gi");
const SR_COMMENT_REGEX = /<!--SR:.*?-->/g;

export class CommentParser {
    static parseMultiScheduleComment(comment: string): RepItemScheduleInfo[] {
        const segments = this.splitScheduleSegments(comment).map((segment) =>
            this.parseScheduleSegment(segment),
        );

        return segments;
    }

    /**
     * Returns one flag per schedule segment of the comment, telling whether that card is suspended.
     *
     * @param comment - The content of the `<!--SR:...-->` comment (without the comment delimiters).
     * @returns The suspended flags, in the same order as the parsed schedules.
     */
    static parseSuspendedFlags(comment: string): boolean[] {
        return this.splitScheduleSegments(comment).map((segment) =>
            SUSPENDED_SUFFIX_REGEX.test(segment),
        );
    }

    /**
     * Appends the suspended marker to a formatted schedule segment.
     *
     * @param segment - The formatted schedule segment, e.g. `!2023-09-02,4,270`.
     * @returns The segment with the suspended marker, e.g. `!2023-09-02,4,270,suspended`.
     */
    static appendSuspendedMarker(segment: string): string {
        return `${segment},${SUSPENDED_MARKER}`;
    }

    /**
     * Removes all suspended markers from the SR comments within a text (e.g. a whole note).
     *
     * @param text - The text to process.
     * @returns The updated text and the number of markers removed.
     */
    static removeSuspendedMarkers(text: string): { text: string; count: number } {
        let count = 0;
        const result = text.replace(SR_COMMENT_REGEX, (comment) =>
            comment.replace(SUSPENDED_IN_COMMENT_REGEX, () => {
                count++;
                return "";
            }),
        );
        return { text: result, count };
    }

    private static splitScheduleSegments(comment: string): string[] {
        return comment
            .split("!")
            .map((segment) => segment.trim())
            .filter((segment) => segment.length > 0);
    }

    static parseScheduleSegment(segment: string): RepItemScheduleInfo | null {
        segment = segment.replace(SUSPENDED_SUFFIX_REGEX, "");
        if (segment.startsWith(FSRS_COMMENT_PREFIX + ",")) {
            const fields = segment.split(",");
            const [
                _algorithm,
                dueDateStr,
                intervalStr,
                stabilityStr,
                difficultyStr,
                stateStr,
                repsStr,
                lapsesStr,
                learningStepsStr,
                lastReviewStr,
            ] = fields;

            const parsedDueDate: moment.Moment | null = parseFsrsTimestamp(dueDateStr);

            if (!parsedDueDate) {
                return null;
            }

            return new RepItemScheduleInfoFsrs(
                parsedDueDate,
                parseFloat(intervalStr),
                parseFloat(difficultyStr),
                parseFloat(stabilityStr),
                parseInt(stateStr),
                parseInt(repsStr),
                parseInt(lapsesStr),
                parseInt(learningStepsStr),
                parseFsrsTimestamp(lastReviewStr),
            );
        }

        const [dueDateStr, intervalStr, easeStr] = segment.split(",");
        return this.parseSM2Schedule(dueDateStr, parseInt(intervalStr), parseInt(easeStr));
    }

    static parseSM2Schedule(
        dueDateStr: string,
        interval: number,
        ease: number,
    ): RepItemScheduleInfo | null {
        const dueDate: moment.Moment = DateUtil.dateStrToMoment(dueDateStr);
        if (
            dueDate === null ||
            dueDate.format(PREFERRED_DATE_FORMAT) === RepItemScheduleInfoOsr.dummyDueDateForNewCard
        ) {
            return null;
        }

        const delayBeforeReviewTicks: number =
            dueDate.valueOf() - globalDateProvider.today.valueOf();
        return new RepItemScheduleInfoOsr(dueDate, interval, ease, delayBeforeReviewTicks);
    }
}
