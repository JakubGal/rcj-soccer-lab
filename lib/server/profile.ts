import type { ChatGPTUser } from '@/app/chatgpt-auth';
import { getD1Database } from '@/db/env';
import { ApiError } from './http';

export type RefereeProfile = {
  refereeNumber: number;
  displayName: string;
  countryCode: string | null;
  publicListing: boolean;
  createdAt: string;
  updatedAt: string;
};

type ProfileRow = {
  referee_number: number;
  display_name: string;
  country_code: string | null;
  public_listing: number;
  created_at: number;
  updated_at: number;
};

export function searchableName(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en')
    .replace(/\s+/g, ' ')
    .trim();
}

export function validateDisplayName(value: unknown) {
  if (typeof value !== 'string')
    throw new ApiError(
      400,
      'invalid_display_name',
      'Display name must be text.',
    );
  const cleaned = value.replace(/\s+/g, ' ').trim();
  if (
    cleaned.length < 2 ||
    cleaned.length > 60 ||
    hasUnsafeTextCharacters(cleaned)
  )
    throw new ApiError(
      400,
      'invalid_display_name',
      'Display name must be between 2 and 60 safe characters.',
    );
  return cleaned;
}

export function validateCountryCode(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string')
    throw new ApiError(
      400,
      'invalid_country_code',
      'Country or region must be text.',
    );
  const cleaned = value.replace(/\s+/g, ' ').trim();
  if (cleaned.length > 80 || hasUnsafeTextCharacters(cleaned))
    throw new ApiError(
      400,
      'invalid_country_code',
      'Country or region must be at most 80 safe characters.',
    );
  return cleaned || null;
}

function hasUnsafeTextCharacters(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 60 || code === 62 || code === 127) return true;
  }
  return false;
}

export function formatRefereeNumber(value: number) {
  return `RCJ-2026-${String(value).padStart(6, '0')}`;
}

function profileFromRow(row: ProfileRow): RefereeProfile {
  return {
    refereeNumber: row.referee_number,
    displayName: row.display_name,
    countryCode: row.country_code,
    publicListing: row.public_listing === 1,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function initialDisplayName(user: ChatGPTUser) {
  const proposed =
    user.fullName ??
    user.email?.split('@')[0]?.replace(/[._+-]+/g, ' ') ??
    'Referee';
  try {
    return validateDisplayName(proposed);
  } catch {
    return 'Referee';
  }
}

export async function ensureProfile(user: ChatGPTUser) {
  const db = getD1Database();
  const now = Date.now();
  const displayName = initialDisplayName(user);
  await db
    .prepare(
      `INSERT INTO referee_profiles
        (user_id, display_name, display_name_search, country_code, public_listing, created_at, updated_at)
       VALUES (?, ?, ?, NULL, 0, ?, ?)
       ON CONFLICT(user_id) DO NOTHING`,
    )
    .bind(user.id, displayName, searchableName(displayName), now, now)
    .run();
  const row = await db
    .prepare(
      `SELECT referee_number, display_name, country_code, public_listing, created_at, updated_at
       FROM referee_profiles WHERE user_id = ?`,
    )
    .bind(user.id)
    .first<ProfileRow>();
  if (!row) throw new Error('Profile creation did not return a row.');
  return profileFromRow(row);
}

export async function updateProfile(
  user: ChatGPTUser,
  patch: Record<string, unknown>,
) {
  const current = await ensureProfile(user);
  const displayName =
    patch.displayName === undefined
      ? current.displayName
      : validateDisplayName(patch.displayName);
  const countryValue = patch.countryCode ?? patch.country;
  const countryCode =
    patch.countryCode === undefined && patch.country === undefined
      ? current.countryCode
      : validateCountryCode(countryValue);
  const publicValue = patch.publicListing ?? patch.publicProfile;
  const publicListing =
    patch.publicListing === undefined && patch.publicProfile === undefined
      ? current.publicListing
      : publicValue;
  if (typeof publicListing !== 'boolean')
    throw new ApiError(
      400,
      'invalid_public_listing',
      'publicListing must be true or false.',
    );
  const allowed = new Set([
    'displayName',
    'countryCode',
    'country',
    'publicListing',
    'publicProfile',
  ]);
  const unknown = Object.keys(patch).filter((key) => !allowed.has(key));
  if (unknown.length)
    throw new ApiError(
      400,
      'unknown_fields',
      'The profile update has unknown fields.',
      {
        fields: unknown,
      },
    );
  const now = Date.now();
  await getD1Database()
    .prepare(
      `UPDATE referee_profiles
       SET display_name = ?, display_name_search = ?, country_code = ?, public_listing = ?, updated_at = ?
       WHERE user_id = ?`,
    )
    .bind(
      displayName,
      searchableName(displayName),
      countryCode,
      publicListing ? 1 : 0,
      now,
      user.id,
    )
    .run();
  return ensureProfile(user);
}
