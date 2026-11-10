import { useState } from "react";
import { api, setToken } from "../api";
import { Button, Field } from "../components/ui/bits";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      setToken((await api.login(email, password)).token);
      location.href = "/"; // full load so settings are fetched for the new user
    } catch (x) { setErr((x as Error).message); setBusy(false); }
  }
  return (
    <form className="card center-card" onSubmit={submit}>
      <h1 style={{ fontSize: "var(--fs-xl)" }}>Sakshi Verify</h1>
      <p className="muted" style={{ margin: 0 }}>Log in to count and compare.</p>
      <Field label="Email" htmlFor="email"><input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
      <Field label="Password" htmlFor="password"><input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
      {err && <p className="alert" role="alert">{err}</p>}
      <Button variant="primary" size="lg" type="submit" disabled={busy || !email || !password}>{busy ? "Logging in…" : "Log in"}</Button>
    </form>
  );
}
