import { requireAuthenticatedUser } from '@/lib/server/auth';
import {
  accountEnvelope,
  recordRuleAnswer,
} from '@/lib/server/certification-store';
import { ApiError, apiFailure, apiJson, readJsonBody } from '@/lib/server/http';

export async function POST(request: Request) {
  try {
    const user = await requireAuthenticatedUser();
    const value = await readJsonBody(request, 16_384);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new ApiError(
        400,
        'invalid_rule_answer',
        'The rule answer is invalid.',
      );
    const body = value as Record<string, unknown>;
    if (typeof body.questionId !== 'string' || body.questionId.length > 160)
      throw new ApiError(
        400,
        'invalid_question',
        'A valid questionId is required.',
      );
    if (
      body.purpose !== undefined &&
      body.purpose !== 'practice' &&
      body.purpose !== 'certification'
    )
      throw new ApiError(
        400,
        'invalid_purpose',
        'Purpose must be practice or certification.',
      );
    for (const key of ['assisted', 'completed', 'correct'] as const)
      if (body[key] !== undefined && typeof body[key] !== 'boolean')
        throw new ApiError(
          400,
          'invalid_rule_answer',
          `${key} must be true or false.`,
        );
    if (
      body.roundId !== undefined &&
      (typeof body.roundId !== 'string' || body.roundId.length > 64)
    )
      throw new ApiError(400, 'invalid_round', 'roundId is invalid.');
    const purpose =
      body.purpose === 'certification' ||
      (body.purpose !== 'practice' && typeof body.roundId === 'string')
        ? 'certification'
        : 'practice';
    if (purpose === 'certification' && typeof body.roundId !== 'string')
      throw new ApiError(
        400,
        'round_required',
        'roundId is required for certification answers.',
      );
    const answer =
      body.answer ??
      body.answerId ??
      body.choiceId ??
      body.optionIndex ??
      body.calls;
    const stored = await recordRuleAnswer(user, {
      questionId: body.questionId,
      answer,
      assisted: body.assisted === true,
      completed:
        body.completed === undefined
          ? purpose === 'certification' || body.correct === true
          : body.completed === true,
      purpose,
      roundId: typeof body.roundId === 'string' ? body.roundId : undefined,
      reportedCorrect:
        typeof body.correct === 'boolean' ? body.correct : undefined,
    });
    if (purpose === 'practice') return apiJson(stored);
    return apiJson({
      ...(await accountEnvelope(user)),
      links: {
        signIn: '/signin-with-chatgpt',
        signOut: '/signout-with-chatgpt',
      },
      ruleResult: stored.result,
      message: stored.result.firstCorrect
        ? 'First-try answer recorded.'
        : 'Answer recorded.',
    });
  } catch (error) {
    return apiFailure(error);
  }
}
