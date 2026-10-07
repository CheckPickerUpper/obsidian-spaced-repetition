// Obsidian augments the DOM; jsdom supplies the underlying browser elements.
export function installObsidianDom(): void {
    HTMLElement.prototype.addClass = function (name) {
        this.classList.add(name);
    };
    HTMLElement.prototype.addClasses = function (names) {
        this.classList.add(...names);
    };
    HTMLElement.prototype.removeClass = function (name) {
        this.classList.remove(name);
    };
    HTMLElement.prototype.hasClass = function (name) {
        return this.classList.contains(name);
    };
    HTMLElement.prototype.toggleClass = function (name, enabled) {
        this.classList.toggle(name, enabled);
    };
    HTMLElement.prototype.setText = function (text) {
        this.textContent = text;
    };
    HTMLElement.prototype.empty = function () {
        this.replaceChildren();
    };
    HTMLElement.prototype.createEl = function <K extends keyof HTMLElementTagNameMap>(
        tag: K,
        options: DomElementInfo = {},
    ): HTMLElementTagNameMap[K] {
        const element = document.createElement(tag);
        if (options.cls) {
            let names: string[];
            if (Array.isArray(options.cls)) names = options.cls;
            else names = [options.cls];
            element.classList.add(...names);
        }
        if (typeof options.text === "string") element.textContent = options.text;
        else if (options.text) element.append(options.text);
        for (const [name, value] of Object.entries(options.attr || {}))
            element.setAttribute(name, String(value));
        this.append(element);
        return element;
    };
    HTMLElement.prototype.createDiv = function (options = {}) {
        if (typeof options === "string") return this.createEl("div", { cls: options });
        return this.createEl("div", options);
    };
    HTMLElement.prototype.createSpan = function (options = {}) {
        if (typeof options === "string") return this.createEl("span", { cls: options });
        return this.createEl("span", options);
    };
}

export class ButtonComponent {
    readonly buttonEl: HTMLButtonElement;
    constructor(container: HTMLElement) {
        this.buttonEl = container.createEl("button");
    }
    setClass(name: string) {
        this.buttonEl.classList.add(name);
        return this;
    }
    setButtonText(text: string) {
        this.buttonEl.textContent = text;
        return this;
    }
    // @framework-boundary Obsidian ButtonComponent accepts a disabled DOM state.
    setDisabled(disabled: boolean) {
        this.buttonEl.disabled = disabled;
        return this;
    }
    setIcon(icon: string) {
        this.buttonEl.dataset.icon = icon;
        return this;
    }
    setTooltip(text: string) {
        this.buttonEl.title = text;
        return this;
    }
    onClick(callback: (event: MouseEvent) => void | Promise<void>) {
        this.buttonEl.addEventListener("click", (event) => {
            void callback(event);
        });
        return this;
    }
}
