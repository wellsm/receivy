"use client";
import { useState } from "react";
export function PublicPixCopy({ pixKey, timeoutMs = 2_000 }: { pixKey: string; timeoutMs?: number }) {
  const [notice, setNotice] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  function legacyCopy(): boolean {
    if (typeof document.execCommand !== "function") return false;
    const input = document.createElement("textarea"); input.value = pixKey; input.readOnly = true;
    input.style.position = "fixed"; input.style.opacity = "0"; document.body.append(input); input.select();
    try { return document.execCommand("copy"); } catch { return false; } finally { input.remove(); }
  }
  async function copy() {
    setBusy(true); setNotice(""); setError("");
    try {
      if (!legacyCopy()) {
        if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
        await Promise.race([navigator.clipboard.writeText(pixKey), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("clipboard timeout")), timeoutMs))]);
      }
      setNotice("Chave Pix copiada.");
    } catch { setError("Não foi possível copiar. Selecione a chave e copie manualmente."); }
    finally { setBusy(false); }
  }
  return <><button className="secondary-button" type="button" disabled={busy} aria-label={busy ? "Copiando chave Pix" : "Copiar chave Pix"} onClick={() => void copy()}>{busy ? "Copiando…" : "Copiar chave Pix"}</button>{notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}</>;
}
