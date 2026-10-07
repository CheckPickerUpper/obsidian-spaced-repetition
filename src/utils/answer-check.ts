export type AnswerCheck =
    | { kind: "manual" }
    | { kind: "match" }
    | { kind: "mismatch"; prefix: string; typed: string; expected: string; suffix: string };

export function checkAnswer(params: { typed: string; expected: string }): AnswerCheck {
    const typed = comparableAnswer(params.typed);
    const expected = comparableAnswer(params.expected);
    if (typed === expected) return { kind: "match" };

    let prefixLength = 0;
    while (
        prefixLength < typed.length &&
        prefixLength < expected.length &&
        typed[prefixLength] === expected[prefixLength]
    ) {
        prefixLength++;
    }
    let suffixLength = 0;
    while (
        suffixLength < typed.length - prefixLength &&
        suffixLength < expected.length - prefixLength &&
        typed[typed.length - 1 - suffixLength] === expected[expected.length - 1 - suffixLength]
    ) {
        suffixLength++;
    }
    return {
        kind: "mismatch",
        prefix: typed.slice(0, prefixLength),
        typed: typed.slice(prefixLength, typed.length - suffixLength),
        expected: expected.slice(prefixLength, expected.length - suffixLength),
        suffix: typed.slice(typed.length - suffixLength),
    };
}

function comparableAnswer(answer: string): string {
    let content = answer.replaceAll("\r\n", "\n").trim();
    const fence = content.match(/^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n\1$/);
    if (fence !== null) content = fence[2];
    return content.trim().replace(/\s+/g, " ");
}

export function renderAnswerCheck(params: { check: AnswerCheck; container: HTMLElement }): void {
    switch (params.check.kind) {
        case "manual":
            return;
        case "match":
            params.container.createDiv({
                text: "Correct · Suggested rating: Good",
                cls: "sr-answer-match",
            });
            return;
        case "mismatch": {
            params.container.createDiv({
                text: "Not quite · Suggested rating: Again",
                cls: "sr-answer-mismatch",
            });
            const diff = params.container.createDiv({ cls: "sr-answer-diff" });
            diff.append(params.check.prefix);
            diff.createEl("del", { text: params.check.typed });
            diff.createEl("ins", { text: params.check.expected });
            diff.append(params.check.suffix);
            return;
        }
        default:
            params.check satisfies never;
            throw new Error("Unknown answer check result");
    }
}
