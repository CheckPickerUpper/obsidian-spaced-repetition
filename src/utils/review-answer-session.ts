import { parseReviewCardContent } from "src/utils/review-card-content";

export class ReviewAnswerSession {
    readonly content;
    readonly visibleHints: string[] = [];
    submittedAnswer = "";

    constructor(answer: string) {
        this.content = parseReviewCardContent(answer);
    }

    submit(answer: string): void {
        this.submittedAnswer = answer;
    }

    revealNextHint(): void {
        const nextIndex = this.visibleHints.length;
        if (nextIndex < this.content.hints.length) {
            this.visibleHints.push(this.content.hints[nextIndex]);
        }
    }
}
