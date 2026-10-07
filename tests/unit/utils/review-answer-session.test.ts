import { DEFAULT_SETTINGS } from "src/data/settings";
import { parse } from "src/parser";
import { ReviewAnswerSession } from "src/utils/review-answer-session";
import { formatTypedAnswerForMarkdown } from "src/utils/review-card-content";

const answer =
    "<!-- SR-HINTS\n1. Start with map.\n2. Use a callback.\n3. Double the input.\n4. Do not reveal this.\n-->\n```ts\nvalues.map(x => x * 2)\n```";

test("a parsed programming card retains three hints and reveals one at a time", () => {
    const cards = parse(`How do you double values?\n?\n${answer}`, DEFAULT_SETTINGS);
    expect(cards).toHaveLength(1);
    const session = new ReviewAnswerSession(cards[0].text.split("\n?\n")[1]);
    expect(session.content.markdown).toBe("```ts\nvalues.map(x => x * 2)\n```");
    expect(session.visibleHints).toEqual([]);
    session.revealNextHint();
    expect(session.visibleHints).toEqual(["Start with map."]);
    session.revealNextHint();
    expect(session.visibleHints).toEqual(["Start with map.", "Use a callback."]);
    session.revealNextHint();
    session.revealNextHint();
    expect(session.visibleHints).toEqual([
        "Start with map.",
        "Use a callback.",
        "Double the input.",
    ]);
});

test("submitting a multiline typed answer preserves exactly what the learner entered", () => {
    const session = new ReviewAnswerSession(answer);
    const typed = "const double = x => {\n  return x * 2;\n};";
    session.submit(typed);
    expect(session.submittedAnswer).toBe(typed);
    expect(session.content.markdown).toBe("```ts\nvalues.map(x => x * 2)\n```");
});

test.each(["ts", "python", "c++", ""])(
    'typed code uses the stored "%s" fence language',
    (language) => {
        expect(
            formatTypedAnswerForMarkdown("print(2)\n", `\`\`\`${language}\nprint(1)\n\`\`\``),
        ).toBe(`\`\`\`${language}\nprint(2)\n\`\`\``);
    },
);

test("typed backticks cannot close the generated code fence", () => {
    expect(formatTypedAnswerForMarkdown("value = '```'", "```js\nvalue\n```")).toBe(
        "````js\nvalue = '```'\n````",
    );
});
