import LoginForm from './LoginForm';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-2xl font-bold tracking-tight">LOG</h1>
      <p className="mt-1 text-sm text-muted">Personal watch tracker</p>
      <LoginForm />
    </main>
  );
}
