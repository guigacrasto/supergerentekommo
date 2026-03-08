import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const from = process.env.RESEND_FROM_EMAIL || "noreply@supergerente.com.br";
const appUrl = process.env.APP_URL || "https://assistente.supergerente.com.br";
const appName = process.env.VITE_APP_NAME || "SuperGerente";

export async function sendPasswordResetEmail(
  to: string,
  token: string,
  userName: string
) {
  const resetUrl = `${appUrl}/reset-password?token=${token}`;
  await resend.emails.send({
    from: `${appName} <${from}>`,
    to,
    subject: `Recuperar senha — ${appName}`,
    html: `<div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
      <h2 style="color: #1a1a2e; margin-bottom: 16px;">Recuperar senha</h2>
      <p style="color: #333; line-height: 1.6;">Ola ${userName},</p>
      <p style="color: #333; line-height: 1.6;">Voce solicitou a recuperacao da sua senha. Clique no botao abaixo para redefinir:</p>
      <div style="text-align: center; margin: 24px 0;">
        <a href="${resetUrl}" style="display: inline-block; padding: 12px 32px; background-color: #9566F2; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600;">Redefinir senha</a>
      </div>
      <p style="color: #666; font-size: 13px; line-height: 1.5;">Ou copie e cole este link no navegador:<br/><a href="${resetUrl}" style="color: #9566F2;">${resetUrl}</a></p>
      <p style="color: #666; font-size: 13px;">Este link expira em 15 minutos.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="color: #999; font-size: 12px;">Se voce nao solicitou esta alteracao, ignore este email.</p>
    </div>`,
  });
}

export async function sendWelcomeEmail(to: string, userName: string) {
  await resend.emails.send({
    from: `${appName} <${from}>`,
    to,
    subject: `Bem-vindo ao ${appName}!`,
    html: `<div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
      <h2 style="color: #1a1a2e; margin-bottom: 16px;">Bem-vindo!</h2>
      <p style="color: #333; line-height: 1.6;">Ola ${userName},</p>
      <p style="color: #333; line-height: 1.6;">Sua conta no <strong>${appName}</strong> foi criada com sucesso.</p>
      <p style="color: #333; line-height: 1.6;">Aguarde a aprovacao do administrador para acessar o sistema.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="color: #999; font-size: 12px;">Equipe ${appName}</p>
    </div>`,
  });
}

export async function sendEmail(opts: { to: string; subject: string; html: string }) {
  await resend.emails.send({
    from: `${appName} <${from}>`,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
}

export async function sendTokenAlertEmail(
  team: string,
  errorMessage: string,
  adminEmails: string[]
) {
  if (adminEmails.length === 0) return;

  const html = `<div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
    <h2 style="color: #EF4444; margin-bottom: 16px;">⚠️ Token Kommo Expirado</h2>
    <p style="color: #333; line-height: 1.6;">O token de acesso do Kommo para o time <strong>${team}</strong> nao conseguiu renovar automaticamente apos 3 tentativas.</p>
    <p style="color: #333; line-height: 1.6;"><strong>Erro:</strong> ${errorMessage}</p>
    <p style="color: #333; line-height: 1.6;">Acesse o painel de administracao para re-autorizar a integracao com o Kommo:</p>
    <div style="text-align: center; margin: 24px 0;">
      <a href="${appUrl}/admin" style="display: inline-block; padding: 12px 32px; background-color: #EF4444; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600;">Re-autorizar Kommo</a>
    </div>
    <p style="color: #666; font-size: 13px;">Este alerta nao sera enviado novamente nas proximas 6 horas.</p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
    <p style="color: #999; font-size: 12px;">Equipe ${appName} — Sistema de Monitoramento</p>
  </div>`;

  // Sempre incluir o email do Gui como destinatário fixo
  const allRecipients = new Set(adminEmails);
  allRecipients.add("guilherme@onigroup.com.br");

  for (const email of allRecipients) {
    try {
      await resend.emails.send({
        from: `${appName} Alerta <${from}>`,
        to: email,
        subject: `[URGENTE] Token Kommo expirado — time ${team}`,
        html,
        headers: {
          "X-Priority": "1",
          "X-MSMail-Priority": "High",
          "Importance": "high",
        },
      });
      console.log(`[TokenAlert] Email enviado para ${email}`);
    } catch (e: any) {
      console.error(`[TokenAlert] Falha ao enviar email para ${email}:`, e.message);
    }
  }
}

export async function sendApprovalEmail(to: string, userName: string) {
  await resend.emails.send({
    from: `${appName} <${from}>`,
    to,
    subject: `Conta aprovada — ${appName}`,
    html: `<div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
      <h2 style="color: #1a1a2e; margin-bottom: 16px;">Conta aprovada!</h2>
      <p style="color: #333; line-height: 1.6;">Ola ${userName},</p>
      <p style="color: #333; line-height: 1.6;">Sua conta foi aprovada pelo administrador. Voce ja pode acessar o sistema:</p>
      <div style="text-align: center; margin: 24px 0;">
        <a href="${appUrl}" style="display: inline-block; padding: 12px 32px; background-color: #9566F2; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600;">Acessar ${appName}</a>
      </div>
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="color: #999; font-size: 12px;">Equipe ${appName}</p>
    </div>`,
  });
}
