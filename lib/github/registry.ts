import publicKey from './public-key.json';
import {
  ACADEMY_DATA_URL,
  SIGNING_KEY_ID,
  fromBase64url,
  type SignedEnvelope,
  type GitHubCertificate,
  type GitHubReceipt,
} from './protocol';
import type { CertifiedRefereeDirectory } from '@/lib/account/types';

/** Only envelopes signed by the configured issuer are trusted, even after import. */
export async function verifyEnvelope<T>(value: unknown): Promise<T> {
  if (!value || typeof value !== 'object')
    throw new Error('Invalid signed record.');
  const envelope = value as SignedEnvelope;
  if (
    envelope.keyId !== SIGNING_KEY_ID ||
    typeof envelope.payload !== 'string' ||
    typeof envelope.signature !== 'string' ||
    envelope.payload.length > 8 * 1024 * 1024
  )
    throw new Error('Invalid signed record.');
  const key = await crypto.subtle.importKey(
    'jwk',
    publicKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  const bytes = fromBase64url(envelope.payload);
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    fromBase64url(envelope.signature),
    bytes,
  );
  if (!valid)
    throw new Error('This record does not have a valid academy signature.');
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

async function readSigned<T>(
  path: string,
  signal?: AbortSignal,
  expectedHash?: string,
) {
  if (
    !/^(requests\/[0-9a-f]{32}|directory\/(index|[0-9a-f]))\.json$/.test(path)
  )
    throw new Error('Invalid registry path.');
  const response = await fetch(`${ACADEMY_DATA_URL}${path}`, {
    signal,
    credentials: 'omit',
    cache: 'no-cache',
  });
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(
      'The GitHub registry is temporarily unavailable. Please try again later.',
    );
  const text = await response.text();
  if (text.length > 8 * 1024 * 1024)
    throw new Error('Registry record exceeds its size limit.');
  if (expectedHash) {
    const hash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(text),
    );
    const hex = [...new Uint8Array(hash)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    if (hex !== expectedHash)
      throw new Error(
        'The registry is being updated. Please try again in a moment.',
      );
  }
  const envelope = JSON.parse(text) as SignedEnvelope;
  return { envelope, payload: await verifyEnvelope<T>(envelope) };
}

export async function readReceipt(requestId: string, signal?: AbortSignal) {
  const result = await readSigned<GitHubReceipt>(
    `requests/${requestId}.json`,
    signal,
  );
  if (result && result.payload.requestId !== requestId)
    throw new Error('The verification response belongs to another request.');
  return result;
}

type DirectoryManifest = {
  schema: number;
  shards: { path: string; sha256: string; count: number }[];
  total: number;
  updatedAt: string;
};
let cached: { until: number; records: GitHubCertificate[] } | null = null;
let loading: Promise<GitHubCertificate[]> | null = null;
async function loadDirectory() {
  if (cached && cached.until > Date.now()) return cached.records;
  if (loading) return loading;
  loading = (async () => {
    const index = await readSigned<DirectoryManifest>('directory/index.json');
    if (!index)
      throw new Error('The GitHub registry has not been published yet.');
    const manifest = index.payload;
    if (
      manifest.schema !== 1 ||
      !Array.isArray(manifest.shards) ||
      manifest.shards.length > 16 ||
      new Set(manifest.shards.map((item) => item.path)).size !==
        manifest.shards.length
    )
      throw new Error('Invalid directory index.');
    const records: GitHubCertificate[] = [];
    // Four parallel CDN reads at a time; never one API request per referee.
    for (let offset = 0; offset < manifest.shards.length; offset += 4) {
      const chunks = await Promise.all(
        manifest.shards.slice(offset, offset + 4).map(async (shard) => {
          if (
            !/^directory\/[0-9a-f]\.json$/.test(shard.path) ||
            !/^[0-9a-f]{64}$/.test(shard.sha256)
          )
            throw new Error('Invalid directory index.');
          const value = await readSigned<{ records: GitHubCertificate[] }>(
            shard.path,
            undefined,
            shard.sha256,
          );
          if (
            !value ||
            !Array.isArray(value.payload.records) ||
            value.payload.records.length !== shard.count
          )
            throw new Error('Invalid directory shard.');
          return value.payload.records;
        }),
      );
      records.push(...chunks.flat());
    }
    if (
      records.length !== manifest.total ||
      new Set(records.map((item) => item.githubId)).size !== records.length
    )
      throw new Error('Invalid directory totals.');
    records.sort((a, b) =>
      a.refereeNumber.localeCompare(b.refereeNumber, 'en', { numeric: true }),
    );
    cached = { records, until: Date.now() + 60000 };
    return records;
  })().finally(() => {
    loading = null;
  });
  return loading;
}

export async function getCertifiedReferees(
  query = '',
  _baseUrl = '',
  signal?: AbortSignal,
  cursor?: string | null,
): Promise<CertifiedRefereeDirectory> {
  signal?.throwIfAborted();
  const records = await loadDirectory();
  signal?.throwIfAborted();
  const q = query.trim().toLocaleLowerCase();
  const results = records.filter(
    (row) =>
      !q ||
      `${row.refereeNumber} ${row.displayName} ${row.githubLogin}`
        .toLocaleLowerCase()
        .includes(q),
  );
  const offset = /^\d+$/.test(cursor ?? '') ? Number(cursor) : 0;
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw new Error('Invalid directory cursor.');
  return {
    total: results.length,
    nextCursor: offset + 25 < results.length ? String(offset + 25) : null,
    referees: results.slice(offset, offset + 25).map((row) => ({
      refereeNumber: row.refereeNumber,
      displayName: row.displayName,
      country: row.country,
      season: row.season,
      certifiedAt: row.certifiedAt,
      status: 'certified',
      verificationCode: row.verificationCode,
    })),
  };
}
