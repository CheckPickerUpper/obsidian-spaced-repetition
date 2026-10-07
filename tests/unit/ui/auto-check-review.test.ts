import { CardFrontBackUtil } from "src/data/data-structures/card/questions/question-type";
import { DEFAULT_SETTINGS } from "src/data/settings";
import { parse } from "src/parser";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";
import { FlashcardReviewMode } from "src/scheduling/flashcard-review-sequencer";
import ResponseSectionComponent from "src/ui/obsidian-ui-components/content-container/card-container/response-section/response-section";
import { renderAnswerCheck } from "src/utils/answer-check";
import { ReviewAnswerSession } from "src/utils/review-answer-session";

import { installObsidianDom } from "../helpers/obsidian-dom-fake";

jest.mock("obsidian", () => ({
    ...jest.requireActual("../__mocks__/obsidian.js"),
    ButtonComponent: jest.requireActual("../helpers/obsidian-dom-fake").ButtonComponent,
}));
jest.mock(
    "src/ui/obsidian-ui-components/content-container/card-container/response-section/response-section.css",
    () => ({}),
);
beforeAll(installObsidianDom);
afterEach(() => document.body.replaceChildren());

test.each([
    { answer: "42", expected: "42", kind: "match", suggested: ReviewResponse.Good },
    {
        answer: "  hello\n\tworld\n\n",
        expected: "hello world",
        kind: "match",
        suggested: ReviewResponse.Good,
    },
    { answer: "43", expected: "42", kind: "mismatch", suggested: ReviewResponse.Again },
])(
    "checking $answer suggests $kind but waits for an explicit rating",
    ({ answer, expected, kind, suggested }) => {
        const session = new ReviewAnswerSession(`<!-- SR-CHECK -->\n${expected}`);
        session.submit(answer);
        const check = session.check();
        expect(check.kind).toBe(kind);
        const ratings: ReviewResponse[] = [];
        const container = document.createElement("div");
        document.body.append(container);
        const response = new ResponseSectionComponent(
            container,
            DEFAULT_SETTINGS,
            () => {},
            (rating) => {
                ratings.push(rating);
                return Promise.resolve();
            },
            () => {},
            () => {},
            () => Promise.resolve(),
        );
        response.showRatingButtons(
            FlashcardReviewMode.Review,
            "Again",
            "Hard",
            "Good",
            "Easy",
            false,
            () => null,
        );
        renderAnswerCheck({ check, container });
        response.selectSuggestedRating(check);
        let selected = response.goodButton;
        if (suggested === ReviewResponse.Again) selected = response.againButton;
        expect(document.activeElement).toBe(selected.buttonEl);
        expect(selected.buttonEl.classList.contains("sr-suggested-rating")).toBe(true);
        expect(ratings).toEqual([]);
        if (kind === "mismatch") {
            expect(container.querySelector("del").textContent).toBe("3");
            expect(container.querySelector("ins").textContent).toBe("2");
        }
        response.hardButton.buttonEl.click();
        expect(ratings).toEqual([ReviewResponse.Hard]);
    },
);

test("an opted-out answer remains manual even when the typed answer differs", () => {
    const session = new ReviewAnswerSession("42");
    session.submit("wrong");
    const check = session.check();
    expect(check).toEqual({ kind: "manual" });
    const container = document.createElement("div");
    renderAnswerCheck({ check, container });
    expect(container.childNodes).toHaveLength(0);
});

test("showing an answer without typing does not run the check", () => {
    const session = new ReviewAnswerSession("<!-- SR-CHECK -->\n42");
    expect(session.check()).toEqual({ kind: "manual" });
});

test("a code example containing the opt-in comment stays literal and manual", () => {
    const answer = "```html\n<!-- SR-CHECK -->\n```";
    const session = new ReviewAnswerSession(answer);
    session.submit("something else");
    expect(session.content.markdown).toBe(answer);
    expect(session.content.checkMode).toBe("manual");
});

test("the opt-in survives note parsing with a fenced stored answer", () => {
    const questions = parse(
        "What does this print?\n?\n<!-- SR-CHECK -->\n```text\n42\n```",
        DEFAULT_SETTINGS,
    );
    expect(questions).toHaveLength(1);
    const cards = CardFrontBackUtil.expand(
        questions[0].cardType,
        questions[0].text,
        DEFAULT_SETTINGS,
    );
    const session = new ReviewAnswerSession(cards[0].back);
    session.submit("42\n");
    expect(session.check()).toEqual({ kind: "match" });
});
