import { Badge, Banner, Card, DataTable, Text } from "@shopify/polaris";
import type { ReactNode } from "react";

export function statusTone(status: string) {
  switch (status) {
    case "valid":
    case "completed":
    case "created":
    case "exists":
      return "success";
    case "pending":
    case "scanning":
    case "syncing":
    case "unchecked":
    case "skipped":
      return "attention";
    case "invalid":
    case "failed":
    case "conflict":
      return "critical";
    default:
      return "info";
  }
}

export function StatusBadge({
  status,
  children,
}: {
  status: string;
  children?: string;
}) {
  return <Badge tone={statusTone(status)}>{children ?? status}</Badge>;
}

export function SummaryTable({
  rows,
}: {
  rows: Array<[string, string | number]>;
}) {
  return (
    <DataTable
      columnContentTypes={["text", "numeric"]}
      headings={["Metric", "Count"]}
      rows={rows.map(([label, value]) => [label, String(value)])}
    />
  );
}

export function KeyValueTable({
  headings,
  rows,
}: {
  headings: string[];
  rows: ReactNode[][];
}) {
  return (
    <DataTable
      columnContentTypes={new Array(headings.length).fill("text")}
      headings={headings}
      rows={rows}
    />
  );
}

export function InfoCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <Text as="h2" variant="headingMd">
        {title}
      </Text>
      <div style={{ marginTop: 12 }}>{children}</div>
    </Card>
  );
}

export function WarningsBanner({ warnings }: { warnings: string[] }) {
  if (!warnings.length) {
    return null;
  }

  return (
    <Banner tone="warning" title="Some owner types could not be scanned">
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </Banner>
  );
}
