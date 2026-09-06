import { headers } from 'next/headers';

const USER_ID_HEADER = 'oai-authenticated-user-id';
const EMAIL_HEADER = 'oai-authenticated-user-email';
const FULL_NAME_HEADER = 'oai-authenticated-user-full-name';
const FULL_NAME_ENCODING_HEADER = 'oai-authenticated-user-full-name-encoding';

export type ChatGPTUser = {
  id: string;
  email: string | null;
  fullName: string | null;
};

function cleanHeader(value: string | null, maximumLength: number) {
  const cleaned = value?.trim();
  if (
    !cleaned ||
    cleaned.length > maximumLength ||
    hasControlCharacter(cleaned)
  )
    return null;
  return cleaned;
}

function hasControlCharacter(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function decodedFullName(requestHeaders: Headers) {
  const raw = requestHeaders.get(FULL_NAME_HEADER);
  if (!raw) return null;
  if (
    requestHeaders.get(FULL_NAME_ENCODING_HEADER)?.toLowerCase() !==
    'percent-encoded-utf-8'
  )
    return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/**
 * Reads identity asserted by the Sites/Dispatch authentication boundary.
 * This helper never accepts an identity from cookies, query parameters, or JSON.
 */
export function readChatGPTUser(requestHeaders: Headers): ChatGPTUser | null {
  const id = cleanHeader(requestHeaders.get(USER_ID_HEADER), 256);
  if (!id) return null;
  return {
    id,
    email: cleanHeader(requestHeaders.get(EMAIL_HEADER), 320),
    fullName: cleanHeader(decodedFullName(requestHeaders), 160),
  };
}

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  return readChatGPTUser(await headers());
}
