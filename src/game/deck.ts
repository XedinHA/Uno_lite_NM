/**
 * Deck utilities for UNO Lite: deck creation, shuffling and drawing.
 *
 * The draw/discard piles are modeled as arrays. For the discard pile, the
 * convention is that the top card is the last element in the array.
 */
import { ActionCard, Card, Color, NumericValue } from "./types.js";

/**
 * Create a new shuffled deck for UNO Lite.
 *
 * UNO Lite deck composition:
 * - 1×0, 2×1-9 for each color (🔴 Red, 🟢 Green, 🔵 Blue, 🟡 Yellow)
 * - No action cards (Skip, Reverse, Draw2)
 * - No wild cards
 *
 * @returns a shuffled deck
 */
export function createDeck(): Card[] {
	const colors: Exclude<Color, Color.Wild>[] = [
		Color.Red,
		Color.Yellow,
		Color.Green,
		Color.Blue
	];
	const deck: Card[] = [];

	// Numbers: 2×1-9 per color (no zeros in this variant)
	for (const color of colors) {
		for (let n = 1; n <= 9; n++) {
			deck.push({ kind: "number", color, value: n as NumericValue });
			deck.push({ kind: "number", color, value: n as NumericValue });
		}
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

