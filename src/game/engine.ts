/**
 * Pure game engine for UNO Lite.
 *
 * This module contains pure functions that operate over `GameState` and return
 * new states. There are no side effects; all mutations are functional. The
 * Telegram bot integrates with the engine via the `reduce` function.
 */
import { ActionCard, Card, Color, EngineAction, EngineError, GameState, PlayerState, Phase } from "./types.js";
import { createDeck, drawOne } from "./deck.js";

/**
 * Initialize an empty game that is ready to accept players.
 */
export function createEmptyGame(gameId: string): GameState {
	return {
		id: gameId,
		phase: "waiting_for_players",
		players: [null, null],
		currentPlayerIdx: 0,
		drawPile: [],
		discardPile: [],
		currentColor: null,
		pendingDraw: 0,
		pendingSkip: false
	};
}

/**
 * Add a player to the first available slot.
 * @throws EngineError when room is full or join not allowed in current phase
 */
export function joinGame(state: GameState, tgUserId: number): GameState {
	if (state.phase !== "waiting_for_players" && state.phase !== "ready_to_start") {
		throw new EngineError("bad_phase", "Cannot join now");
	}
	const slot = state.players.findIndex((p) => p === null);
	if (slot === -1) throw new EngineError("full", "Room is full");
	const player: PlayerState = { id: `p${slot}`, tgUserId, hand: [] };
	const players = state.players.slice();
	players[slot] = player;
	const phase = players[0] && players[1] ? "ready_to_start" : "waiting_for_players";
	return { ...state, players, phase };
}

/**
 * Start the match by creating a deck, dealing 7 cards each, and flipping a
 * non-wild starting card onto the discard pile. Sets the current color based on
 * that starting card.
 */
export function startGame(state: GameState): GameState {
	if (state.phase !== "ready_to_start") throw new EngineError("bad_phase", "Not ready to start");
	if (!state.players[0] || !state.players[1]) throw new EngineError("need_players", "Two players required");
	let draw = createDeck(true);
	const discard: Card[] = [];
	const players: (PlayerState | null)[] = [
		{ ...state.players[0], hand: [] } as PlayerState,
		{ ...state.players[1], hand: [] } as PlayerState
	];
	// deal 7 cards each
	for (let r = 0; r < 7; r++) {
		for (let i = 0; i < 2; i++) {
			const { card, newDraw } = drawOne(draw, discard);
			draw = newDraw;
			(players[i] as PlayerState).hand.push(card);
		}
	}
	// flip starting discard; ensure it's not wild for simplicity
	let top: Card | null = null;
	while (!top) {
		const { card, newDraw } = drawOne(draw, discard);
		draw = newDraw;
		if (card.kind === "wild") {
			// place into discard but need a colored start; keep trying
			discard.push(card);
			continue;
		}
		top = card;
	}
	discard.push(top);
	const currentColor = top.kind === "number" || top.kind === "action" ? top.color : null;
	return {
		...state,
		phase: "in_progress",
		players,
		drawPile: draw,
		discardPile: discard,
		currentColor,
		currentPlayerIdx: 0,
		pendingDraw: 0,
		pendingSkip: false,
		winnerId: undefined
	};
}

/**
 * Check whether a card can be legally played given current color and top card.
 */
function isPlayable(card: Card, currentColor: Color | null, top: Card): boolean {
	if (card.kind === "wild") return true;
	// Matching by active color
	if ((card.kind === "number" || card.kind === "action") && currentColor && card.color === currentColor) return true;
	// Matching by same type value/action or color with top
	if (card.kind === "number" && top.kind === "number") return card.value === top.value || card.color === top.color;
	if (card.kind === "action" && top.kind === "action") return card.action === top.action || card.color === top.color;
	return false;
}

/**
 * Attempt to play a card from the current player's hand.
 * Applies effects (Skip/Reverse/Draw2/Wild) and performs win check.
 * Does not advance the turn; the reducer will call `endTurn` unless waiting for color.
 */
export function playCard(state: GameState, tgUserId: number, handIndex: number): GameState {
	if (state.phase !== "in_progress") throw new EngineError("bad_phase", "Game not in progress");
	const player = state.players[state.currentPlayerIdx];
	if (!player || player.tgUserId !== tgUserId) throw new EngineError("turn", "Not your turn");
	if (state.pendingDraw > 0) throw new EngineError("pending_draw", "You must draw");
	if (state.pendingSkip) throw new EngineError("pending_skip", "Your turn is skipped");
	const hand = player.hand.slice();
	if (handIndex < 0 || handIndex >= hand.length) throw new EngineError("bad_index", "No such card");
	const card = hand[handIndex];
	const top = state.discardPile[state.discardPile.length - 1];
	if (!isPlayable(card, state.currentColor, top)) throw new EngineError("illegal_move", "Card not playable");

	// apply effects
	let nextPendingDraw = 0;
	let nextPendingSkip = false;
	let nextPhase: Phase = state.phase;
	let nextColor: Color | null = state.currentColor;

	if (card.kind === "action") {
		if (card.action === ActionCard.Draw2) {
			nextPendingDraw = 2;
			nextPendingSkip = true; // skip after draw
		} else if (card.action === ActionCard.Skip || card.action === ActionCard.Reverse) {
			nextPendingSkip = true;
		}
		nextColor = card.color;
	} else if (card.kind === "number") {
		nextColor = card.color;
	} else if (card.kind === "wild") {
		nextPhase = "await_color_choice";
		nextColor = null;
	}

	// move card to discard
	const newDiscard = state.discardPile.concat(card);
	const newHand = hand.slice(0, handIndex).concat(hand.slice(handIndex + 1));
	const newPlayers = state.players.slice();
	newPlayers[state.currentPlayerIdx] = { ...player, hand: newHand };

	// win check
	let winnerId: string | undefined = undefined;
	let phase: Phase = nextPhase;
	if (newHand.length === 0) {
		winnerId = player.id;
		phase = "finished";
	}

	return {
		...state,
		players: newPlayers,
		discardPile: newDiscard,
		currentColor: nextColor,
		pendingDraw: nextPendingDraw,
		pendingSkip: nextPendingSkip,
		phase,
		winnerId
	};
}

/**
 * Handle color selection after a Wild is played.
 */
export function chooseColor(state: GameState, tgUserId: number, color: Exclude<Color, Color.Wild>): GameState {
	if (state.phase !== "await_color_choice") throw new EngineError("bad_phase", "No color choice pending");
	const player = state.players[state.currentPlayerIdx];
	if (!player || player.tgUserId !== tgUserId) throw new EngineError("turn", "Not your turn");
	return { ...state, currentColor: color, phase: "in_progress" };
}

/**
 * Draw one or more cards. If a penalty is pending, draw that amount and keep
 * the pendingSkip flag (so the player loses their turn).
 */
export function draw(state: GameState, tgUserId: number): GameState {
	if (state.phase !== "in_progress") throw new EngineError("bad_phase", "Game not in progress");
	const player = state.players[state.currentPlayerIdx];
	if (!player || player.tgUserId !== tgUserId) throw new EngineError("turn", "Not your turn");
	let drawPile = state.drawPile;
	let discard = state.discardPile;
	let nextPendingDraw = state.pendingDraw;
	let nextPendingSkip = state.pendingSkip;

	let numToDraw = Math.max(1, nextPendingDraw);
	const newCards: Card[] = [];
	for (let i = 0; i < numToDraw; i++) {
		const res = drawOne(drawPile, discard);
		drawPile = res.newDraw;
		discard = res.newDiscard;
		newCards.push(res.card);
	}
	// after drawing due to penalty, clear pending and keep skip
	nextPendingDraw = 0;
	// if it was penalty-driven, player loses turn via pendingSkip

	const newPlayers = state.players.slice();
	newPlayers[state.currentPlayerIdx] = { ...player, hand: player.hand.concat(newCards) };

	return {
		...state,
		players: newPlayers,
		drawPile,
		discardPile: discard,
		pendingDraw: nextPendingDraw,
		pendingSkip: nextPendingSkip
	};
}

/**
 * End current player's turn (or lose it if a skip is pending), advancing to the
 * other player and resolving skip semantics.
 */
export function pass(state: GameState, tgUserId: number): GameState {
	if (state.phase !== "in_progress") throw new EngineError("bad_phase", "Game not in progress");
	const player = state.players[state.currentPlayerIdx];
	if (!player || player.tgUserId !== tgUserId) throw new EngineError("turn", "Not your turn");
	if (state.pendingDraw > 0) throw new EngineError("pending_draw", "You must draw");
	// advance turn; apply pendingSkip effect now
	let nextIdx: 0 | 1 = state.currentPlayerIdx === 0 ? 1 : 0;
	let pendingSkip = state.pendingSkip;
	if (pendingSkip) {
		// skip next player, returns to current after skip
		nextIdx = nextIdx === 0 ? 1 : 0;
		pendingSkip = false;
	}
	return { ...state, currentPlayerIdx: nextIdx, pendingSkip };
}

/**
 * Internal helper used by the reducer to advance turns after successful play
 * or after choosing a color.
 */
export function endTurn(state: GameState): GameState {
	// helper to advance turn after a successful play (except wild awaiting color)
	let nextIdx: 0 | 1 = state.currentPlayerIdx === 0 ? 1 : 0;
	let pendingSkip = state.pendingSkip;
	if (pendingSkip) {
		nextIdx = nextIdx === 0 ? 1 : 0;
		pendingSkip = false;
	}
	return { ...state, currentPlayerIdx: nextIdx, pendingSkip };
}

/**
 * The single reducer entry point used by the bot/session layer.
 */
export function reduce(state: GameState, action: EngineAction): GameState {
	switch (action.type) {
		case "createGame":
			return createEmptyGame(action.gameId);
		case "joinGame":
			return joinGame(state, action.tgUserId);
		case "startGame":
			return startGame(state);
		case "playCard": {
			const afterPlay = playCard(state, action.tgUserId, action.handIndex);
			// if wild, await color choice and do not advance turn
			if (afterPlay.phase === "await_color_choice" || afterPlay.phase === "finished") return afterPlay;
			return endTurn(afterPlay);
		}
		case "chooseColor": {
			const after = chooseColor(state, action.tgUserId, action.color);
			return endTurn(after);
		}
		case "draw":
			return draw(state, action.tgUserId);
		case "pass":
			return pass(state, action.tgUserId);
		default:
			return state;
	}
}

