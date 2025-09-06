/**
 * In-memory session/room storage for UNO Lite.
 *
 * This module provides a tiny state container around the pure engine reducer,
 * keyed by room id. There is no persistence: restarting the process clears all
 * rooms, which is acceptable for this task.
 */
import { GameState } from "../game/types.js";
import { createEmptyGame, reduce } from "../game/engine.js";

export type Rooms = Map<string, GameState>;

export const rooms: Rooms = new Map();

/**
 * Create a new room with a short random id and initialize its game state.
 */
export function createRoom(): string {
	const id = Math.random().toString(36).slice(2, 6).toUpperCase();
	if (rooms.has(id)) return createRoom();
	rooms.set(id, createEmptyGame(id));
	return id;
}

export function getRoom(id: string): GameState | undefined {
	return rooms.get(id);
}

/**
 * Update a room's state using a functional updater.
 */
export function updateRoom(id: string, updater: (s: GameState) => GameState): GameState {
	const s = rooms.get(id);
	if (!s) throw new Error("Room not found");
	const next = updater(s);
	rooms.set(id, next);
	return next;
}

/**
 * Apply a game engine action to the room's state.
 */
export function apply(id: string, action: Parameters<typeof reduce>[1]): GameState {
	return updateRoom(id, (s) => reduce(s, action));
}

