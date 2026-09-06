import { isCertificationMode } from '@/lib/certification/policy';
import { requireAuthenticatedUser } from '@/lib/server/auth';
import { startGameAttempt } from '@/lib/server/certification-store';
import { ApiError, apiFailure, apiJson, readJsonBody } from '@/lib/server/http';

export async function POST(request: Request) {
  try {
    const user = await requireAuthenticatedUser();
    const value = await readJsonBody(request, 16_384);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new ApiError(400, 'invalid_game', 'The game request is invalid.');
    const body = value as Record<string, unknown>;
    if (!isCertificationMode(body.mode))
      throw new ApiError(
        400,
        'invalid_mode',
        'Mode must be step or continuous.',
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
    const purpose = body.purpose === 'practice' ? 'practice' : 'certification';
    if (purpose === 'certification' && typeof body.roundId !== 'string')
      throw new ApiError(
        400,
        'round_required',
        'roundId is required for certification games.',
      );
    if (
      body.durationSeconds !== undefined &&
      typeof body.durationSeconds !== 'number'
    )
      throw new ApiError(
        400,
        'invalid_duration',
        'durationSeconds must be a number.',
      );
    if (purpose === 'practice' && body.roundId !== undefined)
      throw new ApiError(
        400,
        'unexpected_round',
        'Practice games do not belong to a certification round.',
      );
    if (
      body.roundId !== undefined &&
      (typeof body.roundId !== 'string' || body.roundId.length > 64)
    )
      throw new ApiError(400, 'invalid_round', 'roundId is invalid.');
    const durationSeconds =
      purpose === 'practice' && typeof body.durationSeconds === 'number'
        ? body.durationSeconds
        : undefined;
    const clientSessionId = body.clientSessionId;
    if (
      clientSessionId !== undefined &&
      (typeof clientSessionId !== 'string' ||
        clientSessionId.length < 1 ||
        clientSessionId.length > 128)
    )
      throw new ApiError(
        400,
        'invalid_client_session',
        'clientSessionId is invalid.',
      );
    const launch = await startGameAttempt(
      user,
      body.mode,
      purpose,
      durationSeconds,
      typeof body.roundId === 'string' ? body.roundId : undefined,
    );
    const attempt = launch.attempt;
    return apiJson({
      attemptId: attempt.id,
      roundId: attempt.roundId ?? '',
      mode: attempt.mode,
      purpose: attempt.purpose,
      seed: attempt.seed,
      durationSeconds: attempt.durationSeconds,
      topics: attempt.topics,
      startedAt: attempt.startedAt,
      policyVersion: attempt.policyVersion,
      engineVersion: attempt.engineVersion,
      clientSessionId: clientSessionId ?? null,
      attempt,
    });
  } catch (error) {
    return apiFailure(error);
  }
}
