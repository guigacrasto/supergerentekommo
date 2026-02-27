# Auth + Admin Panel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add email/password login with admin approval flow, protect the chat, and give the admin a panel with token usage metrics.

**Architecture:** Supabase Auth handles JWT + password hashing. Backend validates JWT via Supabase service role, checks `profiles.status === 'approved'` before allowing chat. Token usage is logged per message to `token_logs` table. Frontend gains login/register/admin pages via top-level page state (no router needed).

**Tech Stack:** `@supabase/supabase-js` (backend only), Supabase Auth, PostgreSQL (Supabase), React state-based navigation.

**Supabase project:** `kppdclftyndtjutoymsu.supabase.co`
**Admin user already created:** `admin@assistentekommo.site` (ID: `2297f2e5-4dd7-42ef-b76c-a661cf89e427`)

---

### Task 1: Create Supabase schema + seed admin profile

**Files:** none (SQL run in Supabase SQL Editor)

**Step 1: Run this SQL in Supabase SQL Editor**

Go to: `https://supabase.com/dashboard/project/kppdclftyndtjutoymsu/sql/new`

Paste and run:

```sql
-- Profiles table (linked to auth.users)
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  name TEXT,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Token logs table
CREATE TABLE public.token_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  session_id TEXT,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email, role, status)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'user'),
    CASE
      WHEN COALESCE(NEW.raw_user_meta_data->>'role', 'user') = 'admin' THEN 'approved'
      ELSE 'pending'
    END
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Manually seed admin profile (already created via API)
INSERT INTO public.profiles (id, name, email, role, status)
VALUES (
  '2297f2e5-4dd7-42ef-b76c-a661cf89e427',
  'Admin',
  'admin@assistentekommo.site',
  'admin',
  'approved'
);
```

**Step 2: Verify**

Run: `SELECT * FROM public.profiles;`
Expected: 1 row — admin@assistentekommo.site, role=admin, status=approved

---

### Task 2: Install Supabase client + create supabase module

**Files:**
- Create: `src/api/supabase.ts`
- Modify: `package.json` (add dependency)

**Step 1: Install dependency**

Run: `cd /Users/guicrasto/antigravity-gui/kommo-mcp-agent && npm install @supabase/supabase-js`

**Step 2: Create `src/api/supabase.ts`**

```typescript
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!;

// Service role client — bypasses RLS, admin-level access
export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
```

**Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: zero errors

---

### Task 3: Create auth middleware

**Files:**
- Create: `src/api/middleware/requireAuth.ts`

**Step 1: Create `src/api/middleware/requireAuth.ts`**

```typescript
import { Request, Response, NextFunction } from "express";
import { supabase } from "../supabase.js";

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
}

export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    res.status(401).json({ error: "Token não fornecido." });
    return;
  }

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    res.status(401).json({ error: "Token inválido." });
    return;
  }

  // Check approval status
  const { data: profile } = await supabase
    .from("profiles")
    .select("status, role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.status !== "approved") {
    res.status(403).json({ error: "Acesso pendente de aprovação." });
    return;
  }

  req.userId = user.id;
  req.userRole = profile.role;
  next();
}

export async function requireAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  await requireAuth(req, res, async () => {
    if (req.userRole !== "admin") {
      res.status(403).json({ error: "Acesso restrito a administradores." });
      return;
    }
    next();
  });
}
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: zero errors

---

### Task 4: Create auth routes (register + login)

**Files:**
- Create: `src/api/routes/auth.ts`

**Step 1: Create `src/api/routes/auth.ts`**

```typescript
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

    // Check approval
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
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: zero errors

---

### Task 5: Create admin routes (users + token metrics)

**Files:**
- Create: `src/api/routes/admin.ts`

**Step 1: Create `src/api/routes/admin.ts`**

```typescript
import { Router } from "express";
import { supabase } from "../supabase.js";
import { requireAdmin, AuthRequest } from "../middleware/requireAuth.js";

export function adminRouter(): Router {
  const router = Router();
  router.use(requireAdmin as any);

  // GET /api/admin/users — list all non-admin users
  router.get("/users", async (_req, res) => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, name, email, status, role, created_at")
      .eq("role", "user")
      .order("created_at", { ascending: false });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json(data);
  });

  // POST /api/admin/users/:id/approve
  router.post("/users/:id/approve", async (req, res) => {
    const { error } = await supabase
      .from("profiles")
      .update({ status: "approved" })
      .eq("id", req.params.id);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ message: "Usuário aprovado." });
  });

  // POST /api/admin/users/:id/deny
  router.post("/users/:id/deny", async (req, res) => {
    const { error } = await supabase
      .from("profiles")
      .update({ status: "denied" })
      .eq("id", req.params.id);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ message: "Usuário negado." });
  });

  // GET /api/admin/tokens — token usage per user (last 30 days)
  router.get("/tokens", async (_req, res) => {
    const { data, error } = await supabase
      .from("token_logs")
      .select(`
        user_id,
        total_tokens,
        prompt_tokens,
        completion_tokens,
        created_at,
        profiles!inner(name, email)
      `)
      .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    // Aggregate per user
    const byUser: Record<string, any> = {};
    for (const row of data || []) {
      const uid = row.user_id;
      if (!byUser[uid]) {
        byUser[uid] = {
          userId: uid,
          name: (row.profiles as any).name,
          email: (row.profiles as any).email,
          totalTokens: 0,
          promptTokens: 0,
          completionTokens: 0,
          messages: 0,
          // Gemini 2.5 Flash pricing (approx): $0.075/1M input, $0.30/1M output
          estimatedCostUSD: 0,
        };
      }
      byUser[uid].totalTokens += row.total_tokens;
      byUser[uid].promptTokens += row.prompt_tokens;
      byUser[uid].completionTokens += row.completion_tokens;
      byUser[uid].messages += 1;
      byUser[uid].estimatedCostUSD +=
        (row.prompt_tokens * 0.075 + row.completion_tokens * 0.30) / 1_000_000;
    }

    const result = Object.values(byUser)
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .map((u) => ({
        ...u,
        estimatedCostUSD: `$${u.estimatedCostUSD.toFixed(4)}`,
      }));

    res.json(result);
  });

  return router;
}
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: zero errors

---

### Task 6: Update chat route — require auth + log tokens

**Files:**
- Modify: `src/api/routes/chat.ts`

**Step 1: Add auth middleware and token logging to chat route**

In `src/api/routes/chat.ts`:

1. Import at top:
```typescript
import { requireAuth, AuthRequest } from "../middleware/requireAuth.js";
import { supabase } from "../supabase.js";
```

2. After `const router = Router();`, add:
```typescript
router.use(requireAuth as any);
```

3. Change `router.post("/", async (req, res) => {` to `router.post("/", async (req: AuthRequest, res) => {`

4. After `const responseText = result.response.text();`, add token logging:
```typescript
// Log token usage
const usage = result.response.usageMetadata;
if (usage && req.userId) {
  await supabase.from("token_logs").insert({
    user_id: req.userId,
    session_id: sessionId,
    prompt_tokens: usage.promptTokenCount ?? 0,
    completion_tokens: usage.candidatesTokenCount ?? 0,
    total_tokens: usage.totalTokenCount ?? 0,
  });
}
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: zero errors

---

### Task 7: Register all new routes in server.ts

**Files:**
- Modify: `src/api/server.ts`

**Step 1: Add imports and route registration**

Add imports after existing imports:
```typescript
import { authRouter } from "./routes/auth.js";
import { adminRouter } from "./routes/admin.js";
```

Add routes before the static file serving:
```typescript
app.use("/api/auth", authRouter());
app.use("/api/admin", adminRouter());
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: zero errors

---

### Task 8: Add warm-up to index.ts (bonus — zero cost)

**Files:**
- Modify: `src/api/index.ts`

**Step 1: Trigger cache warm-up after server starts**

After `app.listen(...)`, add:
```typescript
import { getCrmMetrics } from "./cache/crm-cache.js";

app.listen(PORT, () => {
  console.log(`Web server rodando em http://localhost:${PORT}`);
  // Warm-up cache in background — no waiting
  getCrmMetrics(service).catch((e) =>
    console.error("[WarmUp] Erro ao pré-carregar cache:", e)
  );
});
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: zero errors

---

### Task 9: Update frontend — add login, register, admin pages

**Files:**
- Modify: `web/src/App.tsx`

This is the largest frontend change. Replace the entire App.tsx with the new version that includes:

**State added at top of App():**
```typescript
const [page, setPage] = useState<'login' | 'register' | 'app' | 'admin'>('login');
const [authToken, setAuthToken] = useState<string | null>(null);
const [currentUser, setCurrentUser] = useState<{ name: string; email: string; role: string } | null>(null);
```

**On mount, check localStorage for existing token:**
```typescript
useEffect(() => {
  const token = localStorage.getItem('kommo_token');
  const user = localStorage.getItem('kommo_user');
  if (token && user) {
    setAuthToken(token);
    setCurrentUser(JSON.parse(user));
    setPage('app');
    fetchPipelines(); // only after auth
  }
}, []);
```

**Login handler:**
```typescript
const handleLogin = async (email: string, password: string) => {
  try {
    const res = await axios.post('/api/auth/login', { email, password });
    const { token, user } = res.data;
    localStorage.setItem('kommo_token', token);
    localStorage.setItem('kommo_user', JSON.stringify(user));
    setAuthToken(token);
    setCurrentUser(user);
    setPage(user.role === 'admin' ? 'app' : 'app');
    fetchPipelines();
  } catch (e: any) {
    const msg = e.response?.data?.error || 'Erro ao fazer login.';
    throw new Error(msg);
  }
};
```

**Register handler:**
```typescript
const handleRegister = async (name: string, email: string, password: string) => {
  await axios.post('/api/auth/register', { name, email, password });
};
```

**Logout:**
```typescript
const handleLogout = () => {
  localStorage.removeItem('kommo_token');
  localStorage.removeItem('kommo_user');
  setAuthToken(null);
  setCurrentUser(null);
  setPage('login');
};
```

**Include token in all axios calls:**
Update every `axios.get(...)` and `axios.post(...)` to include:
```typescript
{ headers: { Authorization: `Bearer ${authToken}` } }
```

**Login page JSX** (render when `page === 'login'`):
```tsx
<div className="auth-page">
  <div className="auth-card glass">
    <div className="brand"><div className="logo">KG</div><span>Kommo Agent</span></div>
    <h2>Entrar</h2>
    <form onSubmit={async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const email = (form.elements.namedItem('email') as HTMLInputElement).value;
      const password = (form.elements.namedItem('password') as HTMLInputElement).value;
      setLoading(true);
      try { await handleLogin(email, password); }
      catch (err: any) { alert(err.message); }
      finally { setLoading(false); }
    }}>
      <input name="email" type="email" placeholder="Email" required />
      <input name="password" type="password" placeholder="Senha" required />
      <button type="submit" disabled={loading}>{loading ? 'Entrando...' : 'Entrar'}</button>
    </form>
    <p>Não tem conta? <button onClick={() => setPage('register')}>Cadastrar</button></p>
  </div>
</div>
```

**Register page JSX** (render when `page === 'register'`):
```tsx
<div className="auth-page">
  <div className="auth-card glass">
    <div className="brand"><div className="logo">KG</div><span>Kommo Agent</span></div>
    <h2>Criar conta</h2>
    <form onSubmit={async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const name = (form.elements.namedItem('name') as HTMLInputElement).value;
      const email = (form.elements.namedItem('email') as HTMLInputElement).value;
      const password = (form.elements.namedItem('password') as HTMLInputElement).value;
      setLoading(true);
      try {
        await handleRegister(name, email, password);
        alert('Cadastro realizado! Aguarde aprovação do administrador.');
        setPage('login');
      } catch (err: any) {
        alert(err.response?.data?.error || 'Erro ao cadastrar.');
      } finally { setLoading(false); }
    }}>
      <input name="name" type="text" placeholder="Seu nome" required />
      <input name="email" type="email" placeholder="Email" required />
      <input name="password" type="password" placeholder="Senha (mín. 6 caracteres)" required minLength={6} />
      <button type="submit" disabled={loading}>{loading ? 'Cadastrando...' : 'Criar conta'}</button>
    </form>
    <p>Já tem conta? <button onClick={() => setPage('login')}>Entrar</button></p>
  </div>
</div>
```

**Admin panel JSX** (only shown when `currentUser?.role === 'admin'` and `page === 'admin'`):
```tsx
// Fetched via GET /api/admin/users and GET /api/admin/tokens
// Show two tables: pending users (with approve/deny buttons) + token metrics
```

**Update sidebar** to show admin link if admin, and show logout button.

**Step 2: Verify frontend TypeScript compiles**

Run: `cd web && npx tsc --noEmit`
Expected: zero errors

---

### Task 10: Add auth CSS styles

**Files:**
- Modify: `web/src/index.css`

**Step 1: Add auth page styles at end of file**

```css
.auth-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
}

.auth-card {
  width: 100%;
  max-width: 380px;
  padding: 2.5rem;
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.auth-card h2 {
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--text);
}

.auth-card form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.auth-card input {
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 8px;
  padding: 0.75rem 1rem;
  color: var(--text);
  font-size: 0.9rem;
  outline: none;
}

.auth-card input:focus {
  border-color: var(--accent);
}

.auth-card button[type="submit"] {
  background: var(--accent);
  color: white;
  border: none;
  border-radius: 8px;
  padding: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  margin-top: 0.5rem;
}

.auth-card p {
  text-align: center;
  font-size: 0.85rem;
  color: var(--text-muted);
}

.auth-card p button {
  background: none;
  border: none;
  color: var(--accent);
  cursor: pointer;
  font-weight: 600;
}

/* Admin panel */
.admin-panel {
  padding: 2rem;
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.admin-section h2 {
  font-size: 1.1rem;
  font-weight: 700;
  margin-bottom: 1rem;
}

.status-badge {
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
}

.status-badge.pending { background: rgba(255,200,0,0.2); color: #ffd700; }
.status-badge.approved { background: rgba(0,200,100,0.2); color: #00c864; }
.status-badge.denied { background: rgba(255,60,60,0.2); color: #ff4040; }

.action-btn {
  padding: 4px 12px;
  border-radius: 6px;
  border: none;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  margin-right: 6px;
}

.action-btn.approve { background: rgba(0,200,100,0.2); color: #00c864; }
.action-btn.deny { background: rgba(255,60,60,0.2); color: #ff4040; }
```

---

### Task 11: Update environment variables and deploy

**Files:**
- Modify: `.env` (local)
- Railway vars (via API)
- Git commit + push

**Step 1: Add Supabase vars to local .env**

Add to `.env`:
```
SUPABASE_URL=https://kppdclftyndtjutoymsu.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwcGRjbGZ0eW5kdGp1dG95bXN1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjIyMjc5NCwiZXhwIjoyMDg3Nzk4Nzk0fQ.UKhmYcUPEUXbZ6W_M6_9ECjKzwtApFFO9aawzoclNxY
```

**Step 2: Add vars to Railway via API**

```bash
# SUPABASE_URL
curl -s -X POST https://backboard.railway.app/graphql/v2 \
  -H "Authorization: Bearer d09e9ab2-9436-47d7-9745-4edd4b2ca571" \
  -H "Content-Type: application/json" \
  -d '{"query": "mutation { variableUpsert(input: { projectId: \"6d34fad3-3e91-4fe0-a761-053d797ab15d\", environmentId: \"adc74e7c-ac17-4ef8-ae5b-ddf42bed97dc\", serviceId: \"5342b7c0-ce11-4cf2-b19d-0074e41fb50e\", name: \"SUPABASE_URL\", value: \"https://kppdclftyndtjutoymsu.supabase.co\" }) }"}'

# SUPABASE_SERVICE_KEY — use python3 file approach (long string)
```

**Step 3: Build and verify**

Run: `npm run build:all`
Expected: zero errors

**Step 4: Commit and push**

```bash
git add -A
git commit -m "feat: add auth + admin panel with Supabase"
git push origin main
```

Railway auto-deploys from GitHub push.

**Step 5: Verify deploy**

```bash
curl -s https://supergerentekommo-production.up.railway.app/api/auth/login \
  -X POST -H "Content-Type: application/json" \
  -d '{"email":"admin@assistentekommo.site","password":"159753acessoSuper."}'
```
Expected: `{"token":"eyJ...","user":{"role":"admin",...}}`
