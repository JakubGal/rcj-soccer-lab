import { requireAuthenticatedUser } from '@/lib/server/auth';
import {
  accountEnvelope,
  readCertificationState,
} from '@/lib/server/certification-store';
import { apiFailure, apiJson } from '@/lib/server/http';

export async function GET() {
  try {
    const user = await requireAuthenticatedUser();
    const [details, account] = await Promise.all([
      readCertificationState(user.id),
      accountEnvelope(user),
    ]);
    return apiJson({ ...details, state: account.certification });
  } catch (error) {
    return apiFailure(error);
  }
}
