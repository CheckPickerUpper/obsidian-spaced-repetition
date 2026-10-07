import { AnswerCheck, checkAnswer } from "src/utils/answer-check";
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

    check(): AnswerCheck {
        switch (this.content.checkMode) {
            case "manual":
                return { kind: "manual" };
            case "auto":
                if (this.submittedAnswer.length === 0) return { kind: "manual" };
                return checkAnswer({
                    typed: this.submittedAnswer,
                    expected: this.content.markdown,
                });
            default:
                this.content.checkMode satisfies never;
                throw new Error("Unknown answer check mode");
        }
    }

    revealNextHint(): void {
        const nextIndex = this.visibleHints.length;
        if (nextIndex < this.content.hints.length) {
            this.visibleHints.push(this.content.hints[nextIndex]);
        }
    }
}
