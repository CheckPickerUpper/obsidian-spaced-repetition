export interface ReviewCardContent {
    markdown: string;
    hints: string[];
}

export type TypedAnswerMatch = { kind: "exact" } | { kind: "normalized" } | { kind: "different" };

const HINT_BLOCK_START = /^\s*<!--\s*SR-HINTS\s*$/i;
const HINT_BLOCK_END = /^\s*-->\s*$/;
const HINT_LINE = /^\s*(?:\d+[.)]|Hint\s*\d+\s*:)\s*(.*)$/i;
const COMPLETE_CODE_FENCE = /^```[^\n]*\n([\s\S]*?)\n```\s*$/;
const CODE_FENCE = /(^|\n)\s*```/;
const CODE_LANGUAGE = /```([A-Za-z0-9_+#.-]*)[ \t]*\r?\n/;

/**
 * Removes the authored hint block from the answer while retaining the hints for review controls.
 */
export function parseReviewCardContent(markdown: string): ReviewCardContent {
    const lines: string[] = markdown.replaceAll("\r\n", "\n").split("\n");
    const startIndex: number = findHintBlockStart(lines);

    if (startIndex === -1) {
        return { markdown, hints: [] };
    }

    const endIndex: number = findHintBlockEnd(lines, startIndex);
    if (endIndex === -1) {
        return { markdown, hints: [] };
    }

    const contentLines: string[] = [...lines.slice(0, startIndex), ...lines.slice(endIndex + 1)];

    return {
        markdown: contentLines.join("\n").trim(),
        hints: parseHints(lines.slice(startIndex + 1, endIndex)),
    };
}

/**
 * Compares a submitted answer with the answer stored on the card.
 */
export function compareTypedAnswer(params: {
    typedAnswer: string;
    expectedAnswer: string;
}): TypedAnswerMatch {
    const typed: string = comparableAnswer(params.typedAnswer);
    const expected: string = comparableAnswer(params.expectedAnswer);

    if (typed === expected) {
        return { kind: "exact" };
    }

    if (collapseWhitespace(typed) === collapseWhitespace(expected)) {
        return { kind: "normalized" };
    }

    return { kind: "different" };
}

/**
 * Wraps a typed code answer in the language fence used by the expected answer.
 */
export function formatTypedAnswerForMarkdown(typedAnswer: string, expectedAnswer: string): string {
    const answer: string = typedAnswer.trimEnd();
    if (answer.trimStart().startsWith("```") || !CODE_FENCE.test(expectedAnswer)) {
        return answer;
    }

    const language: string = codeLanguage(expectedAnswer);
    const fence: string = language.length === 0 ? "```" : `\`\`\`${language}`;
    return `${fence}\n${answer}\n\`\`\``;
}

function findHintBlockStart(lines: string[]): number {
    for (let index = 0; index < lines.length; index++) {
        if (HINT_BLOCK_START.test(lines[index])) {
            return index;
        }
    }

    return -1;
}

function findHintBlockEnd(lines: string[], startIndex: number): number {
    for (let index = startIndex + 1; index < lines.length; index++) {
        if (HINT_BLOCK_END.test(lines[index])) {
            return index;
        }
    }

    return -1;
}

function parseHints(lines: string[]): string[] {
    const hintBlocks: string[][] = [];
    let currentHint: string[] = [];

    for (const line of lines) {
        const marker = line.match(HINT_LINE);
        if (marker) {
            if (currentHint.length > 0) {
                hintBlocks.push(currentHint);
            }
            currentHint = [marker[1].trim()];
            continue;
        }

        if (line.trim().length > 0 || currentHint.length > 0) {
            currentHint.push(line.trimEnd());
        }
    }

    if (currentHint.length > 0) {
        hintBlocks.push(currentHint);
    }

    return hintBlocks
        .map((hint: string[]) => hint.join("\n").trim())
        .filter((hint: string) => hint.length > 0)
        .slice(0, 3);
}

function comparableAnswer(answer: string): string {
    const normalized: string = answer.replaceAll("\r\n", "\n").trim();
    const codeMatch = normalized.match(COMPLETE_CODE_FENCE);
    if (codeMatch) {
        return codeMatch[1].trim();
    }

    return normalized;
}

function collapseWhitespace(answer: string): string {
    return answer
        .replace(/[ \t]+/g, " ")
        .replace(/\n+/g, "\n")
        .trim();
}

function codeLanguage(markdown: string): string {
    const match = markdown.match(CODE_LANGUAGE);
    if (match === null) {
        return "";
    }

    return match[1];
}
