import { IReviewLogStorage } from "src/data/review-log/review-log";

/**
 * In-memory implementation of the review log storage, used for unit testing.
 */
export class UnitTestReviewLogStorage implements IReviewLogStorage {
    files: Map<string, string> = new Map<string, string>();
    folders: Set<string> = new Set<string>();
    writeCount: number = 0;
    appendCount: number = 0;

    async exists(path: string): Promise<boolean> {
        return Promise.resolve(this.files.has(path));
    }

    async read(path: string): Promise<string> {
        return Promise.resolve(this.files.get(path) ?? "");
    }

    async write(path: string, content: string): Promise<void> {
        this.writeCount++;
        this.files.set(path, content);
        return Promise.resolve();
    }

    async append(path: string, content: string): Promise<void> {
        this.appendCount++;
        this.files.set(path, (this.files.get(path) ?? "") + content);
        return Promise.resolve();
    }

    async ensureFolder(path: string): Promise<void> {
        this.folders.add(path);
        return Promise.resolve();
    }

    async listFiles(folder: string): Promise<string[]> {
        const prefix = folder ? folder + "/" : "";
        return Promise.resolve(
            [...this.files.keys()].filter(
                (path) => path.startsWith(prefix) && !path.substring(prefix.length).includes("/"),
            ),
        );
    }
}
