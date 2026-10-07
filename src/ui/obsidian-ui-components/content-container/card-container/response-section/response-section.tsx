import "src/ui/obsidian-ui-components/content-container/card-container/response-section/response-section.css";
import { Platform } from "obsidian";

import { SRSettings } from "src/data/settings";
import { t } from "src/lang/helpers";
import { RepItemScheduleInfo } from "src/scheduling/algorithms/base/rep-item-schedule-info";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";
import { formatScheduleInterval } from "src/scheduling/algorithms/schedule-display";
import { FlashcardReviewMode } from "src/scheduling/flashcard-review-sequencer";
import SRResponseButtonComponent from "src/ui/obsidian-ui-components/content-container/card-container/response-section/sr-response-button";
import SRButtonComponent from "src/ui/sr-button";
import { AnswerCheck } from "src/utils/answer-check";
import EmulatedPlatform from "src/utils/platform-detector";

export default class ResponseSectionComponent {
    public responseEl: HTMLDivElement;
    public againButton: SRResponseButtonComponent;
    public hardButton: SRResponseButtonComponent;
    public goodButton: SRResponseButtonComponent;
    public easyButton: SRResponseButtonComponent;
    public answerButton: SRResponseButtonComponent;
    private typedAnswerPanel: HTMLDivElement;
    private typedAnswerInput: HTMLTextAreaElement;
    private typedAnswerPreview: HTMLDivElement;
    private checkAnswerButton: SRButtonComponent;
    private hintButton: SRButtonComponent;

    constructor(
        container: HTMLElement,
        settings: SRSettings,
        showAnswer: () => void,
        processReview: (response: ReviewResponse) => Promise<void>,
        submitTypedAnswer: (answer: string) => void,
        showNextHint: () => void,
        renderTypedAnswer: (answer: string, container: HTMLElement) => Promise<void>,
    ) {
        this.responseEl = container.createDiv();
        this.responseEl.addClass("sr-response");

        this.typedAnswerPanel = this.responseEl.createDiv({
            cls: ["sr-typed-answer-panel", "sr-is-hidden"],
        });
        this.typedAnswerInput = this.typedAnswerPanel.createEl("textarea", {
            cls: "sr-typed-answer-input",
            attr: {
                rows: "4",
                placeholder: "Type your answer",
                spellcheck: "false",
                "aria-label": "Type your answer",
            },
        });
        const preview = this.typedAnswerPanel.createDiv({ cls: "sr-typed-answer-preview" });
        this.typedAnswerPreview = preview;
        this.typedAnswerInput.addEventListener("input", () => {
            preview.empty();
            void renderTypedAnswer(this.typedAnswerInput.value, preview.createDiv());
            this.checkAnswerButton.setDisabled(this.typedAnswerInput.value.trim().length === 0);
        });
        this.typedAnswerInput.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                if (this.typedAnswerInput.value.trim().length > 0) {
                    submitTypedAnswer(this.typedAnswerInput.value);
                }
            }
        });

        const typedAnswerActions: HTMLDivElement = this.typedAnswerPanel.createDiv({
            cls: "sr-typed-answer-actions",
        });
        this.checkAnswerButton = new SRButtonComponent(typedAnswerActions, {
            classNames: ["sr-bg-blue", "sr-typed-answer-submit"],
            text: "Check Answer",
            onClick: () => {
                if (this.typedAnswerInput.value.trim().length > 0) {
                    submitTypedAnswer(this.typedAnswerInput.value);
                }
            },
        });

        this.hintButton = new SRButtonComponent(this.responseEl, {
            classNames: ["sr-bg-yellow", "sr-hint-button", "sr-is-hidden"],
            text: "Show Hint 1",
            onClick: showNextHint,
        });

        this.answerButton = new SRResponseButtonComponent(this.responseEl, {
            classNames: ["sr-bg-blue", "sr-show-answer-button"],
            text: t("SHOW_ANSWER"),
            onClick: () => {
                showAnswer();
            },
        });

        this.againButton = new SRResponseButtonComponent(this.responseEl, {
            classNames: ["sr-bg-red", "sr-again-button", "sr-is-hidden"],
            text: settings.flashcardAgainText,
            onClick: async () => {
                await processReview(ReviewResponse.Again);
            },
        });

        this.hardButton = new SRResponseButtonComponent(this.responseEl, {
            classNames: ["sr-bg-yellow", "sr-hard-button", "sr-is-hidden"],
            text: settings.flashcardHardText,
            onClick: async () => {
                await processReview(ReviewResponse.Hard);
            },
        });

        this.goodButton = new SRResponseButtonComponent(this.responseEl, {
            classNames: ["sr-bg-blue", "sr-good-button", "sr-is-hidden"],
            text: settings.flashcardGoodText,
            onClick: async () => {
                await processReview(ReviewResponse.Good);
            },
        });

        this.easyButton = new SRResponseButtonComponent(this.responseEl, {
            classNames: ["sr-bg-green", "sr-easy-button", "sr-is-hidden"],
            text: settings.flashcardEasyText,
            onClick: async () => {
                await processReview(ReviewResponse.Easy);
            },
        });
    }

    public resetResponseButtons(typedAnswerEnabled: boolean, hintCount: number) {
        // Sets all buttons in to their default state
        if (this.responseEl.hasClass("sr-is-hidden")) {
            this.responseEl.removeClass("sr-is-hidden");
        }
        this.responseEl.toggleClass("sr-has-typed-answer", typedAnswerEnabled);
        this.typedAnswerPanel.toggleClass("sr-is-hidden", !typedAnswerEnabled);
        this.typedAnswerInput.value = "";
        this.typedAnswerPreview.empty();
        this.checkAnswerButton.setDisabled(true);
        this.answerButton.buttonEl.removeClass("sr-is-hidden");
        this.setHintProgress(hintCount, 0);
        this.againButton.buttonEl.addClass("sr-is-hidden");
        this.hardButton.buttonEl.addClass("sr-is-hidden");
        this.goodButton.buttonEl.addClass("sr-is-hidden");
        this.easyButton.buttonEl.addClass("sr-is-hidden");
    }

    public setHintProgress(hintCount: number, revealedHintCount: number) {
        if (hintCount <= revealedHintCount) {
            this.hintButton.buttonEl.addClass("sr-is-hidden");
            return;
        }

        this.hintButton.setButtonText(`Show Hint ${revealedHintCount + 1}`);
        this.hintButton.buttonEl.removeClass("sr-is-hidden");
    }

    public selectSuggestedRating(check: AnswerCheck): void {
        const buttons = [this.againButton, this.hardButton, this.goodButton, this.easyButton];
        for (const button of buttons) button.buttonEl.removeClass("sr-suggested-rating");
        switch (check.kind) {
            case "manual":
                this.againButton.buttonEl.focus();
                return;
            case "match":
                this.goodButton.buttonEl.removeClass("sr-is-hidden");
                this.goodButton.buttonEl.addClass("sr-suggested-rating");
                this.goodButton.buttonEl.focus();
                return;
            case "mismatch":
                this.againButton.buttonEl.addClass("sr-suggested-rating");
                this.againButton.buttonEl.focus();
                return;
            default:
                check satisfies never;
                throw new Error("Unknown suggested answer rating");
        }
    }

    public hideAllButtons() {
        if (!this.responseEl.hasClass("sr-is-hidden")) {
            this.responseEl.addClass("sr-is-hidden");
        }
        this.answerButton.buttonEl.addClass("sr-is-hidden");
        this.typedAnswerPanel.addClass("sr-is-hidden");
        this.hintButton.buttonEl.addClass("sr-is-hidden");
        this.againButton.buttonEl.addClass("sr-is-hidden");
        this.hardButton.buttonEl.addClass("sr-is-hidden");
        this.goodButton.buttonEl.addClass("sr-is-hidden");
        this.easyButton.buttonEl.addClass("sr-is-hidden");
    }

    public showRatingButtons(
        reviewMode: FlashcardReviewMode,
        againButtonText: string,
        hardButtonText: string,
        goodButtonText: string,
        easyButtonText: string,
        showIntervalInReviewButtons: boolean,
        determineButtonSchedule: (response: ReviewResponse) => RepItemScheduleInfo | null,
    ) {
        if (this.responseEl.hasClass("sr-is-hidden")) {
            this.responseEl.removeClass("sr-is-hidden");
        }
        // Shows the rating buttons and hides the front-of-card controls
        this.answerButton.buttonEl.addClass("sr-is-hidden");
        this.typedAnswerPanel.addClass("sr-is-hidden");
        this.hintButton.buttonEl.addClass("sr-is-hidden");
        this.responseEl.removeClass("sr-has-typed-answer");

        if (reviewMode === FlashcardReviewMode.Cram) {
            this.responseEl.addClass("is-cram");
            this.againButton.setButtonText(`${againButtonText}`);
            this.easyButton.setButtonText(`${easyButtonText}`);

            if (this.againButton.buttonEl.hasClass("sr-is-hidden")) {
                this.againButton.buttonEl.removeClass("sr-is-hidden");
            }
            if (this.easyButton.buttonEl.hasClass("sr-is-hidden")) {
                this.easyButton.buttonEl.removeClass("sr-is-hidden");
            }

            if (!this.goodButton.buttonEl.hasClass("sr-is-hidden")) {
                this.goodButton.buttonEl.addClass("sr-is-hidden");
            }
            if (!this.hardButton.buttonEl.hasClass("sr-is-hidden")) {
                this.hardButton.buttonEl.addClass("sr-is-hidden");
            }
        } else {
            if (this.responseEl.hasClass("is-cram")) this.responseEl.removeClass("is-cram");
            this.againButton.buttonEl.removeClass("sr-is-hidden");
            this.hardButton.buttonEl.removeClass("sr-is-hidden");
            this.goodButton.buttonEl.removeClass("sr-is-hidden");
            this.easyButton.buttonEl.removeClass("sr-is-hidden");
            this._setupEaseButton(
                this.againButton,
                againButtonText,
                determineButtonSchedule(ReviewResponse.Again),
                showIntervalInReviewButtons,
            );
            this._setupEaseButton(
                this.hardButton,
                hardButtonText,
                determineButtonSchedule(ReviewResponse.Hard),
                showIntervalInReviewButtons,
            );
            this._setupEaseButton(
                this.goodButton,
                goodButtonText,
                determineButtonSchedule(ReviewResponse.Good),
                showIntervalInReviewButtons,
            );
            this._setupEaseButton(
                this.easyButton,
                easyButtonText,
                determineButtonSchedule(ReviewResponse.Easy),
                showIntervalInReviewButtons,
            );
        }
    }

    private _setupEaseButton(
        button: SRResponseButtonComponent,
        buttonName: string,
        schedule: RepItemScheduleInfo | null,
        showInterval: boolean,
    ) {
        if (showInterval) {
            button.setSmallText(formatScheduleInterval(schedule, true));
            button.setLargeText(`${buttonName} - ${formatScheduleInterval(schedule, false)}`);

            if (EmulatedPlatform().isMobile || Platform.isMobile) {
                if (button.buttonEl.hasClass("sr-show-large-text")) {
                    button.buttonEl.removeClass("sr-show-large-text");
                }
                if (!button.buttonEl.hasClass("sr-show-small-text")) {
                    button.buttonEl.addClass("sr-show-small-text");
                }
            } else {
                if (button.buttonEl.hasClass("sr-show-small-text")) {
                    button.buttonEl.removeClass("sr-show-small-text");
                }
                if (!button.buttonEl.hasClass("sr-show-large-text")) {
                    button.buttonEl.addClass("sr-show-large-text");
                }
            }
        } else {
            if (button.buttonEl.hasClass("sr-show-small-text")) {
                button.buttonEl.removeClass("sr-show-small-text");
            }
            if (!button.buttonEl.hasClass("sr-show-large-text")) {
                button.buttonEl.addClass("sr-show-large-text");
            }
            button.setLargeText(buttonName);
        }
    }
}
