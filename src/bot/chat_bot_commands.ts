/**
 * Telegram bot commands and simple render helpers for UNO Lite.
 *
 * This module wires the conversational interface to the pure game engine via
 * the in-memory session layer. Each command validates input and surfaces
 * engine errors as user-friendly messages.
 */
import { Bot, Context, InlineKeyboard } from "grammy";
import { apply, createRoom, getRoom, updateRoom, getUserLastRoom, setUserLastRoom, removeRoom, trackMessageId, getTrackedMessageIds, clearTrackedMessages } from "./session.js";
import { Color } from "../game/types.js";

export function registerCommands(bot: Bot<Context>) {
	const JOIN_PROMPT = "Please join room to play the game.";
	const TURN_PROMPT = "It is another player turn";
	async function trackedReply(ctx: Context, text: string, extra?: Parameters<Context["reply"]>[1]) {
		const msg = await ctx.reply(text, extra as any);
		if (ctx.chat?.id && msg?.message_id) trackMessageId(ctx.chat.id, msg.message_id);
		return msg;
	}

	async function trackedSend(ctx: Context, chatId: number, text: string, extra?: any) {
		const msg = await ctx.api.sendMessage(chatId, text, extra);
		trackMessageId(chatId, msg.message_id);
		return msg;
	}

	function getHelpText(): string {
		return [
			"UNO Lite game - use buttons (reccomended to avoid typing room id) or commands to play:",
			"",
			"🏠 Room Management:",
			"/new — create a new room",
			"/join <ROOM_ID> — join a room",
			"/startgame <ROOM_ID> — start the game (requires 2 players)",
			"/endgame <ROOM_ID> — terminate current game",
			"",
			"🎮 Game Commands:",
			"/state <ROOM_ID> — show game state",
			"/hand <ROOM_ID> — show your hand",
			"/play <ROOM_ID> <INDEX> — play card by index",
			"/draw <ROOM_ID> — draw one card from deck",
			"/pass <ROOM_ID> — end your turn",
			"",
			"📖 Game Rules:",
			"- 2 players. First to empty hand wins.",
			"- Deck: 2×1-9 for each color (🔴 Red, 🟢 Green, 🔵 Blue, 🟡 Yellow).",
			"- Deal 7 cards each. Top card goes to discard pile.",
			"- Match color OR number with top discard card.",
			"- If you can play: play one card, turn ends.",
			"- If you can't play: draw one card, then optionally play it.",
			"- If deck empties: shuffle discard pile (except top card).",
			"",
			"💡 Tips:",
			"- Use buttons for easier gameplay!",
			"- Room ID is optional if you're already in a room.",
			"- The first player to join always goes first."
		].join("\n");
	}

	function getRulesText(): string {
		return [
			"UNO Lite rules:",
			"- 2 players. First to empty hand wins.",
			"- Deck: 2×1-9 for each color (🔴 Red, 🟢 Green, 🔵 Blue, 🟡 Yellow).",
			"- Deal 7 cards each. Top card goes to discard pile.",
			"- Match color OR number with top discard card.",
			"- If you can play: play one card, turn ends.",
			"- If you can't play: draw one card, then optionally play it.",
			"- If deck empties: shuffle discard pile (except top card)."
		].join("\n");
	}

	async function notifyWhoseTurn(ctx: Context, state: any) {
		const p0 = state.players[0];
		const p1 = state.players[1];
		if (!p0 || !p1) return;
		const who = state.currentPlayerIdx === 0 ? p0 : p1;
		const whoName = who.displayName;
		const text = `It's ${whoName}'s turn now.\n${renderState(state)}`;
		// Both players get the standard room actions keyboard
		const keyboard = roomActionsKeyboard(state.id);
		await trackedSend(ctx, p0.tgUserId, text, { reply_markup: keyboard }).catch(() => {});
		await trackedSend(ctx, p1.tgUserId, text, { reply_markup: keyboard }).catch(() => {});
	}

	async function notifyWinner(ctx: Context, state: any) {
		const p0 = state.players[0];
		const p1 = state.players[1];
		if (!p0 || !p1) return;
		const winner = state.players.find((p: any) => p && p.id === state.winnerId);
		if (!winner) return;
		const text = `Game over. Winner: ${winner.displayName}!`;
		const keyboard = roomActionsKeyboard(state.id);
		await trackedSend(ctx, p0.tgUserId, text, { reply_markup: keyboard }).catch(() => {});
		await trackedSend(ctx, p1.tgUserId, text, { reply_markup: keyboard }).catch(() => {});
	}

	// Helper: inline keyboards
	function roomActionsKeyboard(roomId: string): InlineKeyboard {
		return new InlineKeyboard()
			.text("🃏 My hand", `hand:${roomId}`)
			.text("🂠 Draw", `draw:${roomId}`)
			.row()
			.text("⏭️ Pass", `pass:${roomId}`)
			.text("📊 State", `state:${roomId}`)
			.row()
			.text("📖 Rules", `rules:${roomId}`);
	}

	function maybeRoomActions(roomId: string, state: any | undefined): InlineKeyboard | undefined {
		if (state && state.phase === "in_progress") return roomActionsKeyboard(roomId);
		return undefined;
	}

	function handPlayKeyboard(roomId: string, state: any, forUserId: number): InlineKeyboard | undefined {
		if (!state || state.phase !== "in_progress") return undefined;
		const current = state.players[state.currentPlayerIdx];
		if (!current || current.tgUserId !== forUserId) return undefined;
		if (state.pendingDraw > 0 || state.pendingSkip) return undefined;
		const kb = new InlineKeyboard();
		current.hand.forEach((card: any, idx: number) => {
			kb.text(renderCardShort(card), `playidx:${roomId}:${idx}`);
			if ((idx + 1) % 2 === 0) kb.row();
		});
		return kb;
	}


	bot.command("help", async (ctx: Context) => {
		await trackedReply(ctx, getHelpText());
	});
	bot.command("new", async (ctx: Context) => {
		const roomId = createRoom();
		if (ctx.from?.id) setUserLastRoom(ctx.from.id, roomId);
		await trackedReply(ctx,
			`Room ${roomId} created. Share with a friend and /join ${roomId}`
		);
	});

	bot.command("join", async (ctx: Context) => {
		const parts = ctx.match?.toString().trim().split(/\s+/) ?? [];
		const roomId = parts[0];
		if (!roomId) return ctx.reply("Usage: /join <ROOM_ID>");
		const room = getRoom(roomId);
		if (!room) return ctx.reply("Room not found");
		try {
			updateRoom(roomId, (s) => ({ ...s })); // ensure exists
			const displayName = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || ctx.from?.username || `User${ctx.from!.id}`;
			const next = apply(roomId, { type: "joinGame", gameId: roomId, tgUserId: ctx.from!.id, displayName });
			setUserLastRoom(ctx.from!.id, roomId);
			await trackedReply(ctx, `Joined room ${roomId}. ${next.players.filter(Boolean).length < 2 ? "Waiting for another player..." : "Both players present. Host can /startgame."}`);
			// Notify both players when the second player joins
			const joinedPlayers = next.players.filter(Boolean) as Array<{ tgUserId: number; displayName: string }>;
			if (joinedPlayers.length === 2) {
				const [p0, p1] = joinedPlayers;
				const message = `Player joined: ${displayName}. Room ${roomId} is ready. Use /startgame ${roomId}.`;
				await trackedSend(ctx, p0.tgUserId, message).catch(() => {});
				await trackedSend(ctx, p1.tgUserId, message).catch(() => {});
			}
		} catch (e: any) {
			await ctx.reply(`Join failed: ${e.message ?? String(e)}`);
		}
	});

	bot.command("startgame", async (ctx: Context) => {
		const parts = ctx.match?.toString().trim().split(/\s+/) ?? [];
		let roomId: string | undefined = parts[0];
		if (!roomId) roomId = ctx.from?.id ? getUserLastRoom(ctx.from.id) : undefined as unknown as string;
		if (!roomId) return ctx.reply("Usage: /startgame <ROOM_ID>");
		const rid = roomId as string;
		try {
			const next = apply(rid, { type: "startGame", gameId: rid });
			if (ctx.from?.id) setUserLastRoom(ctx.from.id, rid);
			// Send turn notification to both players instead of showing state to starter
			await notifyWhoseTurn(ctx, next);
		} catch (e: any) {
			const room = getRoom(rid);
			const joined = room ? room.players.filter(Boolean).length : 0;
			const needPlayersMsg = `Game isn't ready yet. Two players must join this room.\nShare the room ID: ${rid}\nCurrent: ${joined}/2 joined.\nWhen both joined, run /startgame ${rid}.`;
			const msg = e?.code === "bad_phase" || /Not ready to start/i.test(String(e?.message)) || e?.code === "need_players"
				? needPlayersMsg
				: `Start failed: ${e?.message ?? String(e)}`;
			await ctx.reply(msg);
		}
	});

	bot.command("state", async (ctx: Context) => {
		const parts = ctx.match?.toString().trim().split(/\s+/) ?? [];
		let roomId: string | undefined = parts[0];
		if (!roomId) roomId = ctx.from?.id ? getUserLastRoom(ctx.from.id) : undefined as unknown as string;
		if (!roomId) return ctx.reply("Usage: /state <ROOM_ID>");
		const rid = roomId as string;
		const room = getRoom(rid);
		if (!room) return ctx.reply(JOIN_PROMPT);
		await trackedReply(ctx, renderState(room), { reply_markup: maybeRoomActions(rid, room) } as any);
	});

	bot.command("hand", async (ctx: Context) => {
		const parts = ctx.match?.toString().trim().split(/\s+/) ?? [];
		let roomId: string | undefined = parts[0];
		if (!roomId) roomId = ctx.from?.id ? getUserLastRoom(ctx.from.id) : undefined as unknown as string;
		if (!roomId) return ctx.reply("Usage: /hand <ROOM_ID>");
		const rid = roomId as string;
		const room = getRoom(rid);
		if (!room) return ctx.reply(JOIN_PROMPT);
		const p = room.players.find((p) => p?.tgUserId === ctx.from!.id);
		if (!p) return ctx.reply(JOIN_PROMPT);
		const lines = p.hand.map((c, i) => `${i}: ${renderCardShort(c)}`);
		await trackedReply(ctx, lines.length ? lines.join("\n") : "(empty hand)", { reply_markup: handPlayKeyboard(rid, room, ctx.from!.id) ?? maybeRoomActions(rid, room) } as any);
	});

	bot.command("play", async (ctx: Context) => {
		const parts = ctx.match?.toString().trim().split(/\s+/) ?? [];
		const [roomIdMaybe, idxStr] = parts;
		const roomId = roomIdMaybe ?? (ctx.from?.id ? getUserLastRoom(ctx.from.id) : undefined);
		if (!roomId || idxStr === undefined) return ctx.reply("Usage: /play <ROOM_ID> <INDEX>");
		const rid = roomId as string;
		const idx = Number(idxStr);
		if (Number.isNaN(idx)) return ctx.reply("INDEX must be a number");
		try {
			const after = apply(rid, { type: "playCard", gameId: rid, tgUserId: ctx.from!.id, handIndex: idx });
		if (after.phase === "finished") {
			await notifyWinner(ctx, after);
			return;
		}
		await trackedReply(ctx, renderState(after), { reply_markup: maybeRoomActions(rid, after) } as any);
		await notifyWhoseTurn(ctx, after);
		} catch (e: any) {
			if (e?.code === "turn") return ctx.reply(TURN_PROMPT);
			if (e?.code === "bad_phase") return ctx.reply(JOIN_PROMPT);
			if (e?.code === "illegal_move") return ctx.reply("The card does not satisfy the criteria to play, please chose another card or draw");
			await ctx.reply(`Play failed: ${e.message ?? String(e)}`);
		}
	});


	bot.command("draw", async (ctx: Context) => {
		const parts = ctx.match?.toString().trim().split(/\s+/) ?? [];
		const roomId = parts[0] ?? (ctx.from?.id ? getUserLastRoom(ctx.from.id) : undefined);
		if (!roomId) return ctx.reply("Usage: /draw <ROOM_ID>");
		const rid = roomId as string;
		try {
			const after = apply(rid, { type: "draw", gameId: rid, tgUserId: ctx.from!.id });
			await trackedReply(ctx, "You drew cards. Use /hand to see them. If no play, /pass.");
			await trackedReply(ctx, renderState(after), { reply_markup: maybeRoomActions(rid, after) } as any);
		} catch (e: any) {
			if (e?.code === "turn") return ctx.reply(TURN_PROMPT);
			if (e?.code === "bad_phase") return ctx.reply(JOIN_PROMPT);
			if (e?.code === "already_drawn") return ctx.reply("You already drew a card this turn. You may only play that card now or pass.");
			if (e?.code === "has_playable") return ctx.reply("You have a playable card. Please play it instead of drawing.");
			await ctx.reply(`Draw failed: ${e.message ?? String(e)}`);
		}
	});

	bot.command("pass", async (ctx: Context) => {
		const parts = ctx.match?.toString().trim().split(/\s+/) ?? [];
		const roomId = parts[0] ?? (ctx.from?.id ? getUserLastRoom(ctx.from.id) : undefined);
		if (!roomId) return ctx.reply("Usage: /pass <ROOM_ID>");
		const rid = roomId as string;
		try {
			const after = apply(rid, { type: "pass", gameId: rid, tgUserId: ctx.from!.id });
			await notifyWhoseTurn(ctx, after);
		} catch (e: any) {
			if (e?.code === "turn") return ctx.reply(TURN_PROMPT);
			if (e?.code === "bad_phase") return ctx.reply(JOIN_PROMPT);
			if (e?.code === "must_draw_first") return ctx.reply("You must draw a card before passing.");
			await ctx.reply(`Pass failed: ${e.message ?? String(e)}`);
		}
	});

	// Text button shortcuts from the reply keyboard
	bot.hears(["New room", "➕ New room"], async (ctx: Context) => {
		const roomId = createRoom();
		await ctx.reply(
			`Room ${roomId} created. Share with a friend and /join ${roomId}`
		);
	});
	bot.hears(["Join room", "🔗 Join room"], (ctx: Context) => ctx.reply("Send: /join <ROOM_ID>"));
	bot.hears(["My hand", "🃏 My hand"], (ctx: Context) => ctx.reply("Usage: /hand <ROOM_ID>"));
	bot.hears(["Draw", "🂠 Draw"], (ctx: Context) => ctx.reply("Usage: /draw <ROOM_ID>"));
	bot.hears(["Pass", "⏭️ Pass"], (ctx: Context) => ctx.reply("Usage: /pass <ROOM_ID>"));
	bot.hears(["State", "📊 State"], (ctx: Context) => ctx.reply("Usage: /state <ROOM_ID>"));

	// Inline callback handlers
	bot.callbackQuery(/^state:(.+)$/,(ctx: Context)=>{
		const roomId = (ctx as any).match![1] as string;
		const room = getRoom(roomId);
		if (!room) return (ctx as any).answerCallbackQuery({ text: JOIN_PROMPT, show_alert: true });
		(ctx as any).answerCallbackQuery();
		return trackedReply(ctx, renderState(room), { reply_markup: maybeRoomActions(roomId, room) } as any);
	});

	bot.callbackQuery(/^hand:(.+)$/,(ctx: Context)=>{
		const roomId = (ctx as any).match![1] as string;
		const room = getRoom(roomId);
		if (!room) return (ctx as any).answerCallbackQuery({ text: JOIN_PROMPT, show_alert: true });
		const p = room.players.find((p) => p?.tgUserId === ctx.from!.id);
		if (!p) return (ctx as any).answerCallbackQuery({ text: JOIN_PROMPT, show_alert: true });
		const lines = p.hand.map((c, i) => `${i}: ${renderCardShort(c)}`);
		const kb = handPlayKeyboard(roomId, room, ctx.from!.id) ?? maybeRoomActions(roomId, room);
		(ctx as any).answerCallbackQuery();
		return trackedReply(ctx, lines.length ? lines.join("\n") : "(empty hand)", { reply_markup: kb } as any);
	});

	bot.callbackQuery(/^draw:(.+)$/,(ctx: Context)=>{
		const roomId = (ctx as any).match![1] as string;
		try {
			const after = apply(roomId, { type: "draw", gameId: roomId, tgUserId: ctx.from!.id });
			(ctx as any).answerCallbackQuery({ text: "Drew cards" });
			return trackedReply(ctx, renderState(after), { reply_markup: maybeRoomActions(roomId, after) } as any);
		} catch (e: any) {
			if (e?.code === "turn") return (ctx as any).answerCallbackQuery({ text: TURN_PROMPT, show_alert: true });
			if (e?.code === "already_drawn") return (ctx as any).answerCallbackQuery({ text: "You already drew a card this turn. You may only play that card now or pass.", show_alert: true });
			if (e?.code === "has_playable") return (ctx as any).answerCallbackQuery({ text: "You have a playable card. Please play it instead of drawing.", show_alert: true });
			return (ctx as any).answerCallbackQuery({ text: JOIN_PROMPT, show_alert: true });
		}
	});

	bot.callbackQuery(/^pass:(.+)$/,(ctx: Context)=>{
		const roomId = (ctx as any).match![1] as string;
		try {
			const after = apply(roomId, { type: "pass", gameId: roomId, tgUserId: ctx.from!.id });
			(ctx as any).answerCallbackQuery({ text: "Passed" });
			return notifyWhoseTurn(ctx, after);
		} catch (e: any) {
			if (e?.code === "turn") return (ctx as any).answerCallbackQuery({ text: TURN_PROMPT, show_alert: true });
			if (e?.code === "must_draw_first") return (ctx as any).answerCallbackQuery({ text: "You must draw a card before passing.", show_alert: true });
			return (ctx as any).answerCallbackQuery({ text: JOIN_PROMPT, show_alert: true });
		}
	});


	// Play a card by index via inline buttons
	bot.callbackQuery(/^playidx:([^:]+):(\d+)$/ , async (ctx: Context) => {
		const roomId = (ctx as any).match![1] as string;
		const idx = Number((ctx as any).match![2]);
		try {
			const after = apply(roomId, { type: "playCard", gameId: roomId, tgUserId: ctx.from!.id, handIndex: idx });
			(ctx as any).answerCallbackQuery({ text: "Played" });
			if (after.phase === "finished") {
				await notifyWinner(ctx, after);
				return;
			}
			trackedReply(ctx, renderState(after), { reply_markup: maybeRoomActions(roomId, after) } as any);
			return notifyWhoseTurn(ctx, after);
		} catch (e: any) {
			if (e?.code === "turn") return (ctx as any).answerCallbackQuery({ text: TURN_PROMPT, show_alert: true });
			if (e?.code === "illegal_move") return (ctx as any).answerCallbackQuery({ text: "The card does not satisfy the criteria to play, please chose another card or draw", show_alert: true });
			return (ctx as any).answerCallbackQuery({ text: JOIN_PROMPT, show_alert: true });
		}
	});

	// Inline from /start
	bot.callbackQuery("new", async (ctx: Context) => {
		const roomId = createRoom();
		await (ctx as any).answerCallbackQuery();
		await trackedReply(ctx,
			`Room ${roomId} created. Share with a friend and /join ${roomId}`,
			{ reply_markup: roomActionsKeyboard(roomId) }
		);
	});
	bot.callbackQuery("help_inline", async (ctx: Context) => {
		await (ctx as any).answerCallbackQuery();
		await trackedReply(ctx, getHelpText());
	});
	
	// Rules button shows help content
	bot.callbackQuery(/^rules:(.+)$/, async (ctx: Context) => {
		const roomId = (ctx as any).match![1] as string;
		(ctx as any).answerCallbackQuery();
		const room = getRoom(roomId);
		if (!room) return trackedReply(ctx, JOIN_PROMPT);
		return trackedReply(ctx, getHelpText(), { reply_markup: roomActionsKeyboard(roomId) } as any);
	});

	// Terminate game: /endgame [ROOM_ID]
	bot.command("endgame", async (ctx: Context) => {
		const parts = ctx.match?.toString().trim().split(/\s+/) ?? [];
		const roomId = parts[0] ?? (ctx.from?.id ? getUserLastRoom(ctx.from.id) : undefined);
		if (!roomId) return trackedReply(ctx, "Usage: /endgame <ROOM_ID>");
		const room = getRoom(roomId);
		if (!room) return trackedReply(ctx, `Room ${roomId} not found.`);
		removeRoom(roomId);
		const p0 = room.players[0]; const p1 = room.players[1];
		await trackedReply(ctx, `Room ${roomId} terminated.`);
		if (p0) await trackedSend(ctx, p0.tgUserId, `Room ${roomId} ended by host.`).catch(()=>{});
		if (p1) await trackedSend(ctx, p1.tgUserId, `Room ${roomId} ended by host.`).catch(()=>{});
	});
}

/**
 * Render a short single-line representation of a card for chat.
 */
function renderCardShort(card: any): string {
	return `${colorEmoji(card.color)}${numberEmoji(card.value)}`;
}

/**
 * Map numbers 0-9 to emoji digits for nicer rendering.
 */
function numberEmoji(n: number): string {
	switch (n) {
		case 0:
			return "0️⃣";
		case 1:
			return "1️⃣";
		case 2:
			return "2️⃣";
		case 3:
			return "3️⃣";
		case 4:
			return "4️⃣";
		case 5:
			return "5️⃣";
		case 6:
			return "6️⃣";
		case 7:
			return "7️⃣";
		case 8:
			return "8️⃣";
		case 9:
			return "9️⃣";
		default:
			return String(n);
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
	const p0Name = p0?.displayName ?? "(empty)";
	const p1Name = p1?.displayName ?? "(empty)";
	const whoName = s.currentPlayerIdx === 0 ? p0Name : p1Name;
	if (s.phase === "finished") {
		const winner = s.players.find((p: any) => p && p.id === s.winnerId);
		const winnerName = winner?.displayName ?? "(unknown)";
		return [
			`Room ${s.id} — phase: finished`,
			`Game over. Winner: ${winnerName}`,
			`Top: ${renderCardShort(top)}  CurrentColor: ${s.currentColor ?? "?"}`,
			`Players: ${p0Name} (${p0 ? p0.hand.length : 0}) vs ${p1Name} (${p1 ? p1.hand.length : 0})`
		].join("\n");
	}
	return [
		`Room ${s.id} — phase: ${s.phase}`,
		`Top: ${renderCardShort(top)}  CurrentColor: ${s.currentColor ?? "?"}`,
		`Players: ${p0Name} (${p0 ? p0.hand.length : 0}) vs ${p1Name} (${p1 ? p1.hand.length : 0})`,
		`Turn: ${whoName}${s.pendingSkip ? " (next is skipped)" : ""}${s.pendingDraw ? ` (+${s.pendingDraw})` : ""}`
	].join("\n");
}