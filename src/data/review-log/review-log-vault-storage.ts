import { normalizePath, TFile, TFolder, Vault } from "obsidian";

import { IReviewLogStorage } from "src/data/review-log/review-log";

/**
 * Stores the review log files in the Obsidian vault (so that they are synced by Obsidian Sync).
 */
export class ReviewLogVaultStorage implements IReviewLogStorage {
    private vault: Vault;

    constructor(vault: Vault) {
        this.vault = vault;
    }

    private getFile(path: string): TFile | null {
        const file = this.vault.getAbstractFileByPath(normalizePath(path));
        return file instanceof TFile ? file : null;
    }

    async exists(path: string): Promise<boolean> {
        return Promise.resolve(this.getFile(path) !== null);
    }

    async read(path: string): Promise<string> {
        const file = this.getFile(path);
        return file ? await this.vault.read(file) : "";
    }

    async write(path: string, content: string): Promise<void> {
        const file = this.getFile(path);
        if (file) {
            await this.vault.modify(file, content);
        } else {
            await this.vault.create(normalizePath(path), content);
        }
    }

    async append(path: string, content: string): Promise<void> {
        const file = this.getFile(path);
        if (file) {
            await this.vault.append(file, content);
        } else {
            await this.vault.create(normalizePath(path), content);
        }
    }

    async ensureFolder(path: string): Promise<void> {
        const normalized = normalizePath(path);
        if (this.vault.getAbstractFileByPath(normalized) instanceof TFolder) return;
        try {
            await this.vault.createFolder(normalized);
        } catch {
            // Folder was probably created in the meantime
        }
    }

    async listFiles(folder: string): Promise<string[]> {
        const abstractFolder = folder
            ? this.vault.getAbstractFileByPath(normalizePath(folder))
            : this.vault.getRoot();
        if (!(abstractFolder instanceof TFolder)) return Promise.resolve<string[]>([]);
        const paths: string[] = [];
        for (const child of abstractFolder.children) {
            if (child instanceof TFile) paths.push(child.path);
        }
        return Promise.resolve(paths);
    }
}
