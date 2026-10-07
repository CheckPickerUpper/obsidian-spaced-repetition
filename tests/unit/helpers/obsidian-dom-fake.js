// Obsidian augments the DOM at runtime; jsdom supplies the underlying browser elements.
exports.installObsidianDom = () => {
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
    HTMLElement.prototype.createEl = function (tag, options = {}) {
        const element = document.createElement(tag);
        if (options.cls) {
            const names = Array.isArray(options.cls) ? options.cls : [options.cls];
            element.classList.add(...names);
        }
        if (options.text) element.textContent = options.text;
        for (const [name, value] of Object.entries(options.attr || {}))
            element.setAttribute(name, value);
        this.append(element);
        return element;
    };
    HTMLElement.prototype.createDiv = function (options) {
        return this.createEl("div", options);
    };
    HTMLElement.prototype.createSpan = function (options) {
        return this.createEl("span", options);
    };
};

exports.ButtonComponent = class ButtonComponent {
    constructor(container) {
        this.buttonEl = container.createEl("button");
    }
    setClass(name) {
        this.buttonEl.classList.add(name);
        return this;
    }
    setButtonText(text) {
        this.buttonEl.textContent = text;
        return this;
    }
    setDisabled(disabled) {
        this.buttonEl.disabled = disabled;
        return this;
    }
    setIcon(icon) {
        this.buttonEl.dataset.icon = icon;
        return this;
    }
    setTooltip(text) {
        this.buttonEl.title = text;
        return this;
    }
    onClick(callback) {
        this.buttonEl.addEventListener("click", callback);
        return this;
    }
};
