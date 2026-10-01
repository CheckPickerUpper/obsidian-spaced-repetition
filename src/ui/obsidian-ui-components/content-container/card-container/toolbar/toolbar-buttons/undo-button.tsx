import { t } from "src/lang/helpers";
import SRButtonComponent from "src/ui/sr-button";

export default class UndoButtonComponent extends SRButtonComponent {
    public constructor(
        container: HTMLElement,
        undoClickHandler: () => void,
        classNames?: string[],
    ) {
        super(container, {
            classNames: ["sr-undo-button", ...(classNames ?? [])],
            icon: "undo-2",
            tooltip: t("UNDO_LAST_ANSWER"),
            onClick: () => {
                if (this.buttonEl.hasClass("mod-disabled")) return;
                undoClickHandler();
            },
        });
    }

    /**
     * Sets the disabled state of the button
     * @param disabled - The disabled state
     */
    public setUndoDisabled(disabled: boolean) {
        this.buttonEl.toggleClass("mod-disabled", disabled);
        this.buttonEl.setAttribute("aria-disabled", disabled ? "true" : "false");
    }
}
