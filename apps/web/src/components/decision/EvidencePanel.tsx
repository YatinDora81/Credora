import { FileSearch, ShieldAlert, TriangleAlert } from "lucide-react";
import { CONCERN_LABEL, EXTRACTION_REASON_LABEL, SOURCE_LABEL, fieldLabel, label } from "@/lib/labels";
import type { ApplicationDetail, ConcernView } from "@/api";
import { Banner, Quote, SectionHeading, realQuote } from "./shared";

export function EvidencePanel({ detail }: { detail: ApplicationDetail }) {
  const x = detail.extraction;
  const failed = detail.status === "FAILED";
  const fields = x?.fields ?? [];
  const ungrounded = x?.ungrounded ?? [];
  const concerns = x?.concerns ?? [];

  return (
    <div className="space-y-6">
      {concerns.length > 0 ? (
        <section className="space-y-2">
          <SectionHeading meta="Surfaced for a reviewer. No clause scores these.">Concerns</SectionHeading>
          <ul className="divide-y divide-line rounded border">
            {concerns.map((c, i) => (
              <ConcernRow key={`${c.code}-${i}`} concern={c} />
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-2">
        <SectionHeading
          meta={
            x?.available
              ? [x.model, x.cached ? "served from cache" : null].filter(Boolean).join(" · ")
              : undefined
          }
        >
          Extracted from the note and document
        </SectionHeading>

        {!x || (failed && !x.available && !x.reason) ? (
          <p className="text-13 text-subtle">No extraction was recorded for this application.</p>
        ) : !x.available ? (
          <Banner
            tone="review"
            icon={<FileSearch className="h-3.5 w-3.5" strokeWidth={2} />}
            title={`Extraction unavailable: ${label(EXTRACTION_REASON_LABEL, x.reason) || "reason not recorded"}`}
          >
            <p>
              Clauses that needed an extracted fact are undetermined, not failed. The model never
              decides the outcome either way.
            </p>
          </Banner>
        ) : fields.length === 0 ? (
          <p className="text-13 text-subtle">
            Extraction ran and found nothing to ground in the note or the document. No facts were
            invented.
          </p>
        ) : (
          <dl className="divide-y divide-line rounded border">
            {fields.map((f, i) => {
              const quote = realQuote(f.provenance?.quote);
              return (
              <div
                key={`${f.name}-${i}`}
                className="grid gap-x-4 gap-y-0.5 px-3 py-2.5 sm:grid-cols-[10rem_minmax(0,1fr)]"
              >
                <dt className="text-12 font-medium text-subtle">{fieldLabel(f.name)}</dt>
                <dd className="min-w-0">
                  <p className="break-words text-13 text-fg">{f.value}</p>
                  {quote ? (
                    <p className="mt-0.5 text-12 text-faint">
                      <Quote>{quote}</Quote>
                      {f.provenance?.source ? ` — ${label(SOURCE_LABEL, f.provenance.source)}` : ""}
                    </p>
                  ) : null}
                </dd>
              </div>
              );
            })}
          </dl>
        )}
      </section>

      {ungrounded.length > 0 ? (
        <section className="space-y-2">
          <SectionHeading meta="The model asserted these, but the quote is not in the source.">
            Discarded
          </SectionHeading>
          <ul className="divide-y divide-line rounded border">
            {ungrounded.map((u, i) => (
              <li key={`${u.name}-${i}`} className="px-3 py-2.5 text-13">
                <p className="text-faint">
                  <span className="line-through">
                    {fieldLabel(u.name)}: {u.value}
                  </span>
                </p>
                <p className="mt-0.5 text-12 text-subtle">
                  {realQuote(u.quote) ? (
                    <>
                      Claimed quote <Quote>{u.quote}</Quote> could not be matched to the source, so it
                      never reached the policy.
                    </>
                  ) : (
                    "No supporting quote was given, so it never reached the policy."
                  )}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function ConcernRow({ concern: c }: { concern: ConcernView }) {
  const injection = c.code === "PROMPT_INJECTION_ATTEMPT";
  return (
    <li className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-2.5 px-3 py-2.5">
      <span className="flex h-5 items-center">
        {injection ? (
          <ShieldAlert className="h-3.5 w-3.5 text-reject" strokeWidth={2} aria-hidden />
        ) : (
          <TriangleAlert className="h-3.5 w-3.5 text-review" strokeWidth={2} aria-hidden />
        )}
      </span>
      <div className="min-w-0 space-y-0.5 text-13">
        <p className="font-medium text-fg" title={c.code}>
          {label(CONCERN_LABEL, c.code)}
        </p>
        {c.detail ? <p className="text-subtle">{c.detail}</p> : null}
        {realQuote(c.quote) ? (
          <p className="break-words text-12 text-faint">
            <Quote>{c.quote}</Quote>
          </p>
        ) : null}
      </div>
    </li>
  );
}
