/** Public deterministic challenge assignment; not a secret or an anti-bot claim. */
export async function certificationSeed(
  roundId: string,
  mode: 'step' | 'continuous',
  attemptNumber: number,
) {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`rcj-2026-v1:${roundId}:${mode}:${attemptNumber}`),
  );
  return new DataView(hash).getUint32(0, false) || 1;
}
