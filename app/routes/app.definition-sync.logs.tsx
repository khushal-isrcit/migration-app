import {
  Banner,
  BlockStack,
  Card,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";
import { useLoaderData, type LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import {
  KeyValueTable,
  StatusBadge,
  SummaryTable,
} from "../components/definition-sync";
import { getLatestSyncJob, getSyncLogs } from "../lib/definition-sync/logger.server";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");

  const job =
    (jobId
      ? await prisma.definitionSyncJob.findFirst({
          where: { id: jobId, targetShop: session.shop },
        })
      : await getLatestSyncJob(session.shop)) ?? null;

  if (!job) {
    return { job: null, logs: [] };
  }

  const logs = await getSyncLogs(job.id);

  return {
    job: {
      ...job,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    },
    logs: logs.map((log: (typeof logs)[number]) => ({
      ...log,
      createdAt: log.createdAt.toISOString(),
    })),
  };
}

export default function DefinitionSyncLogsPage() {
  const { job, logs } = useLoaderData<typeof loader>();
  const typedLogs = logs as Array<{
    id: string;
    itemType: string;
    itemKey: string;
    status: string;
    message: string;
    createdAt: string;
  }>;

  return (
    <Page title="Definition sync logs">
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {!job ? (
              <Banner tone="info">
                <p>No sync jobs are available yet.</p>
              </Banner>
            ) : (
              <>
                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">
                      Job summary
                    </Text>
                    <Text as="p">
                      Job <strong>{job.id}</strong> for {job.sourceShop} to{" "}
                      {job.targetShop}
                    </Text>
                    <StatusBadge status={job.status} />
                    {job.errorMessage ? (
                      <Banner tone="critical">
                        <p>{job.errorMessage}</p>
                      </Banner>
                    ) : null}
                    <SummaryTable
                      rows={[
                        ["Created metafield definitions", job.createdMetafieldDefinitions],
                        ["Created metaobject definitions", job.createdMetaobjectDefinitions],
                        ["Added metaobject fields", job.addedMetaobjectFields],
                        ["Conflicts", job.conflictCount],
                        ["Failures", job.failedCount],
                      ]}
                    />
                  </BlockStack>
                </Card>

                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">
                      Item logs
                    </Text>
                    {typedLogs.length ? (
                      <KeyValueTable
                        headings={["Created", "Item type", "Identifier", "Status", "Message"]}
                        rows={typedLogs.map((log) => [
                          new Date(log.createdAt).toLocaleString(),
                          log.itemType,
                          log.itemKey,
                          <StatusBadge key={`${log.id}-status`} status={log.status} />,
                          log.message,
                        ])}
                      />
                    ) : (
                      <Text as="p" tone="subdued">
                        No logs were recorded for this job.
                      </Text>
                    )}
                  </BlockStack>
                </Card>
              </>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
