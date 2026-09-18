'use client';

import { useActionState } from 'react';
import { login, type LoginState } from './actions';

const initial: LoginState = {};

export default function LoginForm() {
  const [state, action, pending] = useActionState(login, initial);
  return (
    <form action={action} className="mt-6">
      <input type="password" name="password" autoFocus placeholder="Password"
        autoComplete="current-password"
        className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm
                   outline-none placeholder:text-muted focus:border-accent" />
      {state.error && <p className="mt-2 text-sm text-red-500">{state.error}</p>}
      <button type="submit" disabled={pending}
        className="mt-3 w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold
                   text-white disabled:opacity-60">
        {pending ? 'Checking…' : 'Sign in'}
      </button>
    </form>
  );
}
