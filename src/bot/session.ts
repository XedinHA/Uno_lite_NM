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

// Track each Telegram user's last active room to allow omitting ROOM_ID in commands
const userLastRoom = new Map<number, string>();

export function setUserLastRoom(tgUserId: number, roomId: string) {
	userLastRoom.set(tgUserId, roomId);
}

export function getUserLastRoom(tgUserId: number): string | undefined {
	return userLastRoom.get(tgUserId);
}

/** Remove a room and any associated state. */
export function removeRoom(id: string): void {
	rooms.delete(id);
	// Note: we do not clear userLastRoom here to allow convenience reuse, but it's fine to keep.
}

// Per-chat message tracking to support clearing bot history on demand
const chatIdToMessageIds = new Map<number, number[]>();

export function trackMessageId(chatId: number, messageId: number): void {
	const arr = chatIdToMessageIds.get(chatId) ?? [];
	arr.push(messageId);
	// keep only the latest 200 messages per chat to cap memory
	if (arr.length > 200) arr.splice(0, arr.length - 200);
	chatIdToMessageIds.set(chatId, arr);
}

export function getTrackedMessageIds(chatId: number): number[] {
	return chatIdToMessageIds.get(chatId) ?? [];
}

export function clearTrackedMessages(chatId: number): void {
	chatIdToMessageIds.delete(chatId);
}

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

