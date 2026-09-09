"use client";

import { formatPhoneBR, type Person } from "@receivy/common";
import Link from "next/link";
import { useState } from "react";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { responseMessage } from "@/lib/financial-response";

const ARCHIVE_ERROR = "Não foi possível arquivar o contato.";

/** The contact data itself is edited on its own screen; here it is only shown. */
export function PersonDetails({ person, changed }: { person: Person; changed: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function archive() {
    if (!window.confirm("Arquivar este contato? O histórico será preservado.")) {
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      const response = await browserFetch(`/api/people/${person.id}/archive`, { method: "POST" });

      if (!response.ok) {
        throw new Error(await responseMessage(response, ARCHIVE_ERROR));
      }

      await changed();
      setMessage("Contato arquivado; histórico preservado.");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : ARCHIVE_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="detail-section">
      <h2>{person.displayName}</h2>
      {person.nickname && <p className="person-full-name">{person.name}</p>}
      <p>
        {person.hasAccount ? "Com conta" : "Sem conta"}
        {person.archivedAt ? " · Arquivado" : ""}
      </p>
      {person.phone && <p>{formatPhoneBR(person.phone)}</p>}
      {person.email && <p>{person.email}</p>}
      {!person.archivedAt && (
        <div className="action-row">
          <Link className="secondary-button" href={`/people/${person.id}/edit`}>
            Editar
          </Link>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => void archive()}>
            Arquivar
          </button>
          <Link className="secondary-button" href="/charges/new">
            Nova cobrança
          </Link>
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
