/**
 * Deck utilities for UNO Lite: deck creation, shuffling and drawing.
 *
 * The draw/discard piles are modeled as arrays. For the discard pile, the
 * convention is that the top card is the last element in the array.
 */
import { ActionCard, Card, Color, NumericValue } from "./types.js";

/**
 * Create a new shuffled deck.
 *
 * Differences vs full UNO to keep the implementation compact:
 * - We include one copy of each number 0-9 per color
 * - One Skip, one Reverse, one Draw2 per color
 * - Four Wild cards (no Wild Draw4 in this Lite version)
 *
 * @param includeWild whether to include Wild cards
 * @returns a shuffled deck
 */
export function createDeck(includeWild = true): Card[] {
	const colors: Exclude<Color, Color.Wild>[] = [
		Color.Red,
		Color.Yellow,
		Color.Green,
		Color.Blue
	];
	const deck: Card[] = [];

	// Numbers: one 0, two 1-9 per color (simplify: one each to keep small)
	const numbers: NumericValue[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
	for (const color of colors) {
		for (const n of numbers) {
			deck.push({ kind: "number", color, value: n });
		}
		// Actions: Skip, Reverse, Draw2 (one each per color)
		deck.push({ kind: "action", color, action: ActionCard.Skip });
		deck.push({ kind: "action", color, action: ActionCard.Reverse });
		deck.push({ kind: "action", color, action: ActionCard.Draw2 });
	}

	if (includeWild) {
		// 4 Wilds
		for (let i = 0; i < 4; i++) deck.push({ kind: "wild", action: ActionCard.Wild });
	}

	return shuffle(deck);
}

/**
 * Fisher–Yates shuffle that returns a new array.
 */
export function shuffle<T>(arr: T[]): T[] {
	const a = arr.slice();
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

/**
 * Draw a single card from the draw pile. When the draw pile is empty,
 * reshuffle the discard pile (except for the top card) into a new draw pile.
 *
 * @param drawPile current draw pile
 * @param discardPile current discard pile (top is at the end)
 * @returns the drawn card and updated piles
 * @throws when there are no cards to draw at all
 */
export function drawOne(drawPile: Card[], discardPile: Card[]): { card: Card; newDraw: Card[]; newDiscard: Card[] } {
	let d = drawPile.slice();
	let disc = discardPile.slice();
	if (d.length === 0) {
		// reshuffle from discard (keep top card)
		if (disc.length <= 1) throw new Error("No cards to draw");
		const top = disc[disc.length - 1];
		disc = [top];
		d = shuffle(discardPile.slice(0, -1));
	}
	const card = d[0];
	return { card, newDraw: d.slice(1), newDiscard: disc };
}

