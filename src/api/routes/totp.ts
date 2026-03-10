import { Router, Response } from "express";
import { supabase } from "../supabase.js";
import { requireAuth, AuthRequest } from "../middleware/requireAuth.js";
import {
  generateTotpSecret,
  generateTotpUri,
  generateQRCodeDataUrl,
  verifyTotpCode,
  encryptSecret,
  decryptSecret,
  generateBackupCodes,
  hashBackupCode,
  verifyBackupCode,
  validateChallengeToken,
  markChallengeUsed,
  recordChallengeAttempt,
  clearChallengeAttempts,
} from "../services/totp.js";

export function totpRouter(): Router {
  const router = Router();

  // POST /api/auth/2fa/setup — gerar secret + QR code
  router.post("/setup", requireAuth as any, async (req: AuthRequest, res: Response) => {
    const userId = req.userId!;

    // Checar se ja tem 2FA ativo
    const { data: profile } = await supabase
      .from("profiles")
      .select("totp_enabled, email")
      .eq("id", userId)
      .single();

    if (!profile) {
      res.status(404).json({ error: "Perfil nao encontrado." });
      return;
    }

    if (profile.totp_enabled) {
      res.status(400).json({ error: "2FA ja esta ativo. Desative primeiro para reconfigurar." });
      return;
    }

    const secret = generateTotpSecret();
    const otpAuthUri = generateTotpUri(secret, profile.email);
    const qrCode = await generateQRCodeDataUrl(otpAuthUri);

    // Salvar secret encriptado (ainda nao ativado)
    const encrypted = encryptSecret(secret);
    await supabase
      .from("profiles")
      .update({ totp_secret_encrypted: encrypted })
      .eq("id", userId);

    res.json({ qrCode, secret, otpAuthUri });
  });

  // POST /api/auth/2fa/verify-setup — confirmar setup com codigo
  router.post("/verify-setup", requireAuth as any, async (req: AuthRequest, res: Response) => {
    const userId = req.userId!;
    const { code } = req.body;

    if (!code || typeof code !== "string" || code.length !== 6) {
      res.status(400).json({ error: "Codigo de 6 digitos obrigatorio." });
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("totp_secret_encrypted, totp_enabled")
      .eq("id", userId)
      .single();

    if (!profile || !profile.totp_secret_encrypted) {
      res.status(400).json({ error: "Execute o setup primeiro." });
      return;
    }

    if (profile.totp_enabled) {
      res.status(400).json({ error: "2FA ja esta ativo." });
      return;
    }

    const secret = decryptSecret(profile.totp_secret_encrypted);
    if (!verifyTotpCode(secret, code)) {
      res.status(400).json({ error: "Codigo invalido. Tente novamente." });
      return;
    }

    // Gerar backup codes
    const plainCodes = generateBackupCodes();
    const hashedCodes = plainCodes.map(hashBackupCode);

    await supabase
      .from("profiles")
      .update({
        totp_enabled: true,
        totp_backup_codes: hashedCodes,
        totp_verified_at: new Date().toISOString(),
      })
      .eq("id", userId);

    res.json({
      message: "2FA ativado com sucesso.",
      backupCodes: plainCodes,
    });
  });

  // POST /api/auth/2fa/verify — verificar codigo no login (usa challengeToken)
  router.post("/verify", async (req, res) => {
    const { challengeToken, code } = req.body;

    if (!challengeToken || !code) {
      res.status(400).json({ error: "Challenge token e codigo sao obrigatorios." });
      return;
    }

    // Verificar limite de tentativas
    if (!recordChallengeAttempt(challengeToken)) {
      res.status(429).json({ error: "Muitas tentativas. Faca login novamente." });
      return;
    }

    const challenge = await validateChallengeToken(challengeToken);
    if (!challenge) {
      res.status(400).json({ error: "Challenge expirado ou invalido. Faca login novamente." });
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("totp_secret_encrypted, totp_backup_codes, totp_enabled, name, email, role, teams")
      .eq("id", challenge.userId)
      .single();

    if (!profile || !profile.totp_enabled || !profile.totp_secret_encrypted) {
      res.status(400).json({ error: "2FA nao configurado." });
      return;
    }

    const secret = decryptSecret(profile.totp_secret_encrypted);
    let isBackupCode = false;

    // Tentar TOTP primeiro
    let valid = verifyTotpCode(secret, code);

    // Se nao for TOTP, tentar backup code
    if (!valid && profile.totp_backup_codes) {
      for (let i = 0; i < profile.totp_backup_codes.length; i++) {
        if (verifyBackupCode(code, profile.totp_backup_codes[i])) {
          valid = true;
          isBackupCode = true;
          // Remover backup code usado
          const updatedCodes = [...profile.totp_backup_codes];
          updatedCodes.splice(i, 1);
          await supabase
            .from("profiles")
            .update({ totp_backup_codes: updatedCodes })
            .eq("id", challenge.userId);
          break;
        }
      }
    }

    if (!valid) {
      res.status(400).json({ error: "Codigo invalido." });
      return;
    }

    // Marcar challenge como usado
    await markChallengeUsed(challengeToken);
    clearChallengeAttempts(challengeToken);

    // Gerar sessao Supabase via admin (o user ja autenticou com senha)
    // Usamos signInWithPassword nao funciona aqui, entao geramos token admin
    const { data: authData, error: authError } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: profile.email,
    });

    // Gerar token via admin createUser session workaround
    // Na verdade, a melhor approach e gerar um novo signIn
    // Mas como ja validamos senha+2FA, usamos admin.generateLink + extraimos o token
    // O generateLink retorna hashed_token que podemos usar

    // Abordagem simplificada: usar supabase admin para criar session
    const { data: sessionData, error: sessionError } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: profile.email,
    });

    if (sessionError || !sessionData) {
      res.status(500).json({ error: "Erro ao criar sessao." });
      return;
    }

    // Verificar o magic link para obter a sessao
    const token_hash = sessionData.properties?.hashed_token;
    if (!token_hash) {
      res.status(500).json({ error: "Erro ao gerar token de sessao." });
      return;
    }

    const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
      token_hash,
      type: "magiclink",
    });

    if (verifyError || !verifyData.session) {
      res.status(500).json({ error: "Erro ao verificar sessao." });
      return;
    }

    res.json({
      token: verifyData.session.access_token,
      user: {
        id: challenge.userId,
        email: profile.email,
        name: profile.name,
        role: profile.role,
        teams: profile.teams || [],
        tenantId: null,
        tenant: null,
      },
      ...(isBackupCode ? { warning: "Backup code usado. Restam " + ((profile.totp_backup_codes?.length || 1) - 1) + " codigos." } : {}),
    });
  });

  // POST /api/auth/2fa/disable — desativar 2FA
  router.post("/disable", requireAuth as any, async (req: AuthRequest, res: Response) => {
    const userId = req.userId!;
    const userRole = req.userRole;
    const { password, code } = req.body;

    // Admin/superadmin nao pode desativar 2FA
    if (userRole === "admin" || userRole === "superadmin") {
      res.status(403).json({ error: "Administradores nao podem desativar 2FA." });
      return;
    }

    if (!password || !code) {
      res.status(400).json({ error: "Senha e codigo sao obrigatorios." });
      return;
    }

    // Verificar senha
    const { data: profile } = await supabase
      .from("profiles")
      .select("email, totp_secret_encrypted, totp_enabled")
      .eq("id", userId)
      .single();

    if (!profile || !profile.totp_enabled) {
      res.status(400).json({ error: "2FA nao esta ativo." });
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: profile.email,
      password,
    });

    if (signInError) {
      res.status(400).json({ error: "Senha incorreta." });
      return;
    }

    // Verificar codigo TOTP
    const secret = decryptSecret(profile.totp_secret_encrypted!);
    if (!verifyTotpCode(secret, code)) {
      res.status(400).json({ error: "Codigo invalido." });
      return;
    }

    await supabase
      .from("profiles")
      .update({
        totp_enabled: false,
        totp_secret_encrypted: null,
        totp_backup_codes: null,
        totp_verified_at: null,
      })
      .eq("id", userId);

    res.json({ message: "2FA desativado com sucesso." });
  });

  // GET /api/auth/2fa/status — checar se 2FA esta ativo
  router.get("/status", requireAuth as any, async (req: AuthRequest, res: Response) => {
    const { data: profile } = await supabase
      .from("profiles")
      .select("totp_enabled, totp_verified_at, totp_backup_codes")
      .eq("id", req.userId!)
      .single();

    if (!profile) {
      res.status(404).json({ error: "Perfil nao encontrado." });
      return;
    }

    res.json({
      enabled: profile.totp_enabled,
      verifiedAt: profile.totp_verified_at,
      backupCodesRemaining: profile.totp_backup_codes?.length || 0,
    });
  });

  // POST /api/auth/2fa/backup-codes — regenerar backup codes
  router.post("/backup-codes", requireAuth as any, async (req: AuthRequest, res: Response) => {
    const userId = req.userId!;
    const { code } = req.body;

    if (!code) {
      res.status(400).json({ error: "Codigo TOTP obrigatorio para regenerar backup codes." });
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("totp_secret_encrypted, totp_enabled")
      .eq("id", userId)
      .single();

    if (!profile || !profile.totp_enabled || !profile.totp_secret_encrypted) {
      res.status(400).json({ error: "2FA nao esta ativo." });
      return;
    }

    const secret = decryptSecret(profile.totp_secret_encrypted);
    if (!verifyTotpCode(secret, code)) {
      res.status(400).json({ error: "Codigo invalido." });
      return;
    }

    const plainCodes = generateBackupCodes();
    const hashedCodes = plainCodes.map(hashBackupCode);

    await supabase
      .from("profiles")
      .update({ totp_backup_codes: hashedCodes })
      .eq("id", userId);

    res.json({ backupCodes: plainCodes });
  });

  return router;
}
