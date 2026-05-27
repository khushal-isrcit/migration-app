import {
  Banner,
  BlockStack,
  Button,
  Card,
  FormLayout,
  InlineStack,
  Layout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { useState } from "react";
import {
  useFetcher,
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import prisma from "../db.server";
import { StatusBadge } from "../components/definition-sync";
import { encryptToken } from "../lib/definition-sync/encryption.server";
import { validateSourceToken } from "../lib/definition-sync/source-admin.server";
import {
  normalizeShopDomain,
  validateShopDomain,
} from "../lib/definition-sync/shop-domain.server";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const credential = await prisma.sourceStoreCredential.findUnique({
    where: { targetShop: session.shop },
  });

  return {
    credential: credential
      ? {
          sourceShop: credential.sourceShop,
          tokenStatus: credential.tokenStatus,
          lastValidatedAt: credential.lastValidatedAt?.toISOString() ?? null,
        }
      : null,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "save");

  if (intent === "remove") {
    await prisma.sourceStoreCredential.deleteMany({
      where: { targetShop: session.shop },
    });

    return {
      ok: true,
      removed: true,
      message: "Source credentials removed.",
    };
  }

  const sourceShopInput = String(formData.get("sourceShop") || "");
  const token = String(formData.get("sourceToken") || "");
  const normalizedShop = normalizeShopDomain(sourceShopInput);
  const domainError = validateShopDomain(sourceShopInput);

  if (domainError) {
    return {
      ok: false,
      error: domainError,
      fieldErrors: { sourceShop: domainError },
    };
  }

  if (!token.trim()) {
    return {
      ok: false,
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
      message: `Connected to ${validation.shopName} (${validation.sourceShop}).`,
      validation,
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
      error:
        error instanceof Error
          ? error.message
          : "Failed to validate the source connection.",
    };
  }
}

export default function SourceCredentialPage() {
  const { credential } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const actionData = fetcher.data as
    | {
        ok: boolean;
        removed?: boolean;
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
  const isSubmitting = fetcher.state !== "idle";

  function handleSave() {
    fetcher.submit(
      {
        intent: "save",
        sourceShop,
        sourceToken,
      },
      { method: "post" },
    );
  }

  function handleRemove() {
    fetcher.submit(
      {
        intent: "remove",
      },
      { method: "post" },
    );
  }

  return (
    <Page title="Source store credentials">
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Source store connection
                </Text>
                <Text as="p" tone="subdued">
                  Enter the source store .myshopify.com domain and a custom app
                  Admin API access token. The token is used only on the server,
                  encrypted at rest, and never shown again after save.
                </Text>

                {credential ? (
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span">Saved source: {credential.sourceShop}</Text>
                    <StatusBadge status={credential.tokenStatus} />
                  </InlineStack>
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

                <BlockStack gap="300">
                  <FormLayout>
                    <TextField
                      label="Source store domain"
                      autoComplete="off"
                      value={sourceShop}
                      onChange={setSourceShop}
                      helpText="Example: source-store.myshopify.com"
                      error={actionData?.fieldErrors?.sourceShop}
                    />
                    <TextField
                      label="Source Admin API access token"
                      autoComplete="off"
                      type="password"
                      value={sourceToken}
                      onChange={setSourceToken}
                      helpText="Create a custom app in the source store and paste its Admin API token here."
                      error={actionData?.fieldErrors?.sourceToken}
                    />
                  </FormLayout>

                  <InlineStack gap="200">
                    <Button
                      variant="primary"
                      loading={isSubmitting}
                      onClick={handleSave}
                    >
                      Save and validate
                    </Button>
                  </InlineStack>
                </BlockStack>

                {credential ? (
                  <Button
                    tone="critical"
                    loading={isSubmitting}
                    onClick={handleRemove}
                  >
                    Remove saved source credentials
                  </Button>
                ) : null}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
