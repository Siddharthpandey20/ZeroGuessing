# Live hero card + prompt navigator (short design)

## 1. Hero answer card plays like a live chat, forever
**Why:** the card's check sequence ran once (~3.8 s) while it was still inside the monitor, so by the time it grew out it was static.
**What:** the card becomes a miniature replay of the real chat: a question is typed into a composer, sent, the readout
shows retrieving, the answer claims stream in word by word with their citation chips, each claim gets its verdict, the
faithfulness meter fills, a short hold, then the next question. Loops without end.
**Approaches:** A) rebuild the card as a chat replay (picked: looks like the product, themeable, live citations);
B) loop the old sequence (no typing/streaming); C) a screen-recording loop (heavy, no dark mode, goes stale).
**Calls made by Claude:** 3 questions from the demo corpus (prepayment penalty chain; penal charges conflict A 8.1 vs D 2.2;
co-borrower cover conflict F 3.2 vs G 1.1), quotes verbatim from `specimens.ts`. Card keeps a stable height (each claim
reserves its full height) so the hero layout and the dotted links don't jump. Reduced motion: the finished first answer, still.
Paused while the tab is hidden.

## 2. Prompt navigator in a chat (ChatGPT-style)
**What:** a small icon on the right edge of the conversation; hover or click opens a list of every question in the chat
(the version on screen), the one in view highlighted; clicking scrolls smoothly to it. Hidden below 2 questions.
Keyboard: focusable button, list of buttons, Escape closes. Touch: tap toggles.
