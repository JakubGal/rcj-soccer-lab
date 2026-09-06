import { DatabaseUnavailableError } from '@/db/env';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function apiJson(
  value: unknown,
  init: ResponseInit = {},
  cacheControl = 'private, no-store',
) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', cacheControl);
  headers.set('x-content-type-options', 'nosniff');
  return new Response(JSON.stringify(value), { ...init, headers });
}

export function apiFailure(error: unknown) {
  if (error instanceof ApiError)
    return apiJson(
      {
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      },
      { status: error.status },
    );
  if (error instanceof DatabaseUnavailableError)
    return apiJson(
      {
        error: {
          code: 'database_unavailable',
          message: error.message,
        },
      },
      { status: 503 },
    );
  console.error('Certification API error', error);
  return apiJson(
    {
      error: {
        code: 'internal_error',
        message: 'An unexpected error occurred.',
      },
    },
    { status: 500 },
  );
}

export function requireSameOriginMutation(request: Request) {
  const expectedOrigin = new URL(request.url).origin;
  const origin = request.headers.get('origin');
  if (origin !== expectedOrigin)
    throw new ApiError(
      403,
      'invalid_origin',
      'A same-origin request is required.',
    );
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin')
    throw new ApiError(
      403,
      'invalid_fetch_site',
      'A same-origin request is required.',
    );
  const contentType =
    request.headers
      .get('content-type')
      ?.split(';', 1)[0]
      .trim()
      .toLowerCase() ?? '';
  if (contentType !== 'application/json')
    throw new ApiError(
      415,
      'json_required',
      'The request must use application/json.',
    );
}

export async function readJsonBody(request: Request, maximumBytes = 262_144) {
  requireSameOriginMutation(request);
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes)
    throw new ApiError(413, 'body_too_large', 'The request body is too large.');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes)
    throw new ApiError(413, 'body_too_large', 'The request body is too large.');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(
      400,
      'invalid_json',
      'The request body is not valid JSON.',
    );
  }
}
