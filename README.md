# UNO Lite Telegram Bot (2 players)

Minimal multiplayer UNO Lite as a Telegram bot. Node.js + TypeScript, in-memory state, long polling, Docker-only run.

## Quick start

Prereqs: Docker.

1) Build the image
```bash
docker build -t uno-lite-bot .
```

2) Run the bot (replace with your token)
```bash
docker run --rm -e BOT_TOKEN=123456:ABC-Your-Telegram-Bot-Token uno-lite-bot
```

3) Talk to the bot in Telegram:
- /start — welcome, buttons
- /ping — should reply "pong 🏓"
- /new — create room; you'll get ROOM_ID
- /join ROOM_ID — second player joins
- /startgame — deal cards and start (ROOM_ID optional after you joined)
- /state — show top discard, counts, turn (ROOM_ID optional)
- /hand — show your cards (indices)
- /play INDEX — play a card by index
- /draw — draw one card (once per turn) if no playable cards
- /pass — end your turn (only after drawing this turn)
- /endgame — terminate current game (ROOM_ID optional)

Tip: You can use inline buttons (My hand / Draw / Pass / State / Rules) to avoid typing.

## Game rules (UNO Lite variant in this bot)
- 2 players. First to empty hand wins.
- Deck: 2×1–9 for each color (🔴 Red, 🟢 Green, 🔵 Blue, 🟡 Yellow). No 0, no action/wild cards.
- Deal 7 cards each. Flip top card to discard to start.
- On your turn, you must match color OR number with the top discard.
- If you can play: play exactly one card; turn ends (unless game ends).
- If you cannot play: draw one card (exactly once per turn). If the drawn card matches, you may immediately play it; otherwise keep it.
- After drawing (whether you played or not), you may /pass; turn goes to the opponent.
- If deck empties: reshuffle discard pile (except top) into new draw pile.

Enforced by bot:
- Draw is available once per turn, resets on turn change.
- If you have a playable card, drawing is blocked (you must play).
- Passing without drawing this turn is blocked.
- Trying to play an unplayable card shows a clear message.
- When game ends, both players receive a winner message; /state shows "Game over" and the winner.
- Pressing actions on the wrong turn shows "It is another player turn".

## Features
- Inline buttons for most actions
- Implicit ROOM_ID (bot remembers your last active room per user)
- Emoji card rendering (color + numeric emoji)
- Clear error messages and turn notifications

## Tech & dependencies
- Node 20, TypeScript, grammY
- In-memory storage (single process)
- Long polling (no webhooks)
- Docker-only run

## Architecture

- src/game: pure engine (types, deck, reducer). No Telegram dependencies.
- src/bot: Telegram adapter (grammY), commands, in-memory rooms.

State phases: `waiting_for_players` → `ready_to_start` → `in_progress` → `finished`.

## Release
- Latest tag: `Release-1.0`

