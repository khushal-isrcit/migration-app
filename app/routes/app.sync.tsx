import { Banner, BlockStack, Card, Layout, Page, Text } from "@shopify/polaris";
import {
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { runDefinitionSync } from "../lib/definition-sync/sync.server";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { redirect } = await authenticate.admin(request);
  return redirect("/app");
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session, redirect } = await authenticate.admin(request);
  const result = await runDefinitionSync({
    targetShop: session.shop,
    admin,
  });

  return redirect(`/app/logs?jobId=${result.jobId}`);
}

export default function SyncDefinitionsPage() {
  return (
    <Page title="Sync definitions">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Sync route
              </Text>
              <Banner tone="info">
                <p>
                  This route runs the definition sync action and redirects to
                  the logs page.
                </p>
              </Banner>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
