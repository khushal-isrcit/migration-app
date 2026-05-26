import {
  Banner,
  BlockStack,
  Button,
  Card,
  Divider,
  InlineStack,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";
import {
  Form,
  useSubmit,
  useLoaderData,
  type LoaderFunctionArgs,
} from "react-router";
import prisma from "../db.server";
import {
  InfoCard,
  KeyValueTable,
  SummaryTable,
  WarningsBanner,
} from "../components/definition-sync";
import { decryptToken } from "../lib/definition-sync/encryption.server";
import { buildDefinitionScanPreview } from "../lib/definition-sync/sync.server";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session, redirect } = await authenticate.admin(request);
  const credential = await prisma.sourceStoreCredential.findUnique({
    where: { targetShop: session.shop },
  });

  if (!credential) {
    return redirect("/app/definition-sync/source");
  }

  try {
    const preview = await buildDefinitionScanPreview({
      sourceShop: credential.sourceShop,
      sourceToken: decryptToken(credential.encryptedToken),
      targetShop: session.shop,
      admin,
    });

    return {
      preview,
      scanError: null,
    };
  } catch (error) {
    return {
      preview: null,
      scanError:
        error instanceof Error ? error.message : "Failed to scan definitions.",
    };
  }
}

export default function ScanDefinitionsPage() {
  const { preview, scanError } = useLoaderData<typeof loader>();
  const submit = useSubmit();

  return (
    <Page title="Scan and preview definitions">
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {scanError ? (
              <Banner tone="critical" title="Scan failed">
                <p>{scanError}</p>
              </Banner>
            ) : null}

            {preview ? (
              <>
                <WarningsBanner warnings={preview.ownerTypeWarnings} />

                <InfoCard title="Summary">
                  <SummaryTable
                    rows={[
                      [
                        "Total source metafield definitions",
                        preview.summary.totalSourceMetafieldDefinitions,
                      ],
                      [
                        "Total target metafield definitions",
                        preview.summary.totalTargetMetafieldDefinitions,
                      ],
                      [
                        "Missing metafield definitions",
                        preview.summary.missingMetafieldDefinitions,
                      ],
                      [
                        "Existing metafield definitions",
                        preview.summary.existingMetafieldDefinitions,
                      ],
                      [
                        "Conflicting metafield definitions",
                        preview.summary.conflictingMetafieldDefinitions,
                      ],
                      [
                        "Total source metaobject definitions",
                        preview.summary.totalSourceMetaobjectDefinitions,
                      ],
                      [
                        "Total target metaobject definitions",
                        preview.summary.totalTargetMetaobjectDefinitions,
                      ],
                      [
                        "Missing metaobject definitions",
                        preview.summary.missingMetaobjectDefinitions,
                      ],
                      [
                        "Existing metaobject definitions",
                        preview.summary.existingMetaobjectDefinitions,
                      ],
                      [
                        "Missing metaobject fields",
                        preview.summary.missingMetaobjectFields,
                      ],
                      [
                        "Conflicting metaobject fields",
                        preview.summary.conflictingMetaobjectFields,
                      ],
                    ]}
                  />
                </InfoCard>

                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">
                      Missing metafield definitions
                    </Text>
                    {preview.metafields.missing.length ? (
                      <KeyValueTable
                        headings={["Owner type", "Namespace", "Key", "Type"]}
                        rows={preview.metafields.missing.map((item) => [
                          item.ownerType,
                          item.namespace,
                          item.key,
                          item.type,
                        ])}
                      />
                    ) : (
                      <Text as="p" tone="subdued">
                        No missing metafield definitions were found.
                      </Text>
                    )}
                  </BlockStack>
                </Card>

                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">
                      Conflicting metafield definitions
                    </Text>
                    {preview.metafields.conflicts.length ? (
                      <KeyValueTable
                        headings={["Identifier", "Source type", "Target type"]}
                        rows={preview.metafields.conflicts.map((item) => [
                          item.key,
                          item.source.type,
                          item.target.type,
                        ])}
                      />
                    ) : (
                      <Text as="p" tone="subdued">
                        No metafield type conflicts were found.
                      </Text>
                    )}
                  </BlockStack>
                </Card>

                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">
                      Metaobject definitions
                    </Text>

                    <Text as="h3" variant="headingSm">
                      Missing definitions
                    </Text>
                    {preview.metaobjects.missing.length ? (
                      <KeyValueTable
                        headings={["Type", "Name", "Fields"]}
                        rows={preview.metaobjects.missing.map((item) => [
                          item.type,
                          item.name,
                          String(item.fieldDefinitions.length),
                        ])}
                      />
                    ) : (
                      <Text as="p" tone="subdued">
                        No missing metaobject definitions were found.
                      </Text>
                    )}

                    <Divider />

                    <Text as="h3" variant="headingSm">
                      Existing definitions with missing fields
                    </Text>
                    {preview.metaobjects.existing.some(
                      (item) => item.missingFields.length > 0,
                    ) ? (
                      <KeyValueTable
                        headings={["Type", "Missing field keys", "Conflict count"]}
                        rows={preview.metaobjects.existing
                          .filter((item) => item.missingFields.length > 0)
                          .map((item) => [
                            item.type,
                            item.missingFields.map((field) => field.key).join(", "),
                            String(item.fieldConflicts.length),
                          ])}
                      />
                    ) : (
                      <Text as="p" tone="subdued">
                        No missing fields were found on existing target
                        metaobject definitions.
                      </Text>
                    )}

                    <Divider />

                    <Text as="h3" variant="headingSm">
                      Metaobject field conflicts
                    </Text>
                    {preview.metaobjects.conflicts.length ? (
                      <KeyValueTable
                        headings={["Metaobject type", "Field key", "Source type", "Target type"]}
                        rows={preview.metaobjects.conflicts.flatMap((item) =>
                          item.fieldConflicts.map((conflict) => [
                            item.type,
                            conflict.source.key,
                            conflict.source.type,
                            conflict.target.type,
                          ]),
                        )}
                      />
                    ) : (
                      <Text as="p" tone="subdued">
                        No metaobject field conflicts were found.
                      </Text>
                    )}
                  </BlockStack>
                </Card>

                <Card>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h2" variant="headingMd">
                        Ready to sync
                      </Text>
                      <Form
                        method="post"
                        action="/app/definition-sync/sync"
                        onSubmit={(event) => {
                          event.preventDefault();
                          submit(event.currentTarget, { method: "post" });
                        }}
                      >
                        <Button variant="primary" submit>
                          Sync Missing Definitions
                        </Button>
                      </Form>
                    </InlineStack>
                    <Text as="p" tone="subdued">
                      The sync will create only missing metafield definitions,
                      create only missing metaobject definitions, add only
                      missing metaobject fields, skip conflicts, never overwrite
                      existing definitions, and log every action.
                    </Text>
                  </BlockStack>
                </Card>
              </>
            ) : null}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
