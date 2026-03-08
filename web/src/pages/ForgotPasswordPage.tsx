import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { Button, Input, Card } from '@/components/ui';
import { APP_NAME } from '@/lib/constants';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch {
      setError('Erro ao enviar email. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md p-8">
      <div className="mb-8 flex flex-col items-center">
        <img src="/logo.svg" alt={APP_NAME} className="mb-4 h-14 w-14 rounded-card" />
        <h1 className="font-heading text-heading-lg">{APP_NAME}</h1>
        <p className="mt-1 text-body-md text-muted">Recuperar senha</p>
      </div>

      {sent ? (
        <div className="flex flex-col items-center text-center py-4">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Mail className="h-8 w-8 text-primary" />
          </div>
          <h2 className="font-heading text-heading-sm mb-2">Email enviado!</h2>
          <p className="text-body-md text-muted mb-6">
            Se o email estiver cadastrado, voce recebera um link para redefinir sua senha.
            Verifique sua caixa de entrada e spam.
          </p>
          <Link
            to="/login"
            className="flex items-center gap-2 font-heading font-medium text-primary hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar para o login
          </Link>
        </div>
      ) : (
        <>
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-body-sm text-muted mb-2">
              Digite seu email e enviaremos um link para redefinir sua senha.
            </p>

            <Input
              label="Email"
              type="email"
              placeholder="seu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />

            {error && (
              <div className="rounded-button bg-danger/10 px-3 py-2 text-body-sm text-danger">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" loading={loading}>
              Enviar link
            </Button>
          </form>

          <p className="mt-6 text-center text-body-sm text-muted">
            <Link
              to="/login"
              className="flex items-center justify-center gap-2 font-medium text-primary hover:underline"
            >
              <ArrowLeft className="h-4 w-4" />
              Voltar para o login
            </Link>
          </p>
        </>
      )}
    </Card>
  );
}
