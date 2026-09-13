import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import type {
  ApplicationStatus,
  ClauseOutcome,
  ClauseResultKind,
  UpstreamCallOutcome,
} from "@/api";

type Tone = NonNullable<BadgeProps["tone"]>;

const STATUS_TONE: Record<string, Tone> = {
  APPROVED: "green",
  REVIEW: "amber",
  REJECTED: "red",
  FAILED: "grey",
  PROCESSING: "blue",
};

export function StatusBadge({
  status,
  size,
}: {
  status: ApplicationStatus | string;
  size?: BadgeProps["size"];
}) {
  const tone = STATUS_TONE[status] ?? "neutral";
  return (
    <Badge tone={tone} size={size}>
      {status === "PROCESSING" ? <Spinner /> : null}
      {status}
    </Badge>
  );
}

const RESULT_TONE: Record<ClauseResultKind, Tone> = {
  PASS: "green",
  FAIL: "red",
  UNDETERMINED: "amber",
  NOT_APPLICABLE: "grey",
};

export function ResultBadge({ result }: { result: ClauseResultKind | string }) {
  const tone = RESULT_TONE[result as ClauseResultKind] ?? "neutral";
  return <Badge tone={tone}>{result}</Badge>;
}

const CLAUSE_OUTCOME_TONE: Record<ClauseOutcome, Tone> = {
  APPROVE: "green",
  REVIEW: "amber",
  REJECT: "red",
};

export function ClauseOutcomeBadge({ outcome }: { outcome: ClauseOutcome | string }) {
  const tone = CLAUSE_OUTCOME_TONE[outcome as ClauseOutcome] ?? "neutral";
  return (
    <Badge tone={tone} className="bg-transparent">
      {outcome}
    </Badge>
  );
}

const UPSTREAM_TONE: Record<UpstreamCallOutcome, Tone> = {
  SUCCESS: "green",
  TIMEOUT: "amber",
  RATE_LIMITED: "amber",
  HTTP_5XX: "red",
  HTTP_4XX: "red",
  CONN_RESET: "red",
  CIRCUIT_OPEN: "violet",
};

export function UpstreamOutcomeBadge({ outcome }: { outcome: UpstreamCallOutcome | string }) {
  const tone = UPSTREAM_TONE[outcome as UpstreamCallOutcome] ?? "neutral";
  return <Badge tone={tone}>{outcome}</Badge>;
}

export function CircuitBadge({ circuit }: { circuit: string }) {
  const tone: Tone =
    circuit === "CLOSED" ? "green" : circuit === "OPEN" ? "red" : "amber";
  return <Badge tone={tone}>{circuit}</Badge>;
}
