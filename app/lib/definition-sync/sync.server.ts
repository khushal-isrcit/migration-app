import prisma from "../../db.server";
import {
  compareMetafieldDefinitions,
  compareMetaobjectDefinitions,
} from "./compare.server";
import { decryptToken } from "./encryption.server";
import {
  createSyncJob,
  createSyncLog,
  updateSyncJob,
} from "./logger.server";
import {
  createMetafieldDefinition,
  fetchMetafieldDefinitions,
} from "./metafield-definitions.server";
import {
  addMissingMetaobjectFields,
  createMetaobjectDefinition,
  fetchMetaobjectDefinitions,
} from "./metaobject-definitions.server";
import type { DefinitionScanPreview } from "./types.server";

type AdminGraphqlClient = Parameters<typeof fetchMetafieldDefinitions>[0]["admin"];

export async function buildDefinitionScanPreview({
  sourceShop,
  sourceToken,
  targetShop,
  admin,
}: {
  sourceShop: string;
  sourceToken: string;
  targetShop: string;
  admin: NonNullable<AdminGraphqlClient>;
}): Promise<DefinitionScanPreview> {
  const [
    sourceMetafields,
    targetMetafields,
    sourceMetaobjects,
    targetMetaobjects,
  ] = await Promise.all([
    fetchMetafieldDefinitions({ source: { shop: sourceShop, token: sourceToken } }),
    fetchMetafieldDefinitions({ admin }),
    fetchMetaobjectDefinitions({ source: { shop: sourceShop, token: sourceToken } }),
    fetchMetaobjectDefinitions({ admin }),
  ]);

  const sourceAccessibleOwnerTypes = new Set(
    sourceMetafields.ownerTypeAccess
      .filter((item) => item.accessible)
      .map((item) => item.ownerType),
  );
  const targetAccessibleOwnerTypes = new Set(
    targetMetafields.ownerTypeAccess
      .filter((item) => item.accessible)
      .map((item) => item.ownerType),
  );

  const comparableSourceMetafields = sourceMetafields.definitions.filter((definition) =>
    targetAccessibleOwnerTypes.has(definition.ownerType),
  );
  const comparableTargetMetafields = targetMetafields.definitions.filter((definition) =>
    sourceAccessibleOwnerTypes.has(definition.ownerType),
  );

  const metafieldComparison = compareMetafieldDefinitions(
    comparableSourceMetafields,
    comparableTargetMetafields,
  );
  const metaobjectComparison = compareMetaobjectDefinitions(
    sourceMetaobjects.definitions,
    targetMetaobjects.definitions,
  );

  const ownerTypeWarnings = [
    ...sourceMetafields.ownerTypeAccess
      .filter((item) => !item.accessible)
      .map(
        (item) =>
          `Source token can't read ${item.ownerType} metafield definitions with the current source custom-app scopes.`,
      ),
    ...targetMetafields.ownerTypeAccess
      .filter((item) => !item.accessible)
      .map(
        (item) =>
          `Target app can't read or write ${item.ownerType} metafield definitions with the current installed app scopes.`,
      ),
  ];

  return {
    sourceShop,
    targetShop,
    summary: {
      totalSourceMetafieldDefinitions: comparableSourceMetafields.length,
      totalTargetMetafieldDefinitions: comparableTargetMetafields.length,
      missingMetafieldDefinitions: metafieldComparison.missing.length,
      existingMetafieldDefinitions: metafieldComparison.existing.length,
      conflictingMetafieldDefinitions: metafieldComparison.conflicts.length,
      totalSourceMetaobjectDefinitions: sourceMetaobjects.definitions.length,
      totalTargetMetaobjectDefinitions: targetMetaobjects.definitions.length,
      missingMetaobjectDefinitions: metaobjectComparison.missing.length,
      existingMetaobjectDefinitions: metaobjectComparison.existing.length,
      missingMetaobjectFields: metaobjectComparison.existing.reduce(
        (total, item) => total + item.missingFields.length,
        0,
      ),
      conflictingMetaobjectFields: metaobjectComparison.existing.reduce(
        (total, item) => total + item.fieldConflicts.length,
        0,
      ),
    },
    metafields: metafieldComparison,
    metaobjects: metaobjectComparison,
    ownerTypeWarnings,
  };
}

export async function runDefinitionSync({
  targetShop,
  admin,
}: {
  targetShop: string;
  admin: NonNullable<AdminGraphqlClient>;
}) {
  const credential = await prisma.sourceStoreCredential.findUnique({
    where: { targetShop },
  });

  if (!credential) {
    throw new Error("Connect a source store before running a sync.");
  }

  const preview = await buildDefinitionScanPreview({
    sourceShop: credential.sourceShop,
    sourceToken: decryptToken(credential.encryptedToken),
    targetShop,
    admin,
  });

  const job = await createSyncJob({
    sourceShop: credential.sourceShop,
    targetShop,
    status: "syncing",
  });

  let createdMetafieldDefinitions = 0;
  let createdMetaobjectDefinitions = 0;
  let addedMetaobjectFields = 0;
  let conflictCount =
    preview.summary.conflictingMetafieldDefinitions +
    preview.summary.conflictingMetaobjectFields;
  let failedCount = 0;

  await updateSyncJob(job.id, {
    totalMetafieldDefinitions: preview.summary.totalSourceMetafieldDefinitions,
    totalMetaobjectDefinitions: preview.summary.totalSourceMetaobjectDefinitions,
    existingMetafieldDefinitions: preview.summary.existingMetafieldDefinitions,
    existingMetaobjectDefinitions: preview.summary.existingMetaobjectDefinitions,
    missingMetafieldDefinitions: preview.summary.missingMetafieldDefinitions,
    missingMetaobjectDefinitions: preview.summary.missingMetaobjectDefinitions,
    conflictCount,
  });

  try {
    for (const warning of preview.ownerTypeWarnings) {
      await createSyncLog({
        jobId: job.id,
        itemType: "metafield_definition",
        itemKey: "scope-warning",
        status: "skipped",
        message: warning,
      });
    }

    for (const definition of preview.metafields.existing) {
      await createSyncLog({
        jobId: job.id,
        itemType: "metafield_definition",
        itemKey: `${definition.ownerType}:${definition.namespace}:${definition.key}`,
        status: "exists",
        message: "Definition already exists with the same type.",
      });
    }

    for (const conflict of preview.metafields.conflicts) {
      await createSyncLog({
        jobId: job.id,
        itemType: "metafield_definition",
        itemKey: conflict.key,
        status: "conflict",
        message: conflict.message,
      });
    }

    for (const definition of preview.metafields.missing) {
      const itemKey = `${definition.ownerType}:${definition.namespace}:${definition.key}`;

      try {
        await createMetafieldDefinition(admin, definition);
        createdMetafieldDefinitions += 1;
        await createSyncLog({
          jobId: job.id,
          itemType: "metafield_definition",
          itemKey,
          status: "created",
          message: "Created missing metafield definition.",
        });
      } catch (error) {
        failedCount += 1;
        await createSyncLog({
          jobId: job.id,
          itemType: "metafield_definition",
          itemKey,
          status: "failed",
          message: error instanceof Error ? error.message : "Creation failed.",
        });
      }
    }

    for (const definition of preview.metaobjects.missing) {
      try {
        await createMetaobjectDefinition(admin, definition);
        createdMetaobjectDefinitions += 1;
        await createSyncLog({
          jobId: job.id,
          itemType: "metaobject_definition",
          itemKey: definition.type,
          status: "created",
          message: "Created missing metaobject definition.",
        });
      } catch (error) {
        failedCount += 1;
        await createSyncLog({
          jobId: job.id,
          itemType: "metaobject_definition",
          itemKey: definition.type,
          status: "failed",
          message: error instanceof Error ? error.message : "Creation failed.",
        });
      }
    }

    for (const item of preview.metaobjects.existing) {
      await createSyncLog({
        jobId: job.id,
        itemType: "metaobject_definition",
        itemKey: item.type,
        status: "exists",
        message: "Metaobject definition already exists.",
      });

      for (const fieldConflict of item.fieldConflicts) {
        await createSyncLog({
          jobId: job.id,
          itemType: "metaobject_field",
          itemKey: fieldConflict.key,
          status: "conflict",
          message: fieldConflict.message,
        });
      }

      if (!item.missingFields.length || !item.target?.id) {
        continue;
      }

      try {
        await addMissingMetaobjectFields(admin, item.target.id, item.missingFields);
        addedMetaobjectFields += item.missingFields.length;

        for (const field of item.missingFields) {
          await createSyncLog({
            jobId: job.id,
            itemType: "metaobject_field",
            itemKey: `${item.type}.${field.key}`,
            status: "created",
            message: "Added missing metaobject field.",
          });
        }
      } catch (error) {
        failedCount += item.missingFields.length;

        for (const field of item.missingFields) {
          await createSyncLog({
            jobId: job.id,
            itemType: "metaobject_field",
            itemKey: `${item.type}.${field.key}`,
            status: "failed",
            message:
              error instanceof Error ? error.message : "Failed to add field.",
          });
        }
      }
    }

    await updateSyncJob(job.id, {
      status: "completed",
      createdMetafieldDefinitions,
      createdMetaobjectDefinitions,
      addedMetaobjectFields,
      conflictCount,
      failedCount,
    });

    return { jobId: job.id, preview };
  } catch (error) {
    await updateSyncJob(job.id, {
      status: "failed",
      createdMetafieldDefinitions,
      createdMetaobjectDefinitions,
      addedMetaobjectFields,
      conflictCount,
      failedCount,
      errorMessage: error instanceof Error ? error.message : "Sync failed.",
    });
    throw error;
  }
}
