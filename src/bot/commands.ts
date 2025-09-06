/**
 * Telegram bot commands and simple render helpers for UNO Lite.
 *
 * This module wires the conversational interface to the pure game engine via
 * the in-memory session layer. Each command validates input and surfaces
 * engine errors as user-friendly messages.
 */
import { Bot, Context } from "grammy";
import { apply, createRoom, getRoom, updateRoom } from "./session.js";
import { Color } from "../game/types.js";

export function registerCommands(bot: Bot<Context>) {
	bot.command("help", async (ctx) => {
		await ctx.reply(
			[
				"Commands:",
				"/new — create room",
				"/join <ROOM_ID> — join a room",
				"/startgame <ROOM_ID> — start the game",
				"/state <ROOM_ID> — show game state",
				"/hand <ROOM_ID> — show your hand",
				"/play <ROOM_ID> <INDEX> — play card by index",
				"/draw <ROOM_ID> — draw one (or penalty)",
				"/pass <ROOM_ID> — end your turn",
				"/color <ROOM_ID> <red|yellow|green|blue> — choose after Wild"
			].join("\n")
		);
	});
	bot.command("new", async (ctx) => {
		const roomId = createRoom();
		await ctx.reply(`Room ${roomId} created. Share with a friend and /join ${roomId}`);
	});

	bot.command("join", async (ctx) => {
		const parts = ctx.match?.toString().trim().split(/\s+/) ?? [];
		const roomId = parts[0];
		if (!roomId) return ctx.reply("Usage: /join <ROOM_ID>");
		const room = getRoom(roomId);
		if (!room) return ctx.reply("Room not found");
		try {
			updateRoom(roomId, (s) => ({ ...s })); // ensure exists
			const next = apply(roomId, { type: "joinGame", gameId: roomId, tgUserId: ctx.from!.id });
			await ctx.reply(`Joined room ${roomId}. Phase: ${next.phase}`);
		} catch (e: any) {
			await ctx.reply(`Join failed: ${e.message ?? String(e)}`);
		}
	});

	bot.command("startgame", async (ctx) => {
		const parts = ctx.match?.toString().trim().split(/\s+/) ?? [];
		const roomId = parts[0];
		if (!roomId) return ctx.reply("Usage: /startgame <ROOM_ID>");
		try {
			const next = apply(roomId, { type: "startGame", gameId: roomId });
			await ctx.reply(renderState(next));
		} catch (e: any) {
			await ctx.reply(`Start failed: ${e.message ?? String(e)}`);
		}
	});

	bot.command("state", async (ctx) => {
		const parts = ctx.match?.toString().trim().split(/\s+/) ?? [];
		const roomId = parts[0];
		if (!roomId) return ctx.reply("Usage: /state <ROOM_ID>");
		const room = getRoom(roomId);
		if (!room) return ctx.reply("Room not found");
		await ctx.reply(renderState(room));
	});

	bot.command("hand", async (ctx) => {
		const parts = ctx.match?.toString().trim().split(/\s+/) ?? [];
		const roomId = parts[0];
		if (!roomId) return ctx.reply("Usage: /hand <ROOM_ID>");
		const room = getRoom(roomId);
		if (!room) return ctx.reply("Room not found");
		const p = room.players.find((p) => p?.tgUserId === ctx.from!.id);
		if (!p) return ctx.reply("You are not in this room");
		const lines = p.hand.map((c, i) => `${i}: ${renderCardShort(c)}`);
		await ctx.reply(lines.length ? lines.join("\n") : "(empty hand)");
	});

	bot.command("play", async (ctx) => {
		const parts = ctx.match?.toString().trim().split(/\s+/) ?? [];
		const [roomId, idxStr] = parts;
		if (!roomId || idxStr === undefined) return ctx.reply("Usage: /play <ROOM_ID> <INDEX>");
		const idx = Number(idxStr);
		if (Number.isNaN(idx)) return ctx.reply("INDEX must be a number");
		try {
			const after = apply(roomId, { type: "playCard", gameId: roomId, tgUserId: ctx.from!.id, handIndex: idx });
			if (after.phase === "await_color_choice") {
				await ctx.reply("Choose color: /color <ROOM_ID> <red|yellow|green|blue>");
			} else {
				await ctx.reply(renderState(after));
			}
		} catch (e: any) {
			await ctx.reply(`Play failed: ${e.message ?? String(e)}`);
		}
	});

	bot.command("color", async (ctx) => {
		const parts = ctx.match?.toString().trim().split(/\s+/) ?? [];
		const [roomId, colorStr] = parts;
		if (!roomId || !colorStr) return ctx.reply("Usage: /color <ROOM_ID> <red|yellow|green|blue>");
		const colorMap: Record<string, Exclude<Color, Color.Wild>> = { red: Color.Red, yellow: Color.Yellow, green: Color.Green, blue: Color.Blue };
		const color = colorMap[colorStr.toLowerCase()];
		if (!color) return ctx.reply("Invalid color. Use red|yellow|green|blue");
		try {
			const after = apply(roomId, { type: "chooseColor", gameId: roomId, tgUserId: ctx.from!.id, color });
			await ctx.reply(renderState(after));
		} catch (e: any) {
			await ctx.reply(`Color failed: ${e.message ?? String(e)}`);
		}
	});

	bot.command("draw", async (ctx) => {
		const parts = ctx.match?.toString().trim().split(/\s+/) ?? [];
		const roomId = parts[0];
		if (!roomId) return ctx.reply("Usage: /draw <ROOM_ID>");
		try {
			const after = apply(roomId, { type: "draw", gameId: roomId, tgUserId: ctx.from!.id });
			await ctx.reply("You drew cards. Use /hand to see them. If no play, /pass.");
			await ctx.reply(renderState(after));
		} catch (e: any) {
			await ctx.reply(`Draw failed: ${e.message ?? String(e)}`);
		}
	});

	bot.command("pass", async (ctx) => {
		const parts = ctx.match?.toString().trim().split(/\s+/) ?? [];
		const roomId = parts[0];
		if (!roomId) return ctx.reply("Usage: /pass <ROOM_ID>");
		try {
			const after = apply(roomId, { type: "pass", gameId: roomId, tgUserId: ctx.from!.id });
			await ctx.reply(renderState(after));
		} catch (e: any) {
			await ctx.reply(`Pass failed: ${e.message ?? String(e)}`);
		}
	});
}

/**
 * Render a short single-line representation of a card for chat.
 */
function renderCardShort(card: any): string {
	if (card.kind === "number") return `${colorEmoji(card.color)}${card.value}`;
	if (card.kind === "action") return `${colorEmoji(card.color)}${actionLabel(card.action)}`;
	return `⬛Wild`;
}

/**
 * Map engine action names to compact labels for chat.
 */
function actionLabel(a: string): string {
	switch (a) {
		case "skip":
			return "Skip";
		case "reverse":
			return "Reverse";
		case "draw2":
			return "Draw2";
		default:
			return a;
	}
}

/**
 * Map colors to emoji for fast visual recognition.
 */
function colorEmoji(c: Color): string {
	switch (c) {
		case Color.Red:
			return "🔴";
		case Color.Yellow:
			return "🟡";
		case Color.Green:
			return "🟢";
		case Color.Blue:
			return "🔵";
		default:
			return "⬛";
	}
}

/**
 * Render the public view of the room state.
 */
function renderState(s: any): string {
	const top = s.discardPile[s.discardPile.length - 1];
	const p0 = s.players[0];
	const p1 = s.players[1];
	const who = s.currentPlayerIdx === 0 ? "P0" : "P1";
	return [
		`Room ${s.id} — phase: ${s.phase}`,
		`Top: ${renderCardShort(top)}  CurrentColor: ${s.currentColor ?? "?"}`,
		`Hands: P0=${p0 ? p0.hand.length : 0} P1=${p1 ? p1.hand.length : 0}`,
		`Turn: ${who}${s.pendingSkip ? " (next is skipped)" : ""}${s.pendingDraw ? ` (+${s.pendingDraw})` : ""}`
	].join("\n");
}

