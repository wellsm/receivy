"use client";

import { groupSizeLabel, type WhatsappGroup } from "@receivy/common";
import { Check, Loader2 } from "lucide-react";
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
/** Placeholder rows while the number is asked for its groups: varied widths read as real names. */
const SKELETON_WIDTHS = ["w-3/5", "w-2/5", "w-1/2", "w-2/3"];

/** The list's shape while it loads, so the wait reads as progress instead of a bare line of text. */
function GroupsSkeleton() {
  return (
    <div role="status" aria-label="Carregando grupos" className="flex flex-col gap-2">
      <p className="m-0 flex items-center gap-2 text-[13px] text-muted">
        <Loader2 size={16} aria-hidden="true" className="animate-spin text-primary-strong" />
        Buscando grupos no seu WhatsApp…
      </p>
      <ul aria-hidden="true" className="m-0 flex list-none flex-col gap-2 p-0">
        {SKELETON_WIDTHS.map((width, index) => (
          <li
            key={width}
            className="flex min-h-14 animate-pulse items-center gap-3 rounded-2xl border border-outline bg-surface px-4 py-3"
            style={{ animationDelay: `${index * 150}ms` }}
          >
            <span className="flex flex-1 flex-col gap-2">
              <span className={`h-3.5 rounded-full bg-outline ${width}`} />
              <span className="h-2.5 w-16 rounded-full bg-outline/60" />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

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
      {!groups && !error && <GroupsSkeleton />}
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
