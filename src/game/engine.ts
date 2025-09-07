/**
 * Pure game engine for UNO Lite.
 *
 * This module contains pure functions that operate over `GameState` and return
 * new states. There are no side effects; all mutations are functional. The
 * Telegram bot integrates with the engine via the `reduce` function.
 */
import { Card, Color, EngineAction, EngineError, GameState, PlayerState, Phase } from "./types.js";
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
		pendingSkip: false,
		hasDrawnThisTurn: false
	};
}

/**
 * Add a player to the first available slot.
 * @throws EngineError when room is full or join not allowed in current phase
 */
export function joinGame(state: GameState, tgUserId: number, displayName: string): GameState {
	if (state.phase !== "waiting_for_players" && state.phase !== "ready_to_start") {
		throw new EngineError("bad_phase", "Cannot join now");
	}
	const slot = state.players.findIndex((p) => p === null);
	if (slot === -1) throw new EngineError("full", "Room is full");
	const player: PlayerState = { id: `p${slot}`, tgUserId, displayName, hand: [] };
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
	let draw = createDeck();
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
	// flip starting discard card (will always be a numbered card)
	const { card: top, newDraw: finalDraw } = drawOne(draw, discard);
	draw = finalDraw;
	discard.push(top);
	const currentColor = top.color; // top is always a numbered card
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
		hasDrawnThisTurn: false,
		winnerId: undefined
	};
}

/**
 * Check whether a card can be legally played given current color and top card.
 */
function isPlayable(card: Card, currentColor: Color | null, top: Card): boolean {
	// UNO Lite: only numbered cards, match by color or number
	if (card.kind === "number") {
		// Match by color
		if (currentColor && card.color === currentColor) return true;
		// Match by number with top card
		if (top.kind === "number" && card.value === top.value) return true;
	}
	return false;
}

/**
 * Attempt to play a card from the current player's hand.
 * Performs win check; reducer advances turn unless the game is finished.
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
	// UNO Lite: only numbered cards, set color to played card's color
	const nextColor: Color | null = card.color;

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
 * Draw one or more cards. If a penalty is pending, draw that amount and keep
 * the pendingSkip flag (so the player loses their turn).
 */
export function draw(state: GameState, tgUserId: number): GameState {
	if (state.phase !== "in_progress") throw new EngineError("bad_phase", "Game not in progress");
	const player = state.players[state.currentPlayerIdx];
	if (!player || player.tgUserId !== tgUserId) throw new EngineError("turn", "Not your turn");
	if (state.hasDrawnThisTurn) throw new EngineError("already_drawn", "Already drew a card this turn");
	// If the player has any playable card, they must play it and cannot draw
	const top = state.discardPile[state.discardPile.length - 1];
	const hasPlayable = player.hand.some((c) => isPlayable(c, state.currentColor, top));
	if (hasPlayable) throw new EngineError("has_playable", "You have a playable card in hand");
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
		pendingSkip: nextPendingSkip,
		hasDrawnThisTurn: true
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
	// UNO Lite rule in this app: if you can't play you must draw first, then you may pass
	if (!state.hasDrawnThisTurn) throw new EngineError("must_draw_first", "You must draw before passing");
	// advance turn; apply pendingSkip effect now
	let nextIdx: 0 | 1 = state.currentPlayerIdx === 0 ? 1 : 0;
	let pendingSkip = state.pendingSkip;
	if (pendingSkip) {
		// skip next player, returns to current after skip
		nextIdx = nextIdx === 0 ? 1 : 0;
		pendingSkip = false;
	}
	return { ...state, currentPlayerIdx: nextIdx, pendingSkip, hasDrawnThisTurn: false };
}

/**
 * Internal helper used by the reducer to advance turns after successful play.
 */
export function endTurn(state: GameState): GameState {
	// helper to advance turn after a successful play
	let nextIdx: 0 | 1 = state.currentPlayerIdx === 0 ? 1 : 0;
	let pendingSkip = state.pendingSkip;
	if (pendingSkip) {
		nextIdx = nextIdx === 0 ? 1 : 0;
		pendingSkip = false;
	}
	return { ...state, currentPlayerIdx: nextIdx, pendingSkip, hasDrawnThisTurn: false };
}

/**
 * The single reducer entry point used by the bot/session layer.
 */
export function reduce(state: GameState, action: EngineAction): GameState {
	switch (action.type) {
		case "createGame":
			return createEmptyGame(action.gameId);
		case "joinGame":
			return joinGame(state, action.tgUserId, action.displayName);
		case "startGame":
			return startGame(state);
		case "playCard": {
			const afterPlay = playCard(state, action.tgUserId, action.handIndex);
			// if game finished, return as-is, otherwise end turn
			if (afterPlay.phase === "finished") return afterPlay;
			return endTurn(afterPlay);
		}
		case "draw":
			return draw(state, action.tgUserId);
		case "pass":
			return pass(state, action.tgUserId);
		default:
			return state;
	}
}

