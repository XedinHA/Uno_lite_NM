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
- /start — check welcome
- /ping — should reply "pong 🏓"
- /new — create room; you'll get ROOM_ID
- /join ROOM_ID — second player joins
- /startgame ROOM_ID — deal cards and start
- /state ROOM_ID — show top discard, counts, turn
- /hand ROOM_ID — show your cards (indices)
- /play ROOM_ID INDEX — play a card by index
- /draw ROOM_ID — draw one (or penalty), then you may /play or /pass
- /color ROOM_ID <red|yellow|green|blue> — choose after wild
- /pass ROOM_ID — end your turn when allowed

## Roadmap
- Core game engine (pure TS) — done
- Session management (rooms) — done
- Commands: gameplay + rendering — done (minimal)
- Emoji rendering — basic

## Tech
- Node 20, TypeScript, grammY
- In-memory storage (single process)
- Long polling (no webhooks)

## Architecture

- src/game: pure engine (types, deck, reducer). No Telegram dependencies.
- src/bot: Telegram adapter (grammY), commands, in-memory rooms.

State phases: `waiting_for_players` → `ready_to_start` → `in_progress` ↔ `await_color_choice` → `finished`.

UNO Lite rules implemented: match by color or value/action; Wild sets color; Skip/Reverse skip next in 2p; Draw2 forces next to draw 2 and skip. First to 0 wins.

