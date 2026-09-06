import { getChatGPTUser, type ChatGPTUser } from '@/app/chatgpt-auth';
import { ApiError } from './http';

export async function requireAuthenticatedUser(): Promise<ChatGPTUser> {
  const user = await getChatGPTUser();
  if (!user)
    throw new ApiError(
      401,
      'unauthorized',
      'Sign in with ChatGPT to save progress or certify.',
    );
  return user;
}
