import { listPublicReferees } from '@/lib/server/certification-store';
import { ApiError, apiFailure, apiJson } from '@/lib/server/http';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = (url.searchParams.get('q') ?? '').trim();
    if (query.length > 60)
      throw new ApiError(
        400,
        'invalid_query',
        'Search is limited to 60 characters.',
      );
    const limitValue = Number(url.searchParams.get('limit') ?? 25);
    const cursorValue = Number(url.searchParams.get('cursor') ?? 0);
    if (
      !Number.isSafeInteger(limitValue) ||
      limitValue < 1 ||
      limitValue > 50 ||
      !Number.isSafeInteger(cursorValue) ||
      cursorValue < 0
    )
      throw new ApiError(400, 'invalid_pagination', 'Pagination is invalid.');
    return apiJson(
      await listPublicReferees({
        query,
        limit: limitValue,
        cursor: cursorValue,
      }),
      { headers: { 'access-control-allow-origin': '*' } },
      'public, max-age=15, must-revalidate',
    );
  } catch (error) {
    const response = apiFailure(error);
    response.headers.set('access-control-allow-origin', '*');
    return response;
  }
}
