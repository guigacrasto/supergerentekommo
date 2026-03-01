import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Button, Input, Card } from '@/components/ui';
import { APP_NAME, APP_SHORT_NAME } from '@/lib/constants';

export function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await api.post('/auth/register', { name, email, password });
      setSuccess(true);
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error || 'Erro ao criar conta. Tente novamente.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md p-8">
      {/* Logo */}
      <div className="mb-8 flex flex-col items-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-card bg-gradient-to-br from-primary to-accent-blue font-heading text-heading-lg text-white">
          {APP_SHORT_NAME}
        </div>
        <h1 className="font-heading text-heading-lg">{APP_NAME}</h1>
        <p className="mt-1 text-body-md text-muted">Crie sua conta</p>
      </div>

      {success ? (
        /* Pending approval state */
        <div className="flex flex-col items-center text-center py-4">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
            <CheckCircle2 className="h-8 w-8 text-success" />
          </div>
          <h2 className="font-heading text-heading-sm mb-2">
            Conta criada com sucesso!
          </h2>
          <p className="text-body-md text-muted mb-6">
            Sua conta esta aguardando aprovacao de um administrador. Voce
            recebera acesso assim que for aprovado.
          </p>
          <Link
            to="/login"
            className="font-heading font-medium text-primary hover:underline"
          >
            Voltar para o login
          </Link>
        </div>
      ) : (
        /* Register form */
        <>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Nome"
              type="text"
              placeholder="Seu nome completo"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
            />

            <Input
              label="Email"
              type="email"
              placeholder="seu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />

            <Input
              label="Senha"
              type="password"
              placeholder="Crie uma senha"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
            />

            {error && (
              <div className="rounded-button bg-danger/10 px-3 py-2 text-body-sm text-danger">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" loading={loading}>
              Criar conta
            </Button>
          </form>

          <p className="mt-6 text-center text-body-sm text-muted">
            Ja tem conta?{' '}
            <Link
              to="/login"
              className="font-medium text-primary hover:underline"
            >
              Fazer login
            </Link>
          </p>
        </>
      )}
    </Card>
  );
}
