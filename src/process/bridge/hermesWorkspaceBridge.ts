/**
 * @license
 * Copyright 2026 WePulse
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type {
  HermesAddMemoryEntryRequest,
  HermesCreateProfileRequest,
  HermesDeleteProfileRequest,
  HermesInstallBundledSkillRequest,
  HermesReadLogRequest,
  HermesRemoveMemoryEntryRequest,
  HermesSaveMemoryRequest,
  HermesSavePersonaRequest,
  HermesSetActiveProfileRequest,
  HermesSetCredentialPoolRequest,
  HermesSetEnvRequest,
  HermesSetGatewayPlatformRequest,
  HermesSetMemoryProviderRequest,
  HermesSetModelConfigRequest,
  HermesSetSkillEnabledRequest,
  HermesSetToolsetEnabledRequest,
  HermesUninstallSkillRequest,
  HermesUpdateMemoryEntryRequest,
} from '@/common/types/hermesWorkspace';
import {
  addHermesMemoryEntry,
  createHermesProfile,
  deleteHermesProfile,
  getHermesWorkspaceSnapshot,
  installBundledHermesSkill,
  readHermesLog,
  resetHermesPersona,
  saveHermesMemory,
  saveHermesPersona,
  setActiveHermesProfile,
  setHermesCredentialPool,
  setHermesEnv,
  setHermesGatewayPlatform,
  setHermesMemoryProvider,
  setHermesModelConfig,
  setHermesSkillEnabled,
  setHermesToolsetEnabled,
  startHermesGateway,
  stopHermesGateway,
  uninstallHermesSkill,
  updateHermesMemoryEntry,
  removeHermesMemoryEntry,
} from '@process/services/hermesWorkspaceService';

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function initHermesWorkspaceBridge(): void {
  ipcBridge.hermesWorkspace.getSnapshot.provider(async () => {
    try {
      return { success: true, data: await getHermesWorkspaceSnapshot() };
    } catch (error: unknown) {
      return { success: false, msg: errorMessage(error) };
    }
  });

  ipcBridge.hermesWorkspace.createProfile.provider(async (input: HermesCreateProfileRequest) => {
    try {
      return { success: true, data: await createHermesProfile(input) };
    } catch (error: unknown) {
      return { success: false, msg: errorMessage(error) };
    }
  });

  ipcBridge.hermesWorkspace.deleteProfile.provider(async (input: HermesDeleteProfileRequest) => {
    try {
      return { success: true, data: await deleteHermesProfile(input) };
    } catch (error: unknown) {
      return { success: false, msg: errorMessage(error) };
    }
  });

  ipcBridge.hermesWorkspace.setActiveProfile.provider(async (input: HermesSetActiveProfileRequest) => {
    try {
      return { success: true, data: await setActiveHermesProfile(input) };
    } catch (error: unknown) {
      return { success: false, msg: errorMessage(error) };
    }
  });

  ipcBridge.hermesWorkspace.savePersona.provider(async (input: HermesSavePersonaRequest) => {
    try {
      return { success: true, data: await saveHermesPersona(input) };
    } catch (error: unknown) {
      return { success: false, msg: errorMessage(error) };
    }
  });

  ipcBridge.hermesWorkspace.resetPersona.provider(async () => {
    try {
      return { success: true, data: await resetHermesPersona() };
    } catch (error: unknown) {
      return { success: false, msg: errorMessage(error) };
    }
  });

  ipcBridge.hermesWorkspace.saveMemory.provider(async (input: HermesSaveMemoryRequest) => {
    try {
      return { success: true, data: await saveHermesMemory(input) };
    } catch (error: unknown) {
      return { success: false, msg: errorMessage(error) };
    }
  });

  ipcBridge.hermesWorkspace.addMemoryEntry.provider(async (input: HermesAddMemoryEntryRequest) => {
    try {
      return { success: true, data: await addHermesMemoryEntry(input) };
    } catch (error: unknown) {
      return { success: false, msg: errorMessage(error) };
    }
  });

  ipcBridge.hermesWorkspace.updateMemoryEntry.provider(async (input: HermesUpdateMemoryEntryRequest) => {
    try {
      return { success: true, data: await updateHermesMemoryEntry(input) };
    } catch (error: unknown) {
      return { success: false, msg: errorMessage(error) };
    }
  });

  ipcBridge.hermesWorkspace.removeMemoryEntry.provider(async (input: HermesRemoveMemoryEntryRequest) => {
    try {
      return { success: true, data: await removeHermesMemoryEntry(input) };
    } catch (error: unknown) {
      return { success: false, msg: errorMessage(error) };
    }
  });

  ipcBridge.hermesWorkspace.setMemoryProvider.provider(async (input: HermesSetMemoryProviderRequest) => {
    try {
      return { success: true, data: await setHermesMemoryProvider(input) };
    } catch (error: unknown) {
      return { success: false, msg: errorMessage(error) };
    }
  });

  ipcBridge.hermesWorkspace.setSkillEnabled.provider(async (input: HermesSetSkillEnabledRequest) => {
    try {
      return { success: true, data: await setHermesSkillEnabled(input) };
    } catch (error: unknown) {
      return { success: false, msg: errorMessage(error) };
    }
  });

  ipcBridge.hermesWorkspace.installBundledSkill.provider(async (input: HermesInstallBundledSkillRequest) => {
    try {
      return { success: true, data: await installBundledHermesSkill(input) };
    } catch (error: unknown) {
      return { success: false, msg: errorMessage(error) };
    }
  });

  ipcBridge.hermesWorkspace.uninstallSkill.provider(async (input: HermesUninstallSkillRequest) => {
    try {
      return { success: true, data: await uninstallHermesSkill(input) };
    } catch (error: unknown) {
      return { success: false, msg: errorMessage(error) };
    }
  });

  ipcBridge.hermesWorkspace.setToolsetEnabled.provider(async (input: HermesSetToolsetEnabledRequest) => {
    try {
      return { success: true, data: await setHermesToolsetEnabled(input) };
    } catch (error: unknown) {
      return { success: false, msg: errorMessage(error) };
    }
  });

  ipcBridge.hermesWorkspace.setEnv.provider(async (input: HermesSetEnvRequest) => {
    try {
      return { success: true, data: await setHermesEnv(input) };
    } catch (error: unknown) {
      return { success: false, msg: errorMessage(error) };
    }
  });

  ipcBridge.hermesWorkspace.setModelConfig.provider(async (input: HermesSetModelConfigRequest) => {
    try {
      return { success: true, data: await setHermesModelConfig(input) };
    } catch (error: unknown) {
      return { success: false, msg: errorMessage(error) };
    }
  });

  ipcBridge.hermesWorkspace.setCredentialPool.provider(async (input: HermesSetCredentialPoolRequest) => {
    try {
      return { success: true, data: await setHermesCredentialPool(input) };
    } catch (error: unknown) {
      return { success: false, msg: errorMessage(error) };
    }
  });

  ipcBridge.hermesWorkspace.startGateway.provider(async () => {
    try {
      return { success: true, data: await startHermesGateway() };
    } catch (error: unknown) {
      return { success: false, msg: errorMessage(error) };
    }
  });

  ipcBridge.hermesWorkspace.stopGateway.provider(async () => {
    try {
      return { success: true, data: await stopHermesGateway() };
    } catch (error: unknown) {
      return { success: false, msg: errorMessage(error) };
    }
  });

  ipcBridge.hermesWorkspace.setGatewayPlatform.provider(async (input: HermesSetGatewayPlatformRequest) => {
    try {
      return { success: true, data: await setHermesGatewayPlatform(input) };
    } catch (error: unknown) {
      return { success: false, msg: errorMessage(error) };
    }
  });

  ipcBridge.hermesWorkspace.readLog.provider(async (input: HermesReadLogRequest) => {
    try {
      return { success: true, data: await readHermesLog(input) };
    } catch (error: unknown) {
      return { success: false, msg: errorMessage(error) };
    }
  });
}
