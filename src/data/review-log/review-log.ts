import { Card } from "src/data/data-structures/card/card";
import { RepItemScheduleInfo } from "src/scheduling/algorithms/base/rep-item-schedule-info";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";
import { RepItemScheduleInfoFsrs } from "src/scheduling/algorithms/fsrs/rep-item-schedule-info-fsrs";

/**
 * Current version of the review log entry format.
 */
export const REVIEW_LOG_FORMAT_VERSION = 1;

/**
 * Review log files are named `review-log-YYYY-MM.sr.md` and live in the folder from the
 * `scheduleDataVaultLocation` setting. They are markdown files (so that Obsidian Sync syncs them by
 * default), but contain one JSON entry per line.
 */
export const REVIEW_LOG_FILE_PREFIX = "review-log-";
export const REVIEW_LOG_FILE_SUFFIX = ".sr.md";
export const REVIEW_LOG_FILE_HEADER =
    "<!-- Spaced Repetition review log: one JSON entry per line. Please do not edit by hand. -->\n";

const REVIEW_LOG_FILE_NAME_REGEX = /^review-log-\d{4}-\d{2}\.sr\.md$/;

export type ReviewLogResponse = "Again" | "Hard" | "Good" | "Easy" | "Reset";

/**
 * Snapshot of a card's schedule at a point in time.
 * The FSRS specific fields are only present when the schedule was created by the FSRS algorithm.
 */
export interface ReviewLogScheduleSnapshot {
    algorithm: string;
    // ISO timestamp of the due date
    due: string;
    // interval in days
    interval: number;
    ease?: number;
    stability?: number;
    difficulty?: number;
    state?: number;
    reps?: number;
    lapses?: number;
}

/**
 * A single review log entry.
 *
 * NOTE: There are no stable card ids yet, so a card is identified by the note path, the (zero based)
 * line number of the question, a hash of the question text and the index of the card within the
 * question (e.g. for cloze cards).
 */
export interface ReviewLogEntry {
    v: number;
    // Unique id of this entry (used to remove the entry again on undo)
    id: string;
    // ISO timestamp of the review
    ts: string;
    // Composite identifier: `${notePath}:${lineNo}:${questionHash}:${cardIdx}`
    cardId: string;
    notePath: string;
    lineNo: number;
    questionHash: string;
    cardIdx: number;
    // The topic paths (decks) of the card, separated by "|"
    deck: string;
    response: ReviewLogResponse;
    // null if the card was new
    before: ReviewLogScheduleSnapshot | null;
    // null if the schedule was not changed/removed
    after: ReviewLogScheduleSnapshot | null;
    // Time from showing the card to answering it, null if unknown
    timeMs: number | null;
}

export interface ReviewLogLoadOptions {
    // Only entries with a timestamp >= from
    from?: Date;
    // Only entries with a timestamp < to
    to?: Date;
}

/**
 * Abstraction over the file system so that the review log can be unit tested.
 * All paths are relative to the vault root.
 */
export interface IReviewLogStorage {
    exists(path: string): Promise<boolean>;
    read(path: string): Promise<string>;
    // Creates the file if it does not exist, otherwise overwrites it
    write(path: string, content: string): Promise<void>;
    // Appends to an existing file (creates it if missing)
    append(path: string, content: string): Promise<void>;
    ensureFolder(path: string): Promise<void>;
    // Returns the paths of all files directly within the folder
    listFiles(folder: string): Promise<string[]>;
}

/**
 * Read/write API of the review log.
 */
export interface IReviewLog {
    add(entry: ReviewLogEntry): void;
    remove(entry: ReviewLogEntry): Promise<boolean>;
    flush(): Promise<void>;
    loadEntries(options?: ReviewLogLoadOptions): Promise<ReviewLogEntry[]>;
}

/**
 * Maps a review response to the name stored in the review log.
 */
export function reviewResponseToLogResponse(response: ReviewResponse): ReviewLogResponse {
    switch (response) {
        case ReviewResponse.Easy:
            return "Easy";
        case ReviewResponse.Good:
            return "Good";
        case ReviewResponse.Hard:
            return "Hard";
        case ReviewResponse.Again:
            return "Again";
        default:
            return "Reset";
    }
}

/**
 * Creates a snapshot of a schedule for the review log.
 */
export function scheduleToSnapshot(
    schedule: RepItemScheduleInfo | null,
): ReviewLogScheduleSnapshot | null {
    if (schedule === null || schedule === undefined) return null;

    const result: ReviewLogScheduleSnapshot = {
        algorithm: schedule.algorithmType,
        due: schedule.dueDate ? schedule.dueDate.toISOString() : "",
        interval: schedule.interval,
    };

    if (schedule instanceof RepItemScheduleInfoFsrs) {
        result.stability = schedule.stability;
        result.difficulty = schedule.difficulty;
        result.state = schedule.state;
        result.reps = schedule.reps;
        result.lapses = schedule.lapses;
    } else {
        result.ease = schedule.latestEase;
    }
    return result;
}

let entryIdCounter = 0;

/**
 * Generates an id that is unique enough for identifying a single review log entry.
 */
export function generateReviewLogEntryId(timestampMs: number): string {
    entryIdCounter = (entryIdCounter + 1) % 1296;
    const random = Math.floor(Math.random() * 1679616)
        .toString(36)
        .padStart(4, "0");
    return `${timestampMs.toString(36)}-${entryIdCounter.toString(36).padStart(2, "0")}${random}`;
}

/**
 * Creates a review log entry for a card review.
 */
export function createReviewLogEntry(
    card: Card,
    response: ReviewResponse,
    before: RepItemScheduleInfo | null,
    after: RepItemScheduleInfo | null,
    reviewedAtMs: number,
    timeMs: number | null,
): ReviewLogEntry {
    const question = card.question;
    const notePath: string = question.note?.filePath ?? "";
    const lineNo: number = question.parsedQuestionInfo?.firstLineNum ?? -1;
    const questionHash: string = question.questionText?.textHash ?? "";
    const cardIdx: number = card.cardIdx ?? 0;

    return {
        v: REVIEW_LOG_FORMAT_VERSION,
        id: generateReviewLogEntryId(reviewedAtMs),
        ts: new Date(reviewedAtMs).toISOString(),
        cardId: `${notePath}:${lineNo}:${questionHash}:${cardIdx}`,
        notePath,
        lineNo,
        questionHash,
        cardIdx,
        deck: question.topicPathList ? question.topicPathList.format("|") : "",
        response: reviewResponseToLogResponse(response),
        before: scheduleToSnapshot(before),
        after: scheduleToSnapshot(after),
        timeMs,
    };
}

// Characters which could make Obsidian interpret parts of a JSON line as markdown metadata
// (tags, links, html, comments, code, math)
const MARKDOWN_SENSITIVE_CHARS_REGEX = /[#[\]<>`%$]/g;
const JSON_STRING_LITERAL_REGEX = /"(?:[^"\\]|\\.)*"/g;

/**
 * Serializes a review log entry to a single line.
 *
 * Characters that Obsidian would interpret (e.g. `#` as tag or `[[` as link) are escaped as JSON
 * unicode escapes, so the line is still valid JSON, but the metadata cache isn't polluted.
 */
export function serializeReviewLogEntry(entry: ReviewLogEntry): string {
    const json = JSON.stringify(entry);
    return json.replace(JSON_STRING_LITERAL_REGEX, (literal: string) =>
        literal.replace(
            MARKDOWN_SENSITIVE_CHARS_REGEX,
            (ch: string) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"),
        ),
    );
}

/**
 * Parses a single line of a review log file.
 *
 * @returns the entry, or null if the line isn't a valid entry
 */
export function parseReviewLogLine(line: string): ReviewLogEntry | null {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) return null;
    try {
        const parsed = JSON.parse(trimmed) as ReviewLogEntry;
        if (
            parsed === null ||
            typeof parsed !== "object" ||
            typeof parsed.id !== "string" ||
            typeof parsed.ts !== "string"
        ) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

/**
 * Persistent, append-only log of all flashcard reviews.
 *
 * Writes are buffered and flushed after a short delay, so that reviewing many cards quickly does
 * not result in a file write per answer. Entries are appended to monthly files, so that a single
 * file never grows too large.
 */
export class ReviewLog implements IReviewLog {
    private storage: IReviewLogStorage;
    private folderProvider: () => string;
    private flushDelayMs: number;

    private buffer: ReviewLogEntry[] = [];
    // Files that are known to end with a newline (because this instance wrote them last)
    private filesEndingWithNewline: Set<string> = new Set<string>();
    private flushTimer: ReturnType<typeof setTimeout> | null = null;
    // All file operations are chained, so that they never run concurrently
    private operationChain: Promise<void> = Promise.resolve();

    constructor(
        storage: IReviewLogStorage,
        folderProvider: () => string,
        flushDelayMs: number = 2000,
    ) {
        this.storage = storage;
        this.folderProvider = folderProvider;
        this.flushDelayMs = flushDelayMs;
    }

    /**
     * The folder that contains the review log files.
     */
    get folder(): string {
        const folder = (this.folderProvider() ?? "").trim().replace(/^\/+|\/+$/g, "");
        return folder;
    }

    /**
     * Number of entries which have not been written to the vault yet.
     */
    get pendingEntryCount(): number {
        return this.buffer.length;
    }

    /**
     * Gets the path of the log file which an entry with the given ISO timestamp belongs to.
     */
    getFilePathForTimestamp(isoTimestamp: string): string {
        const month: string = isoTimestamp.substring(0, 7);
        const fileName = `${REVIEW_LOG_FILE_PREFIX}${month}${REVIEW_LOG_FILE_SUFFIX}`;
        return this.folder ? `${this.folder}/${fileName}` : fileName;
    }

    /**
     * Checks whether the path is a review log file (used to exclude them when scanning the vault).
     */
    isReviewLogFile(path: string): boolean {
        const folder = this.folder;
        let fileName = path;
        if (folder) {
            if (!path.startsWith(folder + "/")) return false;
            fileName = path.substring(folder.length + 1);
        }
        return REVIEW_LOG_FILE_NAME_REGEX.test(fileName);
    }

    /**
     * Adds an entry to the log. The entry is written to the vault after a short delay.
     */
    add(entry: ReviewLogEntry): void {
        this.buffer.push(entry);
        this.scheduleFlush();
    }

    /**
     * Removes an entry from the log (used when undoing a review).
     *
     * @returns true if the entry was found and removed
     */
    async remove(entry: ReviewLogEntry): Promise<boolean> {
        const idx = this.buffer.findIndex((e) => e.id === entry.id);
        if (idx !== -1) {
            // Not yet written, so simply drop it
            this.buffer.splice(idx, 1);
            if (this.buffer.length === 0) this.cancelScheduledFlush();
            return true;
        }

        let removed = false;
        await this.enqueue(async () => {
            const path = this.getFilePathForTimestamp(entry.ts);
            if (!(await this.storage.exists(path))) return;

            const content = await this.storage.read(path);
            const lines = content.split("\n");
            const remainingLines = lines.filter((line) => {
                if (removed) return true;
                const parsed = parseReviewLogLine(line);
                if (parsed !== null && parsed.id === entry.id) {
                    removed = true;
                    return false;
                }
                return true;
            });

            if (removed) {
                await this.storage.write(path, remainingLines.join("\n"));
                this.filesEndingWithNewline.delete(path);
            }
        });
        return removed;
    }

    /**
     * Writes all buffered entries to the vault.
     */
    async flush(): Promise<void> {
        this.cancelScheduledFlush();
        if (this.buffer.length === 0) {
            // Still wait for any running operation
            await this.operationChain;
            return;
        }

        const entries = this.buffer;
        this.buffer = [];

        await this.enqueue(async () => {
            const linesByPath = new Map<string, string[]>();
            for (const entry of entries) {
                const path = this.getFilePathForTimestamp(entry.ts);
                if (!linesByPath.has(path)) linesByPath.set(path, []);
                linesByPath.get(path).push(serializeReviewLogEntry(entry));
            }

            if (this.folder) {
                await this.storage.ensureFolder(this.folder);
            }

            for (const [path, lines] of linesByPath) {
                const text = lines.join("\n") + "\n";
                if (await this.storage.exists(path)) {
                    const needsNewline = await this.fileNeedsLeadingNewline(path);
                    await this.storage.append(path, (needsNewline ? "\n" : "") + text);
                } else {
                    await this.storage.write(path, REVIEW_LOG_FILE_HEADER + text);
                }
                this.filesEndingWithNewline.add(path);
            }
        });
    }

    /**
     * Loads all entries from the vault (including the ones which haven't been written yet).
     *
     * Entries are returned sorted by timestamp (oldest first). Invalid lines are skipped.
     */
    async loadEntries(options: ReviewLogLoadOptions = {}): Promise<ReviewLogEntry[]> {
        await this.flush();

        const fromIso = options.from ? options.from.toISOString() : null;
        const toIso = options.to ? options.to.toISOString() : null;
        const fromMonth = fromIso ? fromIso.substring(0, 7) : null;
        const toMonth = toIso ? toIso.substring(0, 7) : null;

        const result: ReviewLogEntry[] = [];
        const folder = this.folder;
        const files = (await this.storage.listFiles(folder))
            .filter((path) => this.isReviewLogFile(path))
            .filter((path) => {
                const month = path.substring(
                    path.length - REVIEW_LOG_FILE_SUFFIX.length - 7,
                    path.length - REVIEW_LOG_FILE_SUFFIX.length,
                );
                if (fromMonth !== null && month < fromMonth) return false;
                if (toMonth !== null && month > toMonth) return false;
                return true;
            })
            .sort();

        for (const path of files) {
            const content = await this.storage.read(path);
            for (const line of content.split("\n")) {
                const entry = parseReviewLogLine(line);
                if (entry === null) continue;
                if (fromIso !== null && entry.ts < fromIso) continue;
                if (toIso !== null && entry.ts >= toIso) continue;
                result.push(entry);
            }
        }

        result.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
        return result;
    }

    private async fileNeedsLeadingNewline(path: string): Promise<boolean> {
        // Only read the file once per session, afterwards we know that it ends with a newline
        if (this.filesEndingWithNewline.has(path)) return false;
        const content = await this.storage.read(path);
        return content.length > 0 && !content.endsWith("\n");
    }

    private scheduleFlush(): void {
        if (this.flushTimer !== null) return;
        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            this.flush().catch((e) => console.warn("SR: Error writing review log", e));
        }, this.flushDelayMs);
    }

    private cancelScheduledFlush(): void {
        if (this.flushTimer !== null) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
    }

    private enqueue(operation: () => Promise<void>): Promise<void> {
        const result = this.operationChain.then(operation);
        // Keep the chain alive, even if an operation fails
        this.operationChain = result.catch((e) => {
            console.warn("SR: Error in review log operation", e);
        });
        return result;
    }
}
