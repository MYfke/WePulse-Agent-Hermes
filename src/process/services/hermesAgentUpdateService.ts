/**
 * @license
 * Copyright 2026 WePulse
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  HermesAgentBackupResult,
  HermesAgentCommandResult,
  HermesAgentRuntimeConfig,
  HermesAgentUpdateResult,
  HermesAgentUpdateStatus,
} from '@/common/update/updateTypes';
import {
  getManagedHermesConfig,
  getManagedHermesRuntimeStatus,
  importManagedHermesBackup,
  installManagedHermesRuntime,
  runManagedHermesBackup,
  runManagedHermesDoctor,
  runManagedHermesDump,
  updateManagedHermesConfig,
  updateManagedHermesRuntime,
} from '@process/agent/hermes';

const trimOutput = (value: string | undefined): string => {
  return (value || '').trim();
};

const combineOutput = (stdout?: string, stderr?: string): string => {
  return [trimOutput(stdout), trimOutput(stderr)].filter(Boolean).join('\n');
};

export async function checkHermesAgentUpdate(): Promise<HermesAgentUpdateStatus> {
  const status = await getManagedHermesRuntimeStatus(true);
  return {
    installed: status.installed,
    installStatus: status.status,
    installStage: status.stage,
    installStep: status.step,
    installTotalSteps: status.totalSteps,
    installDetail: status.detail,
    updateAvailable: status.updateAvailable,
    version: status.version,
    path: status.binaryPath,
    runtimeRoot: status.runtimeRoot,
    hermesHome: status.hermesHome,
    versionOutput: status.versionOutput ?? (status.version ? `Hermes Agent v${status.version}` : undefined),
    checkOutput: status.checkOutput || status.output,
    checkError: status.checkError || status.error,
    warning: status.warning,
  };
}

export async function updateHermesAgent(): Promise<HermesAgentUpdateResult> {
  const current = await getManagedHermesRuntimeStatus(false);
  const result = current.installed ? await updateManagedHermesRuntime() : await installManagedHermesRuntime();
  const status = await checkHermesAgentUpdate();

  return {
    ...status,
    updateOutput: combineOutput(result.output, result.error),
  };
}

export async function runHermesAgentDoctor(): Promise<HermesAgentCommandResult> {
  return runManagedHermesDoctor();
}

export async function runHermesAgentDump(): Promise<HermesAgentCommandResult> {
  return runManagedHermesDump();
}

export async function backupHermesAgentData(): Promise<HermesAgentBackupResult> {
  return runManagedHermesBackup();
}

export async function importHermesAgentData(archivePath: string): Promise<HermesAgentCommandResult> {
  return importManagedHermesBackup(archivePath);
}

export async function getHermesAgentRuntimeConfig(): Promise<HermesAgentRuntimeConfig> {
  return getManagedHermesConfig();
}

export async function updateHermesAgentRuntimeConfig(input: Pick<HermesAgentRuntimeConfig, 'forceIpv4' | 'proxy'>) {
  return updateManagedHermesConfig(input);
}
