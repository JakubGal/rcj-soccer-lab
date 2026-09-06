import { getChatGPTUser } from '@/app/chatgpt-auth';
import { accountEnvelope } from '@/lib/server/certification-store';
import { apiFailure, apiJson, readJsonBody, ApiError } from '@/lib/server/http';
import { updateProfile } from '@/lib/server/profile';

const LINKS = {
  signIn: '/signin-with-chatgpt',
  signOut: '/signout-with-chatgpt',
};

export async function GET() {
  try {
    const user = await getChatGPTUser();
    if (!user)
      return apiJson({
        authenticated: false,
        profile: null,
        practice: {
          ruleChecksCompleted: 0,
          ruleChecksTotal: 73,
          completedQuestionIds: [],
          refereeGamesPlayed: 0,
          stepGamesPlayed: 0,
          continuousGamesPlayed: 0,
          stepAccuracy: null,
          continuousAccuracy: null,
        },
        certification: null,
        recentGames: [],
        certificationHistory: [],
        links: { signIn: LINKS.signIn, signOut: null },
      });
    return apiJson({ ...(await accountEnvelope(user)), links: LINKS });
  } catch (error) {
    return apiFailure(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user)
      throw new ApiError(
        401,
        'unauthorized',
        'Sign in with ChatGPT to update a profile.',
      );
    const body = await readJsonBody(request, 16_384);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new ApiError(
        400,
        'invalid_profile',
        'The profile update is invalid.',
      );
    const profile = await updateProfile(user, body as Record<string, unknown>);
    return apiJson({
      ...(await accountEnvelope(user, profile)),
      links: LINKS,
      message: 'Profile saved.',
    });
  } catch (error) {
    return apiFailure(error);
  }
}
