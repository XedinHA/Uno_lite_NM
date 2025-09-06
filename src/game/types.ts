/**
 * Core game type definitions for UNO Lite.
 *
 * This module intentionally contains only data types and simple error classes.
 * It is imported by both the game engine and the Telegram bot layer.
 *
 * UNO Lite differences vs classic UNO (as used by this project):
 * - Two players only
 * - Reverse behaves like Skip (effectively skips the next player)
 * - No stacking of Draw2 penalties (pendingDraw does not chain from multiple plays)
 * - Wild is color-choosing only (no Wild Draw4 in this minimal ruleset)
 */
export enum Color {
	Red = "red",
	Yellow = "yellow",
	Green = "green",
	Blue = "blue",
	Wild = "wild"
}

/**
 * Numeric face values available for number cards.
 */
export type NumericValue = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/**
 * Supported action card kinds in UNO Lite.
 * - Skip: next player loses their turn
 * - Reverse: treated as Skip in 2-player mode
 * - Draw2: next player must draw 2 and then is skipped
 * - Wild: player chooses the next active color
 */
export enum ActionCard {
	Skip = "skip",
	Reverse = "reverse", // acts like Skip in 2 players
	Draw2 = "draw2",
	Wild = "wild"
}

/**
 * Union of all possible cards in UNO Lite.
 * - number: colored numeric card 0-9
 */
export type Card =
	| { kind: "number"; color: Exclude<Color, Color.Wild>; value: NumericValue };

/**
 * Per-player state stored in a `GameState`.
 * - `id` is unique within a room (e.g., p0, p1)
 * - `tgUserId` ties the player to a Telegram user
 * - `hand` holds the player's current cards
 */
export interface PlayerState {
	id: string; // room-unique
	tgUserId: number;
	displayName: string;
	hand: Card[];
}

/**
 * High-level game lifecycle phases.
 */
export type Phase =
	| "waiting_for_players"
	| "ready_to_start"
	| "in_progress"
	| "finished";

/**
 * The complete state for a single UNO Lite game room.
 *
 * - `players`: fixed-size array of two slots (null when empty)
 * - `currentPlayerIdx`: whose turn it is (0 or 1)
 * - `drawPile`/`discardPile`: deck stacks (top is at end of array for discard)
 * - `currentColor`: active color for matching (after Wild or last colored play)
 * - `pendingDraw`: number of cards the next player must draw (e.g., Draw2 => 2)
 * - `pendingSkip`: whether the next player's turn is skipped
 * - `winnerId`: set when a player empties their hand
 */
export interface GameState {
	id: string;
	phase: Phase;
	players: (PlayerState | null)[]; // [player0, player1]
	currentPlayerIdx: 0 | 1;
	drawPile: Card[];
	discardPile: Card[];
	currentColor: Color | null; // active color (esp. after wild)
	pendingDraw: number; // e.g., from Draw2 chains; for Lite we do not stack
	pendingSkip: boolean;
	hasDrawnThisTurn?: boolean;
	winnerId?: string;
}

/**
 * Discriminated union of all actions that mutate a `GameState` in the engine.
 * These are consumed by the reducer in `engine.ts`.
 */
export type EngineAction =
	| { type: "createGame"; gameId: string }
	| { type: "joinGame"; gameId: string; tgUserId: number; displayName: string }
	| { type: "startGame"; gameId: string }
	| { type: "playCard"; gameId: string; tgUserId: number; handIndex: number }
	| { type: "draw"; gameId: string; tgUserId: number }
	| { type: "pass"; gameId: string; tgUserId: number };

/**
 * Engine-level error with a machine-readable `code` for the bot layer
 * to present user-friendly messages.
 */
export class EngineError extends Error {
	code: string;
	constructor(code: string, message: string) {
		super(message);
		this.code = code;
	}
}

