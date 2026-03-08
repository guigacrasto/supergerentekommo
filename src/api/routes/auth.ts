import { Router } from "express";
import crypto from "crypto";
import { supabase } from "../supabase.js";
import { sendPasswordResetEmail } from "../services/email.js";
import { requireAuth, AuthRequest } from "../middleware/requireAuth.js";

export function authRouter(): Router {
  const router = Router();

  // POST /api/auth/register
  router.post("/register", async (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      res.status(400).json({ error: "Nome, email e senha são obrigatórios." });
      return;
    }

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, role: "user" },
    });

    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    // Garante que o perfil exista na tabela profiles com role/status corretos
    // Nao usa ignoreDuplicates — se trigger criou o perfil antes, o upsert atualiza
    const { error: profileError } = await supabase
      .from("profiles")
      .upsert(
        {
          id: data.user.id,
          email,
          name,
          role: "user",
          status: "pending",
        },
        { onConflict: "id" }
      );

    if (profileError) {
      console.error("[Register] Erro ao criar perfil:", profileError.message);
    }

    res.status(201).json({
      message: "Cadastro realizado. Aguarde aprovação do administrador.",
      userId: data.user.id,
    });
  });

  // POST /api/auth/login
  router.post("/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: "Email e senha são obrigatórios." });
      return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      res.status(401).json({ error: "Email ou senha incorretos." });
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("status, role, name, teams")
      .eq("id", data.user.id)
      .single();

    if (!profile || profile.status === "pending") {
      res.status(403).json({ error: "Acesso pendente de aprovação do administrador." });
      return;
    }
    if (profile.status === "denied") {
      res.status(403).json({ error: "Acesso negado pelo administrador." });
      return;
    }

    res.json({
      token: data.session.access_token,
      user: {
        id: data.user.id,
        email: data.user.email,
        name: profile.name,
        role: profile.role,
        teams: profile.teams || [],
      },
    });
  });

  // POST /api/auth/forgot-password
  router.post("/forgot-password", async (req, res) => {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ error: "Email e obrigatorio." });
      return;
    }

    // Always return 200 to avoid revealing if email exists
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, name")
        .eq("email", email)
        .single();

      if (profile) {
        const token = crypto.randomBytes(32).toString("hex");
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

        await supabase.from("password_reset_tokens").insert({
          user_id: profile.id,
          token,
          expires_at: expiresAt,
        });

        try {
          await sendPasswordResetEmail(email, token, profile.name);
        } catch (emailErr) {
          console.error("[ForgotPassword] Erro ao enviar email:", emailErr);
        }
      }
    } catch (err) {
      console.error("[ForgotPassword] Erro:", err);
    }

    res.json({ message: "Se o email estiver cadastrado, voce recebera um link de recuperacao." });
  });

  // POST /api/auth/reset-password
  router.post("/reset-password", async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) {
      res.status(400).json({ error: "Token e senha sao obrigatorios." });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ error: "A senha deve ter pelo menos 6 caracteres." });
      return;
    }

    const { data: resetToken } = await supabase
      .from("password_reset_tokens")
      .select("id, user_id, expires_at, used_at")
      .eq("token", token)
      .single();

    if (!resetToken) {
      res.status(400).json({ error: "Link invalido ou expirado." });
      return;
    }

    if (resetToken.used_at) {
      res.status(400).json({ error: "Este link ja foi utilizado." });
      return;
    }

    if (new Date(resetToken.expires_at) < new Date()) {
      res.status(400).json({ error: "Link expirado. Solicite um novo." });
      return;
    }

    const { error: updateError } = await supabase.auth.admin.updateUserById(
      resetToken.user_id,
      { password }
    );

    if (updateError) {
      res.status(500).json({ error: "Erro ao redefinir a senha." });
      return;
    }

    await supabase
      .from("password_reset_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("id", resetToken.id);

    res.json({ message: "Senha redefinida com sucesso." });
  });

  // GET /api/auth/profile (protegido)
  router.get("/profile", requireAuth, async (req: AuthRequest, res) => {
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, name, email, role, teams, phone, created_at")
      .eq("id", req.userId)
      .single();

    if (!profile) {
      res.status(404).json({ error: "Perfil nao encontrado." });
      return;
    }

    res.json(profile);
  });

  // PATCH /api/auth/profile (protegido)
  router.patch("/profile", requireAuth, async (req: AuthRequest, res) => {
    const { name, phone } = req.body;

    if (name !== undefined && !name.trim()) {
      res.status(400).json({ error: "Nome nao pode ser vazio." });
      return;
    }

    const updates: Record<string, string> = {};
    if (name !== undefined) updates.name = name.trim();
    if (phone !== undefined) updates.phone = phone.trim() || null as unknown as string;
    updates.updated_at = new Date().toISOString();

    const { error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", req.userId);

    if (error) {
      res.status(500).json({ error: "Erro ao atualizar perfil." });
      return;
    }

    res.json({ message: "Perfil atualizado com sucesso." });
  });

  // PATCH /api/auth/password (protegido)
  router.patch("/password", requireAuth, async (req: AuthRequest, res) => {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: "Senha atual e nova senha sao obrigatorias." });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({ error: "A nova senha deve ter pelo menos 6 caracteres." });
      return;
    }

    // Verify current password
    const { data: profile } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", req.userId)
      .single();

    if (!profile) {
      res.status(404).json({ error: "Perfil nao encontrado." });
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: profile.email,
      password: currentPassword,
    });

    if (signInError) {
      res.status(400).json({ error: "Senha atual incorreta." });
      return;
    }

    const { error: updateError } = await supabase.auth.admin.updateUserById(
      req.userId!,
      { password: newPassword }
    );

    if (updateError) {
      res.status(500).json({ error: "Erro ao alterar a senha." });
      return;
    }

    res.json({ message: "Senha alterada com sucesso." });
  });

  return router;
}
