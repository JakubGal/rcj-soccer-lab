import type { AccountProfilePatch } from '@/lib/account/types';
import type { RuleLearningEvent } from '@/lib/certification/client-types';
import type { MatchReplay } from '@/lib/certification/replay';
import { packReplay } from './transport';

export const GITHUB_REPOSITORY = 'JakubGal/rcj-soccer-lab';
export const ACADEMY_DATA_URL = `https://raw.githubusercontent.com/${GITHUB_REPOSITORY}/academy-data/`;
export const SUBMISSION_MARKER = 'RCJ-ACADEMY-V1:';
export const SIGNING_KEY_ID = 'academy-2026-v1';

export type GitHubGameEvidence = {
  id: string;
  mode: 'step' | 'continuous';
  seed: number;
  startedAt: string;
  endedAt?: string;
  replay?: MatchReplay;
};
export type GitHubRoundEvidence = {
  id: string;
  number: number;
  startedAt: string;
  ruleEvents: RuleLearningEvent[];
  games: GitHubGameEvidence[];
};
export type GitHubSubmission = {
  schema: 1;
  requestId: string;
  kind: 'connect' | 'certify';
  profile: AccountProfilePatch;
  round?: GitHubRoundEvidence;
};
export type GitHubCertificate = {
  githubId: number;
  githubLogin: string;
  refereeNumber: string;
  displayName: string;
  country: string;
  season: string;
  certifiedAt: string;
  verificationCode: string;
  issueNumber: number;
  roundId: string;
  summary: Record<string, unknown>;
};
export type GitHubReceipt = {
  requestId: string;
  kind: 'connect' | 'certify';
  status: 'accepted' | 'rejected';
  githubId: number;
  githubLogin: string;
  refereeNumber: string;
  issueNumber: number;
  message: string;
  certificate?: GitHubCertificate;
};
export type SignedEnvelope = {
  payload: string;
  signature: string;
  keyId: string;
};
export type PreparedSubmission = {
  kind: 'connect' | 'certify';
  requestId: string;
  body: string;
  issueUrl: string;
};

export function base64url(bytes: Uint8Array) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 16384)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
export function fromBase64url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value))
    throw new Error('Invalid signed record.');
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function prepareSubmission(
  submission: GitHubSubmission,
): Promise<PreparedSubmission> {
  const wire = submission.round
    ? {
        ...submission,
        round: {
          ...submission.round,
          games: submission.round.games.map((game) => ({
            ...game,
            ...(game.replay ? { replay: packReplay(game.replay) } : {}),
          })),
        },
      }
    : submission;
  const bytes = new TextEncoder().encode(JSON.stringify(wire));
  if (bytes.length > 8 * 1024 * 1024)
    throw new Error(
      'This submission is too large. Export your progress as a backup.',
    );
  const compressed = await new Response(
    new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')),
  ).arrayBuffer();
  const code = base64url(new Uint8Array(compressed));
  if (code.length > 60000)
    throw new Error(
      'This round exceeds the GitHub issue size limit. Export your progress as a backup.',
    );
  const body = `Training academy ${submission.kind === 'connect' ? 'identity connection' : 'certification'} submission.\n\nI understand that this issue and the submitted training evidence are public. This is a training credential, not an official referee appointment.\n\n\`\`\`text\n${SUBMISSION_MARKER}${code}\n\`\`\``;
  const url = new URL(`https://github.com/${GITHUB_REPOSITORY}/issues/new`);
  url.searchParams.set(
    'title',
    `[RCJ Academy] ${submission.kind} ${submission.requestId}`,
  );
  // Large evidence packets are copied and pasted instead of passing a huge URL.
  url.searchParams.set(
    'body',
    code.length < 1000
      ? body
      : 'Paste the submission copied from RCJ Soccer Lab here.',
  );
  return {
    kind: submission.kind,
    requestId: submission.requestId,
    body,
    issueUrl: url.href,
  };
}
