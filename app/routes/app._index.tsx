import {
  Banner,
  BlockStack,
  Button,
  Card,
  Checkbox,
  FormLayout,
  InlineStack,
  Layout,
  Page,
  Spinner,
  Text,
  TextField,
} from "@shopify/polaris";
import { useEffect, useState } from "react";
import {
  useFetcher,
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import prisma from "../db.server";
import {
  InfoCard,
  KeyValueTable,
  StatusBadge,
  SummaryTable,
  WarningsBanner,
} from "../components/definition-sync";
import {
  decryptToken,
  encryptToken,
} from "../lib/definition-sync/encryption.server";
import { getLatestSyncJob, getSyncLogs } from "../lib/definition-sync/logger.server";
import { buildDefinitionScanPreview, runDefinitionSync } from "../lib/definition-sync/sync.server";
import { validateSourceToken } from "../lib/definition-sync/source-admin.server";
import {
  normalizeShopDomain,
  validateShopDomain,
} from "../lib/definition-sync/shop-domain.server";
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

  let preview = null;
  let scanError = null;

  if (credential?.tokenStatus === "valid") {
    try {
      preview = await buildDefinitionScanPreview({
        sourceShop: credential.sourceShop,
        sourceToken: decryptToken(credential.encryptedToken),
        targetShop: session.shop,
        admin,
      });
    } catch (error) {
      scanError =
        error instanceof Error ? error.message : "Failed to scan definitions.";
    }
  }

  const logs = latestJob ? await getSyncLogs(latestJob.id) : [];

  return {
    shop: payload.data.shop,
    credential: credential
      ? {
          sourceShop: credential.sourceShop,
          tokenStatus: credential.tokenStatus,
          lastValidatedAt: credential.lastValidatedAt?.toISOString() ?? null,
        }
      : null,
    preview,
    scanError,
    latestJob: latestJob
      ? {
          id: latestJob.id,
          status: latestJob.status,
          sourceShop: latestJob.sourceShop,
          targetShop: latestJob.targetShop,
          createdAt: latestJob.createdAt.toISOString(),
          updatedAt: latestJob.updatedAt.toISOString(),
          createdMetafieldDefinitions: latestJob.createdMetafieldDefinitions,
          createdMetaobjectDefinitions: latestJob.createdMetaobjectDefinitions,
          addedMetaobjectFields: latestJob.addedMetaobjectFields,
          conflictCount: latestJob.conflictCount,
          failedCount: latestJob.failedCount,
          errorMessage: latestJob.errorMessage,
        }
      : null,
    latestLogs: logs.map((log) => ({
      ...log,
      createdAt: log.createdAt.toISOString(),
    })),
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "save");

  if (intent === "remove") {
    await prisma.sourceStoreCredential.deleteMany({
      where: { targetShop: session.shop },
    });

    return {
      ok: true,
      intent,
      message: "Source credentials removed.",
    };
  }

  if (intent === "sync") {
    const selectedMetaobjectTypes = JSON.parse(
      String(formData.get("selectedMetaobjectTypes") || "[]"),
    ) as string[];
    const selectedMetafieldKeys = JSON.parse(
      String(formData.get("selectedMetafieldKeys") || "[]"),
    ) as string[];

    if (!selectedMetaobjectTypes.length && !selectedMetafieldKeys.length) {
      return {
        ok: false,
        intent,
        error: "Select at least one metaobject or metafield to sync.",
      };
    }

    const result = await runDefinitionSync({
      targetShop: session.shop,
      admin,
      selectedMetaobjectTypes,
      selectedMetafieldKeys,
    });

    return {
      ok: true,
      intent,
      message: "Sync completed.",
      jobId: result.jobId,
    };
  }

  const sourceShopInput = String(formData.get("sourceShop") || "");
  const token = String(formData.get("sourceToken") || "");
  const normalizedShop = normalizeShopDomain(sourceShopInput);
  const domainError = validateShopDomain(sourceShopInput);

  if (domainError) {
    return {
      ok: false,
      intent,
      error: domainError,
      fieldErrors: { sourceShop: domainError },
    };
  }

  if (!token.trim()) {
    return {
      ok: false,
      intent,
      error: "Source Admin API access token is required.",
      fieldErrors: { sourceToken: "Source Admin API access token is required." },
    };
  }

  try {
    const validation = await validateSourceToken(normalizedShop, token);

    await prisma.sourceStoreCredential.upsert({
      where: { targetShop: session.shop },
      update: {
        sourceShop: validation.sourceShop,
        encryptedToken: encryptToken(token),
        tokenStatus: "valid",
        lastValidatedAt: new Date(),
      },
      create: {
        targetShop: session.shop,
        sourceShop: validation.sourceShop,
        encryptedToken: encryptToken(token),
        tokenStatus: "valid",
        lastValidatedAt: new Date(),
      },
    });

    return {
      ok: true,
      intent,
      message: `Connected to ${validation.shopName} (${validation.sourceShop}).`,
    };
  } catch (error) {
    await prisma.sourceStoreCredential.upsert({
      where: { targetShop: session.shop },
      update: {
        sourceShop: normalizedShop,
        encryptedToken: encryptToken(token),
        tokenStatus: "invalid",
        lastValidatedAt: new Date(),
      },
      create: {
        targetShop: session.shop,
        sourceShop: normalizedShop,
        encryptedToken: encryptToken(token),
        tokenStatus: "invalid",
        lastValidatedAt: new Date(),
      },
    });

    return {
      ok: false,
      intent,
      error:
        error instanceof Error
          ? error.message
          : "Failed to validate the source connection.",
    };
  }
}

export default function DefinitionSyncSinglePage() {
  const { shop, credential, preview, scanError, latestJob, latestLogs } =
    useLoaderData<typeof loader>();
  const connectionFetcher = useFetcher<typeof action>();
  const syncFetcher = useFetcher<typeof action>();
  const actionData = (
    syncFetcher.data?.intent === "sync" ? syncFetcher.data : connectionFetcher.data
  ) as
    | {
        ok: boolean;
        intent: string;
        message?: string;
        error?: string;
        fieldErrors?: {
          sourceShop?: string;
          sourceToken?: string;
        };
      }
    | undefined;
  const [sourceShop, setSourceShop] = useState(credential?.sourceShop ?? "");
  const [sourceToken, setSourceToken] = useState("");
  const [selectedMetaobjectTypes, setSelectedMetaobjectTypes] = useState<string[]>(
    [],
  );
  const [selectedMetafieldKeys, setSelectedMetafieldKeys] = useState<string[]>([]);
  const [logsPage, setLogsPage] = useState(1);
  const isSaving = connectionFetcher.state !== "idle";
  const isSyncing = syncFetcher.state !== "idle";

  useEffect(() => {
    setSelectedMetaobjectTypes([]);
    setSelectedMetafieldKeys([]);
  }, [preview]);

  useEffect(() => {
    setLogsPage(1);
  }, [latestJob?.id]);

  function handleSave() {
    connectionFetcher.submit(
      {
        intent: "save",
        sourceShop,
        sourceToken,
      },
      { method: "post" },
    );
  }

  function handleRemove() {
    connectionFetcher.submit(
      {
        intent: "remove",
      },
      { method: "post" },
    );
  }

  function handleSync() {
    const formData = new FormData();
    formData.set("intent", "sync");
    formData.set(
      "selectedMetaobjectTypes",
      JSON.stringify(selectedMetaobjectTypes),
    );
    formData.set("selectedMetafieldKeys", JSON.stringify(selectedMetafieldKeys));

    syncFetcher.submit(
      formData,
      { method: "post" },
    );
  }

  function toggleMetaobjectSelection(type: string) {
    setSelectedMetaobjectTypes((current) =>
      current.includes(type)
        ? current.filter((value) => value !== type)
        : [...current, type],
    );
  }

  function toggleMetafieldSelection(identifier: string) {
    setSelectedMetafieldKeys((current) =>
      current.includes(identifier)
        ? current.filter((value) => value !== identifier)
        : [...current, identifier],
    );
  }

  const typedLogs = latestLogs as Array<{
    id: string;
    itemType: string;
    itemKey: string;
    status: string;
    message: string;
    createdAt: string;
  }>;
  const missingMetaobjects = preview?.metaobjects.missing ?? [];
  const missingMetafields = preview?.metafields.missing ?? [];
  const metaobjectAllSelected =
    missingMetaobjects.length > 0 &&
    selectedMetaobjectTypes.length === missingMetaobjects.length;
  const metafieldAllSelected =
    missingMetafields.length > 0 &&
    selectedMetafieldKeys.length === missingMetafields.length;
  const totalSelectedCount =
    selectedMetaobjectTypes.length + selectedMetafieldKeys.length;
  const metafieldNameByIdentifier = new Map<string, string>();
  const metaobjectNameByType = new Map<string, string>();
  const metaobjectFieldNameByIdentifier = new Map<string, string>();

  if (preview) {
    for (const definition of [
      ...preview.metafields.missing,
      ...preview.metafields.existing,
      ...preview.metafields.conflicts.map((item) => item.source),
    ]) {
      metafieldNameByIdentifier.set(
        `${definition.ownerType}:${definition.namespace}:${definition.key}`,
        definition.name,
      );
    }

    for (const definition of [
      ...preview.metaobjects.missing,
      ...preview.metaobjects.existing.map((item) => item.source),
      ...preview.metaobjects.conflicts.map((item) => item.source),
    ]) {
      metaobjectNameByType.set(definition.type, definition.name);

      for (const field of definition.fieldDefinitions) {
        metaobjectFieldNameByIdentifier.set(
          `${definition.type}.${field.key}`,
          `${definition.name} - ${field.name}`,
        );
      }
    }
  }

  const paginatedLogs = typedLogs.slice((logsPage - 1) * 10, logsPage * 10);
  const totalLogPages = Math.max(1, Math.ceil(typedLogs.length / 10));

  function displayItemType(itemType: string) {
    return itemType === "metafield_definition" ? "Metafield" : "Metaobject";
  }

  function displayIdentifier(log: (typeof typedLogs)[number]) {
    if (log.itemKey === "scope-warning") {
      return "Warning";
    }

    if (log.itemType === "metafield_definition") {
      return metafieldNameByIdentifier.get(log.itemKey) ?? log.itemKey;
    }

    if (log.itemType === "metaobject_field") {
      return metaobjectFieldNameByIdentifier.get(log.itemKey) ?? log.itemKey;
    }

    return metaobjectNameByType.get(log.itemKey) ?? log.itemKey;
  }

  return (
    <Page title="Definition Sync">
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Banner tone="info">
              <p>
                Connect the source store, review the missing metaobjects and
                metafields below, then sync everything from this page.
              </p>
            </Banner>

            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Source store connection
                  </Text>
                  <Text as="span" variant="bodyMd" fontWeight="medium">
                    {shop.name} ({shop.myshopifyDomain})
                  </Text>
                </InlineStack>

                {credential ? (
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span">Saved source: {credential.sourceShop}</Text>
                    <StatusBadge status={credential.tokenStatus} />
                  </InlineStack>
                ) : null}

                {credential?.lastValidatedAt ? (
                  <Text as="p" tone="subdued">
                    Last validated:{" "}
                    {new Date(credential.lastValidatedAt).toLocaleString()}
                  </Text>
                ) : null}

                {actionData?.message ? (
                  <Banner tone={actionData.ok ? "success" : "critical"}>
                    <p>{actionData.message ?? actionData.error}</p>
                  </Banner>
                ) : null}

                {actionData?.error && !actionData.message ? (
                  <Banner tone="critical">
                    <p>{actionData.error}</p>
                  </Banner>
                ) : null}

                <FormLayout>
                  <TextField
                    label="Source store domain"
                    autoComplete="off"
                    value={sourceShop}
                    onChange={setSourceShop}
                    helpText="Example: source-store.myshopify.com"
                    error={connectionFetcher.data?.fieldErrors?.sourceShop}
                  />
                  <TextField
                    label="Source Admin API access token"
                    autoComplete="off"
                    type="password"
                    value={sourceToken}
                    onChange={setSourceToken}
                    helpText="Create a custom app in the source store and paste its Admin API token here."
                    error={connectionFetcher.data?.fieldErrors?.sourceToken}
                  />
                </FormLayout>

                <InlineStack gap="200">
                  <Button
                    variant="primary"
                    loading={isSaving}
                    onClick={handleSave}
                    disabled={isSyncing}
                  >
                    {credential ? "Update and validate" : "Save and validate"}
                  </Button>
                  {credential ? (
                    <Button
                      tone="critical"
                      loading={isSaving}
                      onClick={handleRemove}
                      disabled={isSyncing}
                    >
                      Remove source
                    </Button>
                  ) : null}
                </InlineStack>
              </BlockStack>
            </Card>

            {credential?.tokenStatus === "valid" ? (
              <>
                {scanError ? (
                  <Banner tone="critical" title="Scan failed">
                    <p>{scanError}</p>
                  </Banner>
                ) : null}

                {preview ? (
                  <>
                    <WarningsBanner warnings={preview.ownerTypeWarnings} />

                    <InfoCard title="Ready To Sync">
                      <SummaryTable
                        rows={[
                          ["Missing metafield definitions", preview.summary.missingMetafieldDefinitions],
                          ["Existing metafield definitions", preview.summary.existingMetafieldDefinitions],
                          ["Conflicting metafield definitions", preview.summary.conflictingMetafieldDefinitions],
                          ["Missing metaobject definitions", preview.summary.missingMetaobjectDefinitions],
                          ["Existing metaobject definitions", preview.summary.existingMetaobjectDefinitions],
                          ["Missing metaobject fields", preview.summary.missingMetaobjectFields],
                          ["Conflicting metaobject fields", preview.summary.conflictingMetaobjectFields],
                        ]}
                      />
                    </InfoCard>

                    <Card>
                      <BlockStack gap="300">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="h2" variant="headingMd">
                            Missing Metaobjects
                          </Text>
                          <InlineStack gap="200">
                            <Button
                              onClick={() =>
                                setSelectedMetaobjectTypes(
                                  metaobjectAllSelected
                                    ? []
                                    : missingMetaobjects.map((item) => item.type),
                                )
                              }
                              disabled={!missingMetaobjects.length || isSyncing}
                            >
                              {metaobjectAllSelected ? "Clear all" : "Select all"}
                            </Button>
                            <Button
                              variant="primary"
                              onClick={handleSync}
                              loading={isSyncing}
                              disabled={isSaving || totalSelectedCount === 0}
                            >
                              Sync Selected
                            </Button>
                          </InlineStack>
                        </InlineStack>

                        {isSyncing ? (
                          <InlineStack gap="200" blockAlign="center">
                            <Spinner size="small" />
                            <Text as="span">
                              Syncing metaobjects and metafields. Please wait.
                            </Text>
                          </InlineStack>
                        ) : null}

                        {preview.metaobjects.missing.length ? (
                          <BlockStack gap="200">
                            {preview.metaobjects.missing.map((item) => (
                              <InlineStack
                                key={item.type}
                                align="space-between"
                                blockAlign="center"
                              >
                                <BlockStack gap="100">
                                  <Text as="span" variant="bodyMd" fontWeight="medium">
                                    {item.name}
                                  </Text>
                                  <Text as="span" tone="subdued">
                                    Type: {item.type}
                                  </Text>
                                </BlockStack>
                                <Checkbox
                                  label=""
                                  checked={selectedMetaobjectTypes.includes(item.type)}
                                  onChange={() => toggleMetaobjectSelection(item.type)}
                                />
                              </InlineStack>
                            ))}
                          </BlockStack>
                        ) : (
                          <Text as="p" tone="subdued">
                            No missing metaobject definitions were found.
                          </Text>
                        )}
                      </BlockStack>
                    </Card>

                    <Card>
                      <BlockStack gap="300">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="h2" variant="headingMd">
                            Missing Metafields
                          </Text>
                          <Button
                            onClick={() =>
                              setSelectedMetafieldKeys(
                                metafieldAllSelected
                                  ? []
                                  : missingMetafields.map(
                                      (item) =>
                                        `${item.ownerType}:${item.namespace}:${item.key}`,
                                    ),
                              )
                            }
                            disabled={!missingMetafields.length || isSyncing}
                          >
                            {metafieldAllSelected ? "Clear all" : "Select all"}
                          </Button>
                        </InlineStack>
                        {preview.metafields.missing.length ? (
                          <BlockStack gap="200">
                            {preview.metafields.missing.map((item) => {
                              const identifier = `${item.ownerType}:${item.namespace}:${item.key}`;

                              return (
                                <InlineStack
                                  key={identifier}
                                  align="space-between"
                                  blockAlign="center"
                                >
                                  <BlockStack gap="100">
                                    <Text as="span" variant="bodyMd" fontWeight="medium">
                                      {item.name}
                                    </Text>
                                    <Text as="span" tone="subdued">
                                      {item.ownerType} | {item.namespace} | {item.type}
                                    </Text>
                                  </BlockStack>
                                  <Checkbox
                                    label=""
                                    checked={selectedMetafieldKeys.includes(identifier)}
                                    onChange={() => toggleMetafieldSelection(identifier)}
                                  />
                                </InlineStack>
                              );
                            })}
                          </BlockStack>
                        ) : (
                          <Text as="p" tone="subdued">
                            No missing metafield definitions were found.
                          </Text>
                        )}
                      </BlockStack>
                    </Card>
                  </>
                ) : null}
              </>
            ) : (
              <Banner tone="warning">
                <p>
                  Save a valid source store domain and Admin API token to load
                  the metaobject and metafield preview.
                </p>
              </Banner>
            )}

            {credential?.tokenStatus === "valid" && latestJob ? (
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Latest Sync Result
                  </Text>
                  <InlineStack gap="200" blockAlign="center">
                    <StatusBadge status={latestJob.status} />
                    <Text as="span">
                      {latestJob.sourceShop} to {latestJob.targetShop}
                    </Text>
                  </InlineStack>
                  {latestJob.errorMessage ? (
                    <Banner tone="critical">
                      <p>{latestJob.errorMessage}</p>
                    </Banner>
                  ) : null}
                  <SummaryTable
                    rows={[
                      ["Created metafield definitions", latestJob.createdMetafieldDefinitions],
                      ["Created metaobject definitions", latestJob.createdMetaobjectDefinitions],
                      ["Added metaobject fields", latestJob.addedMetaobjectFields],
                      ["Warnings and conflicts", latestJob.conflictCount],
                      ["Failures", latestJob.failedCount],
                    ]}
                  />

                  {typedLogs.length ? (
                    <BlockStack gap="300">
                      <KeyValueTable
                        headings={["Status", "Item", "Identifier", "Message"]}
                        rows={paginatedLogs.map((log) => [
                          <StatusBadge key={`${log.id}-status`} status={log.status} />,
                          displayItemType(log.itemType),
                          displayIdentifier(log),
                          log.message,
                        ])}
                      />
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="span" tone="subdued">
                          Page {logsPage} of {totalLogPages}
                        </Text>
                        <InlineStack gap="200">
                          <Button
                            onClick={() => setLogsPage((page) => Math.max(1, page - 1))}
                            disabled={logsPage === 1}
                          >
                            Previous
                          </Button>
                          <Button
                            onClick={() =>
                              setLogsPage((page) => Math.min(totalLogPages, page + 1))
                            }
                            disabled={logsPage === totalLogPages}
                          >
                            Next
                          </Button>
                        </InlineStack>
                      </InlineStack>
                    </BlockStack>
                  ) : (
                    <Text as="p" tone="subdued">
                      No sync messages are available yet.
                    </Text>
                  )}
                </BlockStack>
              </Card>
            ) : null}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
