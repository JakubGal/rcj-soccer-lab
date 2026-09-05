/** Individual-tournament contribution from the 2026 awards document. */
export function tournamentPoints(place: number) {
  return place === 1 ? 30 : place === 2 ? 27 : Math.max(0, 28 - place);
}
