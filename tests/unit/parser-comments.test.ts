import { CardType } from "src/data/data-structures/card/questions/question";
import { DEFAULT_SETTINGS } from "src/data/settings";
import { parse } from "src/parser";

test.each(["<!-- hidden -->", "<!-- hidden\ncomment -->"])(
    "cards immediately after %s remain discoverable",
    (comment) => {
        const cards = parse(`${comment}\nQ::A`, DEFAULT_SETTINGS);
        expect(cards.map((card) => card.text)).toEqual(["Q::A"]);
        expect(cards[0].cardType).toBe(CardType.SingleLineBasic);
        expect(cards[0].firstLineNum).toBe(comment.split("\n").length);
    },
);
