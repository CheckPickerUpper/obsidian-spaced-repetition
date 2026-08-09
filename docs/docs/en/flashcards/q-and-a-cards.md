# Question & Answer Cards

!!! note

    Cards must be assigned to a deck, either using an Obsidian tag such as `#flashcard` or by using the
    folder structure within the vault.

    See [Decks](decks.md) for further details.

## Single-line Basic

The prompt and the answer are separated by `::` (this can be configured in [settings](../user-options.md#flashcard-separators)).

```markdown
the question goes on this side::answer goes here!
```

!!! note "Displayed when reviewed"

    <div class="grid" markdown>

    !!! tip "Card Front"

        the question goes on this side

    !!! tip "Card Back"

        answer goes here!

    </div>

## Typed Answers, Hints, and Code Cards

Normal Q&A cards show a text box before the answer is revealed. Type what you remember and choose **Check Answer**, or press `Ctrl/Cmd+Enter`. The plugin shows your submitted answer, compares it with the stored answer, and still leaves the scheduling rating to you.

Typed answers are not written back to your note.

Hints are authored on the answer side inside an `SR-HINTS` HTML comment. The first three numbered entries become progressive hints:

````markdown
How do you double every number in a TypeScript array?
?
<!-- SR-HINTS
1. Start with the array method that returns a new array.
2. Use a callback that receives one value.
3. Multiply that value by two.
-->

```ts
const doubled = values.map((value) => value * 2);
```
````

The **Show Hint 1** button reveals the hints in order. The hint block stays hidden when the answer is revealed. Markdown code fences such as ` ```ts ` are rendered through Obsidian, and typed answers are shown in the expected answer's language when the answer contains a fenced code block.

---

## Single-line Bidirectional

Two cards are created from the single flashcard text.

The two parts are separated by `:::` (this can be configured in [settings](../user-options.md#flashcard-separators)).

For example:

```markdown
info 1:::info 2
```

!!! note "Card 1"

    <div class="grid" markdown>

    !!! tip "Front"

        info 1

    !!! tip "Back"

        info 2

    </div>

!!! note "Card 2"

    <div class="grid" markdown>

    !!! tip "Front"

        info 2

    !!! tip "Back"

        info 1

    </div>

These two cards are considered sibling cards. See [sibling cards](flashcards-overview.md#sibling-cards) regarding the
[Bury sibling cards until the next day](../user-options.md#flashcard-review) scheduling option.

---

## Multi-line Basic

The front and the back of the card are separated by `?` (this can be configured in [settings](../user-options.md#flashcard-separators)).

```markdown
As per the definition
of "multiline" the prompt
can be on multiple lines
?
same goes for
the answer
```

!!! note "Displayed when reviewed"

    <div class="grid" markdown>

    !!! tip "Card Front"

        As per the definition <br/>
        of "multiline" the prompt <br/>
        can be on multiple lines

    !!! tip "Card Back"

        same goes for <br/>
        the answer

    </div>

These can also span over multiple lines as long as both sides "touch" the `?`.

See [Cards with Blank Lines](cards-with-blank-lines.md) if blank lines need to be included.

---

## Multi-line Bidirectional

Two cards are created from the single flashcard text.

The two parts are separated by `??` (this can be configured in [settings](../user-options.md#flashcard-separators)).

For example:

```markdown
info 1A
info 1B
info 1C
??
info 2A
info 2B
```

These can also span over multiple lines as long as both sides "touch" the `??`:
To include blank lines, see the section below.

!!! note "Card 1"

    <div class="grid" markdown>

    !!! tip "Front"

        info 1A <br/>
        info 1B <br/>
        info 1C

    !!! tip "Back"

        info 2A <br/>
        info 2B

    </div>

!!! note "Card 2"

    <div class="grid" markdown>

    !!! tip "Front"

        info 2A <br/>
        info 2B

    !!! tip "Back"

        info 1A <br/>
        info 1B <br/>
        info 1C

    </div>

These two cards are considered sibling cards. See [sibling cards](flashcards-overview.md#sibling-cards) regarding the
[Bury sibling cards until the next day](../user-options.md#flashcard-review) scheduling option.
