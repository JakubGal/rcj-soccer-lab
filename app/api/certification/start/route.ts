import { requireAuthenticatedUser } from '@/lib/server/auth';
import {
  accountEnvelope,
  startCertificationRound,
} from '@/lib/server/certification-store';
import { ApiError, apiFailure, apiJson, readJsonBody } from '@/lib/server/http';

export async function POST(request: Request) {
  try {
    const user = await requireAuthenticatedUser();
    const body = await readJsonBody(request, 1_024);
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length > 0
    )
      throw new ApiError(
        400,
        'invalid_request',
        'An empty JSON object is required.',
      );
    await startCertificationRound(user, false);
    return apiJson({
      ...(await accountEnvelope(user)),
      links: {
        signIn: '/signin-with-chatgpt',
        signOut: '/signout-with-chatgpt',
      },
      message: 'Certification round started.',
    });
  } catch (error) {
    return apiFailure(error);
  }
}
