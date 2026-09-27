"use client";

import { groupSizeLabel, type WhatsappGroup } from "@receivy/common";
import { Check } from "lucide-react";
import { useEffect, useState, type RefObject } from "react";
import { BillingDialog } from "@/components/app/billing-dialog";

type WhatsappGroupDialogProps = {
  /** The billing's participants: the groups holding all of them come first. */
  participants: string[];
  selected: string | null;
  load: (participants: string[]) => Promise<WhatsappGroup[]>;
  returnFocusTo?: RefObject<HTMLButtonElement | null>;
  onPick: (group: WhatsappGroup) => void;
  onClose: () => void;
};

const LOAD_ERROR = "Não foi possível carregar os grupos.";

/** The groups of the owner's connected number, searchable, the suggested ones on top. */
export function WhatsappGroupDialog({ participants, selected, load, returnFocusTo, onPick, onClose }: WhatsappGroupDialogProps) {
  const [groups, setGroups] = useState<WhatsappGroup[] | null>(null);
  const [error, setError] = useState("");
  const [term, setTerm] = useState("");
  const key = participants.join(",");

  useEffect(() => {
    let live = true;

    load(key ? key.split(",") : [])
      .then((found) => {
        if (live) {
          setGroups(found);
        }
      })
      .catch((reason: unknown) => {
        if (live) {
          setError(reason instanceof Error ? reason.message : LOAD_ERROR);
        }
      });

    return () => {
      live = false;
    };
  }, [key, load]);

  const needle = term.trim().toLocaleLowerCase("pt-BR");
  const visible = (groups ?? []).filter((group) => !needle || group.name.toLocaleLowerCase("pt-BR").includes(needle));

  return (
    <BillingDialog title="Avisar no grupo" doneLabel="" returnFocusTo={returnFocusTo} onClose={onClose}>
      <input
        aria-label="Buscar grupos"
        placeholder="Buscar grupo…"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        className="min-h-12 w-full rounded-xl border border-outline bg-surface px-4 text-ink"
      />
      {error && (
        <p role="alert" className="m-0 rounded-xl bg-danger-soft p-4 text-danger">
          {error}
        </p>
      )}
      {!groups && !error && (
        <p role="status" className="m-0 text-sm text-muted">
          Carregando grupos…
        </p>
      )}
      {groups && !visible.length && <p className="m-0 py-6 text-center text-muted">Nenhum grupo encontrado.</p>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {visible.map((group) => {
          const active = group.jid === selected;

          return (
            <li key={group.jid}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => onPick(group)}
                className={`flex min-h-14 w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left ${active ? "border-primary bg-primary-soft/40" : "border-outline bg-surface"}`}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[14px] font-bold text-ink">{group.name}</span>
                  <span className="text-[11.5px] text-muted">{groupSizeLabel(group.size)}</span>
                </span>
                {group.suggested && <span className="rounded-full bg-success-soft px-2 py-0.5 text-[10.5px] font-bold text-success">Sugerido</span>}
                {active && <Check size={18} aria-hidden="true" className="text-primary-strong" />}
              </button>
            </li>
          );
        })}
      </ul>
    </BillingDialog>
  );
}
