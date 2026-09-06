import { requireAuthenticatedUser } from '@/lib/server/auth';
import {
  accountEnvelope,
  finishGameAttempt,
} from '@/lib/server/certification-store';
import { ApiError, apiFailure, apiJson, readJsonBody } from '@/lib/server/http';

export async function POST(
  request: Request,
  context: { params: Promise<{ attemptId: string }> | { attemptId: string } },
) {
  try {
    const user = await requireAuthenticatedUser();
    const value = await readJsonBody(request);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new ApiError(400, 'invalid_report', 'The game report is invalid.');
    const body = value as Record<string, unknown>;
    const params = await context.params;
    const nestedReport =
      body.report &&
      typeof body.report === 'object' &&
      !Array.isArray(body.report)
        ? (body.report as Record<string, unknown>)
        : body;
    const counters = {
      correct: nestedReport.correct,
      wrong: nestedReport.wrong,
      missed: nestedReport.missed,
      assisted: nestedReport.assisted,
    };
    const finished = await finishGameAttempt(
      user,
      params.attemptId,
      body.elapsedSeconds as number,
      counters as never,
      body.transcript ?? body.decisionLog,
    );
    return apiJson({
      ...(await accountEnvelope(user)),
      links: {
        signIn: '/signin-with-chatgpt',
        signOut: '/signout-with-chatgpt',
      },
      attempt: finished.attempt,
      message: finished.attempt.qualifying
        ? 'Qualifying game recorded.'
        : 'Game recorded.',
    });
  } catch (error) {
    return apiFailure(error);
  }
}
