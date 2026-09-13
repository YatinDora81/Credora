import { Fragment } from "react";
import { ResultGlyph } from "@/components/ui/status";
import { CLAUSE_OUTCOME_LABEL, RESULT_LABEL, label } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { Reason } from "@/api";
import { Collapsible, sortBySeverity } from "./shared";

export function ClausesPanel({ reasons, deciding }: { reasons: Reason[]; deciding: Set<string> }) {
  if (reasons.length === 0) {
    return <p className="text-13 text-subtle">No clause results were recorded for this application.</p>;
  }

  const sorted = sortBySeverity(reasons);
  const attention = sorted.filter((r) => r.result === "FAIL" || r.result === "UNDETERMINED");
  const passed = sorted.filter((r) => r.result === "PASS");
  const notApplicable = sorted.filter((r) => r.result === "NOT_APPLICABLE");

  return (
    <div className="space-y-4">
      {attention.length > 0 ? (
        <ul className="divide-y divide-line rounded border">
          {attention.map((r) => (
            <ClauseRow key={r.clause_id} reason={r} deciding={deciding.has(r.clause_id)} />
          ))}
        </ul>
      ) : passed.length === 0 ? (
        <p className="text-13 text-subtle">No clause failed or went undetermined.</p>
      ) : null}

      {passed.length > 0 ? (
        <Collapsible
          defaultOpen={attention.length === 0}
          summary={
            <span>
              {passed.length} clause{passed.length === 1 ? "" : "s"} passed
            </span>
          }
        >
          <ul className="mt-1 divide-y divide-line rounded border">
            {passed.map((r) => (
              <ClauseRow key={r.clause_id} reason={r} deciding={false} quiet />
            ))}
          </ul>
        </Collapsible>
      ) : null}

      {notApplicable.length > 0 ? (
        <Collapsible
          defaultOpen={attention.length === 0 && passed.length === 0}
          summary={<span>{notApplicable.length} not applicable</span>}
        >
          <ul className="mt-1 divide-y divide-line rounded border">
            {notApplicable.map((r) => (
              <ClauseRow key={r.clause_id} reason={r} deciding={false} quiet />
            ))}
          </ul>
        </Collapsible>
      ) : null}
    </div>
  );
}

function ClauseRow({ reason: r, deciding, quiet = false }: { reason: Reason; deciding: boolean; quiet?: boolean }) {
  const outcomeColor =
    !deciding ? "text-faint" : r.outcome === "REJECT" ? "text-reject" : "text-review";
  return (
    <li className="grid grid-cols-[16px_2.25rem_minmax(0,1fr)] gap-x-2.5 px-3 py-3 sm:grid-cols-[16px_2.25rem_minmax(0,1fr)_auto]">
      <span className="flex h-5 items-center">
        <ResultGlyph result={r.result} />
      </span>
      <span className="font-mono text-13 font-medium text-fg">{r.clause_id}</span>
      <div className="min-w-0 space-y-1">
        <p className={cn("text-13", quiet ? "text-subtle" : "text-fg")}>{r.clause_text}</p>
        <p className="text-13 text-subtle">
          <span className="sr-only">{label(RESULT_LABEL, r.result)}: </span>
          {r.explanation}
        </p>
        {r.missing_inputs?.length ? (
          <p className="text-12 text-review">
            Missing: <span className="font-mono">{r.missing_inputs.join(", ")}</span>
          </p>
        ) : null}
        {r.evidence_refs?.length ? (
          <p className="flex flex-wrap gap-x-3 font-mono text-12 text-faint">
            {r.evidence_refs.map((ref, i) => (
              <span key={i} className="min-w-0 break-words">
                {ref.split(/(?<=[.:_])/).map((seg, j) => (
                  <Fragment key={j}>
                    {j > 0 ? <wbr /> : null}
                    {seg}
                  </Fragment>
                ))}
              </span>
            ))}
          </p>
        ) : null}
      </div>
      {r.outcome !== "APPROVE" || deciding ? (
        <span
          className={cn(
            "col-start-3 mt-1 whitespace-nowrap text-12 sm:col-start-auto sm:mt-0 sm:text-right",
            outcomeColor,
            deciding && "font-medium",
          )}
        >
          → {label(CLAUSE_OUTCOME_LABEL, r.outcome)}
        </span>
      ) : null}
    </li>
  );
}
