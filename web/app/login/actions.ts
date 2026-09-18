'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { checkPassword, createSession } from '@/lib/auth';

export type LoginState = { error?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const ok = await checkPassword(String(formData.get('password') ?? ''));
  if (!ok) return { error: 'Incorrect password.' };
  const s = await createSession();
  (await cookies()).set(s.name, s.value, s.options);
  redirect('/');
}
