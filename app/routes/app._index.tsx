import {
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";
import {
  Link,
  useLoaderData,
  useNavigate,
  type LoaderFunctionArgs,
} from "react-router";
import prisma from "../db.server";
import { StatusBadge } from "../components/definition-sync";
import { getLatestSyncJob } from "../lib/definition-sync/logger.server";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const credential = await prisma.sourceStoreCredential.findUnique({
    where: { targetShop: session.shop },
  });
  const latestJob = await getLatestSyncJob(session.shop);

  const response = await admin.graphql(`#graphql
    query DefinitionSyncDashboardShop {
      shop {
        name
        myshopifyDomain
      }
    }
  `);
  const payload = await response.json();

  return {
    shop: payload.data.shop,
    credential: credential
      ? {
          sourceShop: credential.sourceShop,
          tokenStatus: credential.tokenStatus,
          lastValidatedAt: credential.lastValidatedAt?.toISOString() ?? null,
        }
      : null,
    latestJob: latestJob
      ? {
          id: latestJob.id,
          status: latestJob.status,
          createdAt: latestJob.createdAt.toISOString(),
        }
      : null,
  };
}

export default function DefinitionSyncDashboard() {
  const { shop, credential, latestJob } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <Page title="Definition Sync Dashboard">
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Banner tone="info">
              <p>
                Sync only metafield and metaobject definitions from a source
                store to this target store. This app does not migrate values or
                entries.
              </p>
            </Banner>

            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Store connections
                  </Text>
                  <Button onClick={() => navigate("/app/source")}>
                    {credential ? "Update source token" : "Add source token"}
                  </Button>
                </InlineStack>

                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" variant="bodyMd">
                    Target store
                  </Text>
                  <Text as="span" variant="bodyMd" fontWeight="medium">
                    {shop.name} ({shop.myshopifyDomain})
                  </Text>
                </InlineStack>

                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" variant="bodyMd">
                    Source connection
                  </Text>
                  {credential ? (
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span">{credential.sourceShop}</Text>
                      <StatusBadge status={credential.tokenStatus} />
                    </InlineStack>
                  ) : (
                    <StatusBadge status="unchecked">Not connected</StatusBadge>
                  )}
                </InlineStack>

                {credential?.lastValidatedAt ? (
                  <Text as="p" tone="subdued">
                    Last validated:{" "}
                    {new Date(credential.lastValidatedAt).toLocaleString()}
                  </Text>
                ) : null}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Scan and sync
                  </Text>
                  <InlineStack gap="200">
                    <Button
                      variant="primary"
                      onClick={() => navigate("/app/scan")}
                      disabled={!credential}
                    >
                      Scan definitions
                    </Button>
                    <Button onClick={() => navigate("/app/logs")}>
                      View logs
                    </Button>
                  </InlineStack>
                </InlineStack>

                {!credential ? (
                  <Banner tone="warning">
                    <p>
                      Add and validate the source store domain and Admin API
                      token before scanning definitions.
                    </p>
                  </Banner>
                ) : null}

                {latestJob ? (
                  <Text as="p">
                    Latest sync job:{" "}
                    <Link to={`/app/logs?jobId=${latestJob.id}`}>
                      {latestJob.id}
                    </Link>{" "}
                    with status <StatusBadge status={latestJob.status} />.
                  </Text>
                ) : (
                  <Text as="p" tone="subdued">
                    No sync jobs have been run yet.
                  </Text>
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
