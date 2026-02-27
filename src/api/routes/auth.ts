import { Router } from "express";
import { supabase } from "../supabase.js";

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
      .select("status, role, name")
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
      user: { id: data.user.id, email: data.user.email, name: profile.name, role: profile.role },
    });
  });

  return router;
}
