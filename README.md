# UNO Lite Telegram Bot (2 players)

Minimal multiplayer UNO Lite game as a Telegram bot

## Tech & dependencies

- Node 20, TypeScript
- grammY (Telegram bots framework)
- In-memory storage (single process)
- Long polling (no webhooks)
- Docker-only run

## Features
- Implicit ROOM_ID (bot remembers your last active room per user), so no need to indicate ROOM_ID each time you play the game
- Emoji card rendering (color + numeric emoji)
- Clear error messages and turn notifications

## App start

### Option A (recommended): Docker

Prereqs: Docker.

1) Build the docker image
```bash
docker build -t uno-lite-bot .
```

2) Run the bot (replace with your token)
```bash
docker run --rm -e BOT_TOKEN=123456:ABC-Your-Telegram-Bot-Token uno-lite-bot
```

### Option B (optional): Local run

Prereqs: Node 20.

1) Install deps
```bash
npm install
```

2) Start the bot
```bash
BOT_TOKEN=123456:ABC-Your-Telegram-Bot-Token npm start
```

### Commands
Talk to the bot in Telegram via pressing buttons or write the following commands:
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

## Game rules (UNO Lite variant in this bot)

- 2 players. First to empty hand wins.
- Deck: 2×1–9 for each color (🔴 Red, 🟢 Green, 🔵 Blue, 🟡 Yellow). No 0, no action/wild cards.
- Deal 7 cards each. Flip top card to discard to start.
- On your turn, you must match color OR number with the top discard.
- If you can play: play exactly one card; turn ends (unless game ends).
- If you cannot play: draw one card (exactly once per turn). If the drawn card matches, you may immediately play it; otherwise keep it.
- After drawing (whether you played or not), you may /pass; turn goes to the opponent.
- If deck empties: reshuffle discard pile (except top) into new draw pile.

Corner cases rule logic:
- Draw is available once per turn, resets on turn change.
- If you have a playable card, drawing is blocked (you must play).
- Passing without drawing this turn is blocked.
- Trying to play an unplayable card shows a clear message.
- When game ends, both players receive a winner message; /state shows "Game over" and the winner.
- Pressing actions on the wrong turn shows "It is another player turn".

## Architecture

- src/game: pure engine (types, deck, reducer). No Telegram dependencies.
- src/bot: Telegram adapter (grammY), commands, in-memory rooms.

State phases: `waiting_for_players` → `ready_to_start` → `in_progress` → `finished`.

### src/game (engine core)
- **`types.ts`**: Canonical types and enums used across the engine and bot layer.
  - Game phases, card definition, colors, player identifiers, engine errors.
  - State shape is explicit and serializable for potential future persistence.
- **`deck.ts`**: Pure utilities for deck creation/shuffling and discard/reshuffle logic.
  - Builds UNO Lite deck: 2×(1–9) per color.
  - Implements reshuffle when draw pile is exhausted, preserving top of discard.
- **`engine.ts`**: State machine and reducer-like operations.
  - Room/game initialization, dealing, starting, turn validation, play/draw/pass.
  - All rules are enforced here; it never calls Telegram APIs.
  - Returns rich results (next state + user-facing messages metadata) without formatting.

Design goals for the engine:
- Pure and deterministic given inputs; easy to unit test.
- Clear, small surface: `startGame`, `playCard`, `drawCard`, `passTurn`, `endGame`, `getPublicState`.
- No reliance on timers or I/O; the bot layer decides when to call engine functions.

### src/bot (Telegram adapter)
- **`index.ts`**: grammY bot bootstrap, token loading, polling startup, global error boundary.
- **`chat_bot_commands.ts`**: Command and callback handlers; formats responses for Telegram.
  - Parses user input, maps to engine operations, renders cards as emoji, builds keyboards.
- **`session.ts`**: In-memory room registry and per-user last-room hints.
  - Stores rooms keyed by `ROOM_ID`, user-to-room affinity, and transient game states.

Bot responsibilities:
- Validate and normalize user input before calling the engine.
- Translate engine results into Telegram messages and reply keyboards.
- Guard rails for UX (e.g., “not your turn”, “draw first”, helpful hints).

### Session/room model (in-memory)
- A single process holds all rooms in memory (no external DB by design).
- Room fields (high level):
  - `id`, `phase`, `players` (exactly two once ready), `hands`, `drawPile`, `discardPile`, `currentTurn`, `hasDrawnThisTurn`.
  - For UX: `lastActionSummary` used to show clear state updates.
- User mapping: `userId → lastActiveRoomId` to make ROOM_ID optional after join.

### Command flow
1. User sends `/command` or taps a keyboard button.
2. Bot parses input, identifies `userId` and `roomId` (explicit or inferred), loads room from memory.
3. Bot calls the corresponding engine function.
4. Engine returns the next state (or an error). Bot persists it to memory.
5. Bot renders human-friendly messages and keyboards; sends replies to involved users.

### Turn lifecycle (rules enforcement)
- On your turn, if you have at least one playable card, `/draw` is blocked and you must `/play`.
- If no playable card, `/draw` draws exactly one card. After drawing this turn, you may `/play` it if valid or `/pass`.
- After a legal `/play`, turn advances unless the game ends.
- Winner is declared immediately when a hand becomes empty.

### Validation and errors
- Engine returns structured errors for invalid operations (not your turn, card not playable, pass before draw, etc.).
- Bot converts them into concise user messages. This separation keeps the engine testable and the UX clear.

### Persistence and process model
- Intentionally ephemeral: restarting the container resets all rooms/sessions.
- Suitable for challenge constraints and simple hosting. For production, a storage adapter could be added without touching the engine.

### Extensibility
- Add action cards: extend `types.ts` and implement effects in `engine.ts`.
- Add more players: generalize `players` and turn rotation; the Telegram layer already addresses users by id.
- Add persistence: wrap session storage with an interface and plug a DB/Redis adapter.

### Testing hooks
- The engine is side-effect free and can be unit-tested by importing `engine.ts` functions with mocked states.
- The bot layer is thin; high-value tests focus on command parsing and formatting.

## Release
- Latest tag: `Release-1.0`

