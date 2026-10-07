import { DEFAULT_SETTINGS } from "src/data/settings";
import ResponseSectionComponent from "src/ui/obsidian-ui-components/content-container/card-container/response-section/response-section";
import { ReviewAnswerSession } from "src/utils/review-answer-session";

jest.mock("obsidian", () => ({
    ...jest.requireActual("../__mocks__/obsidian.js"),
    ButtonComponent: jest.requireActual("../helpers/obsidian-dom-fake.js").ButtonComponent,
}));
jest.mock(
    "src/ui/obsidian-ui-components/content-container/card-container/response-section/response-section.css",
    () => ({}),
);

beforeAll(() => {
    const { installObsidianDom } = require("../helpers/obsidian-dom-fake.js");
    installObsidianDom();
});

test.each(["click", "keyboard"])(
    "the learner submits code using %s without rating the card",
    (action) => {
        const session = new ReviewAnswerSession("expected");
        const ratings: string[] = [];
        const container = document.createElement("div");
        const response = new ResponseSectionComponent(
            container,
            DEFAULT_SETTINGS,
            () => {},
            (rating) => {
                ratings.push(String(rating));
                return Promise.resolve();
            },
            (answer) => session.submit(answer),
            () => {},
            (answer, preview) => {
                preview.textContent = answer;
                return Promise.resolve();
            },
        );
        response.resetResponseButtons(true, 0);
        const input = container.querySelector("textarea");
        if (!(input instanceof HTMLTextAreaElement)) throw new Error("missing typed input");
        input.value = "print(2)\nprint(3)";
        input.dispatchEvent(new Event("input"));
        expect(container.querySelector(".sr-typed-answer-preview").textContent).toBe(input.value);
        if (action === "click") {
            const button = container.querySelector(".sr-typed-answer-submit");
            if (!(button instanceof HTMLButtonElement)) throw new Error("missing submit button");
            button.click();
        } else {
            input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }));
        }
        expect(session.submittedAnswer).toBe("print(2)\nprint(3)");
        expect(ratings).toEqual([]);
    },
);
