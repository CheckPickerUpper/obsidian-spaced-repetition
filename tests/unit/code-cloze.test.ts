import { CardType } from "src/data/data-structures/card/questions/question";
import { CardFrontBackUtil } from "src/data/data-structures/card/questions/question-type";
import { DEFAULT_SETTINGS } from "src/data/settings";
import { parse } from "src/parser";

test.each(["```python", "~~~python", "````python"])(
    "a fenced %s snippet makes siblings while retaining code formatting",
    (opening) => {
        const closing = opening.replace("python", "");
        const note = `${opening}\nprint([[sr:1 + 2]])\nprint([[sr:3 * 4]])\n${closing}`;
        const questions = parse(note, DEFAULT_SETTINGS);
        expect(questions).toHaveLength(1);
        expect(questions[0].cardType).toBe(CardType.Cloze);
        const cards = CardFrontBackUtil.expand(
            questions[0].cardType,
            questions[0].text,
            DEFAULT_SETTINGS,
        );
        expect(cards.map((card) => [card.front, card.back])).toEqual([
            [
                `${opening}\nprint([...])\nprint(3 * 4)\n${closing}`,
                `${opening}\nprint(1 + 2)\nprint(3 * 4)\n${closing}`,
            ],
            [
                `${opening}\nprint(1 + 2)\nprint([...])\n${closing}`,
                `${opening}\nprint(1 + 2)\nprint(3 * 4)\n${closing}`,
            ],
        ]);
    },
);

test("inline code clozes hide an expression without exposing HTML markup", () => {
    const questions = parse("Recall `sum([[sr:a, b]])`", DEFAULT_SETTINGS);
    expect(questions).toHaveLength(1);
    const cards = CardFrontBackUtil.expand(
        questions[0].cardType,
        questions[0].text,
        DEFAULT_SETTINGS,
    );
    expect(cards.map((card) => [card.front, card.back])).toEqual([
        ["Recall `sum([...])`", "Recall `sum(a, b)`"],
    ]);
});

test("ordinary equality and power operators in a fenced block do not become cards", () => {
    expect(parse("```python\na == b\nx ** 2\n```", DEFAULT_SETTINGS)).toEqual([]);
});

test("rendering code cloze siblings works independently of note discovery", () => {
    const cards = CardFrontBackUtil.expand(
        CardType.Cloze,
        "```js\n[[sr:first]] + [[sr:second]]\n```",
        DEFAULT_SETTINGS,
    );
    expect(cards.map((card) => [card.front, card.back])).toEqual([
        ["```js\n[...] + second\n```", "```js\nfirst + second\n```"],
        ["```js\nfirst + [...]\n```", "```js\nfirst + second\n```"],
    ]);
});

test("dollar expressions in code are preserved literally on the answer", () => {
    const cards = CardFrontBackUtil.expand(
        CardType.Cloze,
        "```js\n[[sr:'$&' + '$`']]\n```",
        DEFAULT_SETTINGS,
    );
    expect(cards[0].back).toBe("```js\n'$&' + '$`'\n```");
});

test("code operators stay literal when code clozes and prose clozes share a note", () => {
    const note = "Recall ==Python==\n```python\na == b\nx ** 2\nprint([[sr:42]])\n```";
    const questions = parse(note, DEFAULT_SETTINGS);
    const cards = CardFrontBackUtil.expand(
        questions[0].cardType,
        questions[0].text,
        DEFAULT_SETTINGS,
    );
    expect(cards).toHaveLength(2);
    expect(cards[0].back).toContain("a == b\nx ** 2\nprint(42)");
    expect(cards[1].front).toBe("Recall Python\n```python\na == b\nx ** 2\nprint([...])\n```");
});

test("a cloze may hide a full line or several lines inside a code fence", () => {
    const note = "```js\n[[sr:const x = 1;\nreturn x;]]\n```";
    const questions = parse(note, DEFAULT_SETTINGS);
    expect(questions).toHaveLength(1);
    const cards = CardFrontBackUtil.expand(
        questions[0].cardType,
        questions[0].text,
        DEFAULT_SETTINGS,
    );
    expect(cards.map((card) => [card.front, card.back])).toEqual([
        ["```js\n[...]\n```", "```js\nconst x = 1;\nreturn x;\n```"],
    ]);
});
