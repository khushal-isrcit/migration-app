import prisma from "../../db.server";
import type { JobStatus, LogStatus, SyncItemType } from "./types.server";

export async function createSyncJob(input: {
  sourceShop: string;
  targetShop: string;
  status?: JobStatus;
}) {
  return prisma.definitionSyncJob.create({
    data: {
      sourceShop: input.sourceShop,
      targetShop: input.targetShop,
      status: input.status ?? "pending",
    },
  });
}

export async function updateSyncJob(
  jobId: string,
  data: {
    status?: JobStatus;
    totalMetafieldDefinitions?: number;
    totalMetaobjectDefinitions?: number;
    existingMetafieldDefinitions?: number;
    existingMetaobjectDefinitions?: number;
    missingMetafieldDefinitions?: number;
    missingMetaobjectDefinitions?: number;
    createdMetafieldDefinitions?: number;
    createdMetaobjectDefinitions?: number;
    addedMetaobjectFields?: number;
    conflictCount?: number;
    failedCount?: number;
    errorMessage?: string | null;
  },
) {
  return prisma.definitionSyncJob.update({
    where: { id: jobId },
    data,
  });
}

export async function createSyncLog(input: {
  jobId: string;
  itemType: SyncItemType;
  itemKey: string;
  status: LogStatus;
  message: string;
}) {
  return prisma.definitionSyncLog.create({
    data: input,
  });
}

export async function getSyncLogs(jobId: string) {
  return prisma.definitionSyncLog.findMany({
    where: { jobId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getLatestSyncJob(targetShop: string) {
  return prisma.definitionSyncJob.findFirst({
    where: { targetShop },
    orderBy: { createdAt: "desc" },
  });
}
