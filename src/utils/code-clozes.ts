interface CodeRegion {
    start: number;
    end: number;
    raw: string;
    placeholder: string;
}

interface CodeCloze {
    start: number;
    end: number;
    answer: string;
}

/** Protect code from prose cloze patterns, then substitute plain text before Markdown rendering. */
export class CodeClozeDocument {
    readonly template: string;
    readonly clozes: readonly CodeCloze[];
    private readonly regions: CodeRegion[];

    constructor(source: string) {
        if (!source.includes("[[sr:")) {
            this.clozes = [];
            this.template = source;
            this.regions = [];
            return;
        }
        const clozes: CodeCloze[] = [];
        this.regions = findCodeRegions(source);
        let prefix = "\uE000SR_CODE_";
        while (source.includes(prefix)) prefix += "_";
        this.regions.forEach((region, index) => {
            region.placeholder = `${prefix}${index}\uE001`;
            const markers = /\[\[sr:([\s\S]+?)\]\]/g;
            let match: RegExpExecArray;
            while ((match = markers.exec(region.raw)) !== null) {
                clozes.push({
                    start: region.start + match.index,
                    end: region.start + match.index + match[0].length,
                    answer: match[1],
                });
            }
        });
        let template = source;
        for (const region of [...this.regions].reverse()) {
            template =
                template.slice(0, region.start) + region.placeholder + template.slice(region.end);
        }
        this.clozes = clozes;
        this.template = template;
    }

    restore(params: {
        markdown: string;
        reveal: { kind: "all" } | { kind: "hide"; cloze: CodeCloze };
    }): string {
        let markdown = params.markdown;
        for (const region of this.regions) {
            let code = region.raw;
            for (let index = this.clozes.length - 1; index >= 0; index--) {
                const cloze = this.clozes[index];
                if (cloze.start < region.start || cloze.end > region.end) continue;
                let replacement = cloze.answer;
                switch (params.reveal.kind) {
                    case "all":
                        break;
                    case "hide":
                        if (cloze === params.reveal.cloze) replacement = "[...]";
                        break;
                    default:
                        params.reveal satisfies never;
                        throw new Error("Unknown code cloze reveal state");
                }
                code =
                    code.slice(0, cloze.start - region.start) +
                    replacement +
                    code.slice(cloze.end - region.start);
            }
            markdown = markdown.replace(region.placeholder, () => code);
        }
        return markdown;
    }
}

function findCodeRegions(source: string): CodeRegion[] {
    const regions: CodeRegion[] = [];
    const fences = /^ {0,3}(`{3,}|~{3,})[^\n]*\n/gm;
    let opening: RegExpExecArray;
    while ((opening = fences.exec(source)) !== null) {
        const delimiter = opening[1];
        const closing = new RegExp(`^ {0,3}${delimiter[0]}{${delimiter.length},}[ \\t]*$`, "gm");
        closing.lastIndex = fences.lastIndex;
        const end = closing.exec(source);
        let endIndex = source.length;
        if (end !== null) endIndex = end.index + end[0].length;
        regions.push({
            start: opening.index,
            end: endIndex,
            raw: source.slice(opening.index, endIndex),
            placeholder: "",
        });
        fences.lastIndex = endIndex;
    }

    const inline = /(?<!`)(`+)(?!`)([\s\S]*?)\1(?!`)/g;
    let match: RegExpExecArray;
    while ((match = inline.exec(source)) !== null) {
        if (regions.some((region) => match.index >= region.start && match.index < region.end))
            continue;
        regions.push({
            start: match.index,
            end: match.index + match[0].length,
            raw: match[0],
            placeholder: "",
        });
    }
    return regions.sort((left, right) => left.start - right.start);
}
