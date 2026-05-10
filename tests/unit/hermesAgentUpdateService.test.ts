/**
 * @license
 * Copyright 2026 WePulse
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getManagedHermesRuntimeStatus: vi.fn(),
  getManagedHermesConfig: vi.fn(),
  importManagedHermesBackup: vi.fn(),
  installManagedHermesRuntime: vi.fn(),
  runManagedHermesBackup: vi.fn(),
  runManagedHermesDoctor: vi.fn(),
  runManagedHermesDump: vi.fn(),
  updateManagedHermesConfig: vi.fn(),
  updateManagedHermesRuntime: vi.fn(),
}));

vi.mock('@process/agent/hermes', () => ({
  getManagedHermesRuntimeStatus: (...args: unknown[]) => mocks.getManagedHermesRuntimeStatus(...args),
  getManagedHermesConfig: (...args: unknown[]) => mocks.getManagedHermesConfig(...args),
  importManagedHermesBackup: (...args: unknown[]) => mocks.importManagedHermesBackup(...args),
  installManagedHermesRuntime: (...args: unknown[]) => mocks.installManagedHermesRuntime(...args),
  runManagedHermesBackup: (...args: unknown[]) => mocks.runManagedHermesBackup(...args),
  runManagedHermesDoctor: (...args: unknown[]) => mocks.runManagedHermesDoctor(...args),
  runManagedHermesDump: (...args: unknown[]) => mocks.runManagedHermesDump(...args),
  updateManagedHermesConfig: (...args: unknown[]) => mocks.updateManagedHermesConfig(...args),
  updateManagedHermesRuntime: (...args: unknown[]) => mocks.updateManagedHermesRuntime(...args),
}));

import {
  backupHermesAgentData,
  getHermesAgentRuntimeConfig,
  importHermesAgentData,
  runHermesAgentDoctor,
  runHermesAgentDump,
  checkHermesAgentUpdate,
  updateHermesAgent,
  updateHermesAgentRuntimeConfig,
} from '@/process/services/hermesAgentUpdateService';

describe('hermesAgentUpdateService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns installed status with version, path, and update availability', async () => {
    mocks.getManagedHermesRuntimeStatus.mockResolvedValueOnce({
      installed: true,
      status: 'installed',
      stage: 'complete',
      step: 7,
      totalSteps: 7,
      detail: 'Hermes Agent ready',
      updateAvailable: true,
      version: '0.13.0',
      binaryPath: '/Users/miao/.wepulse-hermes/hermes-agent-runtime/bin/hermes',
      runtimeRoot: '/Users/miao/.wepulse-hermes/hermes-agent-runtime',
      hermesHome: '/Users/miao/.wepulse-hermes/hermes-home',
      warning: 'installer completed with warnings',
      checkOutput: 'local=old\nremote=new',
    });

    const result = await checkHermesAgentUpdate();

    expect(result).toMatchObject({
      installed: true,
      installStatus: 'installed',
      installStage: 'complete',
      installStep: 7,
      installTotalSteps: 7,
      installDetail: 'Hermes Agent ready',
      updateAvailable: true,
      version: '0.13.0',
      path: '/Users/miao/.wepulse-hermes/hermes-agent-runtime/bin/hermes',
      hermesHome: '/Users/miao/.wepulse-hermes/hermes-home',
      warning: 'installer completed with warnings',
    });
    expect(mocks.getManagedHermesRuntimeStatus).toHaveBeenCalledWith(true);
  });

  it('returns not installed when Hermes cannot be executed', async () => {
    mocks.getManagedHermesRuntimeStatus.mockResolvedValueOnce({
      installed: false,
      status: 'not-installed',
      updateAvailable: null,
      runtimeRoot: '/Users/miao/.wepulse-hermes/hermes-agent-runtime',
      hermesHome: '/Users/miao/.wepulse-hermes/hermes-home',
      checkError: 'managed Hermes Agent is not installed',
    });

    const result = await checkHermesAgentUpdate();

    expect(result.installed).toBe(false);
    expect(result.installStatus).toBe('not-installed');
    expect(result.updateAvailable).toBeNull();
    expect(result.checkError).toContain('managed Hermes Agent is not installed');
  });

  it('returns installation progress while the managed runtime is installing', async () => {
    mocks.getManagedHermesRuntimeStatus.mockResolvedValueOnce({
      installed: false,
      status: 'installing',
      stage: 'dependencies',
      step: 5,
      totalSteps: 7,
      detail: 'Installing hermes-agent[acp]',
      updateAvailable: null,
      runtimeRoot: '/runtime',
      hermesHome: '/home',
      output: 'pip install -e .[acp]',
    });

    const result = await checkHermesAgentUpdate();

    expect(result).toMatchObject({
      installed: false,
      installStatus: 'installing',
      installStage: 'dependencies',
      installStep: 5,
      installTotalSteps: 7,
      installDetail: 'Installing hermes-agent[acp]',
      checkOutput: 'pip install -e .[acp]',
    });
  });

  it('updates the managed runtime and rechecks status', async () => {
    mocks.getManagedHermesRuntimeStatus
      .mockResolvedValueOnce({
        installed: true,
        status: 'installed',
        updateAvailable: true,
        runtimeRoot: '/runtime',
        hermesHome: '/home',
      })
      .mockResolvedValueOnce({
        installed: true,
        status: 'installed',
        updateAvailable: false,
        version: '0.14.0',
        binaryPath: '/runtime/bin/hermes',
        runtimeRoot: '/runtime',
        hermesHome: '/home',
      });
    mocks.updateManagedHermesRuntime.mockResolvedValueOnce({
      status: 'installed',
      updatedAt: '2026-05-10T00:00:00.000Z',
      output: 'Updated managed Hermes Agent',
    });

    const result = await updateHermesAgent();

    expect(mocks.updateManagedHermesRuntime).toHaveBeenCalled();
    expect(mocks.installManagedHermesRuntime).not.toHaveBeenCalled();
    expect(result.updateOutput).toBe('Updated managed Hermes Agent');
    expect(result.version).toBe('0.14.0');
    expect(result.updateAvailable).toBe(false);
  });

  it('installs the managed runtime when it is missing', async () => {
    mocks.getManagedHermesRuntimeStatus
      .mockResolvedValueOnce({
        installed: false,
        status: 'not-installed',
        updateAvailable: null,
        runtimeRoot: '/runtime',
        hermesHome: '/home',
      })
      .mockResolvedValueOnce({
        installed: true,
        status: 'installed',
        updateAvailable: false,
        version: '0.13.0',
        binaryPath: '/runtime/bin/hermes',
        runtimeRoot: '/runtime',
        hermesHome: '/home',
      });
    mocks.installManagedHermesRuntime.mockResolvedValueOnce({
      status: 'installed',
      updatedAt: '2026-05-10T00:00:00.000Z',
      output: 'Installed managed Hermes Agent',
    });

    const result = await updateHermesAgent();

    expect(mocks.installManagedHermesRuntime).toHaveBeenCalled();
    expect(mocks.updateManagedHermesRuntime).not.toHaveBeenCalled();
    expect(result.updateOutput).toBe('Installed managed Hermes Agent');
    expect(result.path).toBe('/runtime/bin/hermes');
  });

  it('delegates diagnostics and data actions to the managed runtime', async () => {
    mocks.runManagedHermesDoctor.mockResolvedValueOnce({ success: true, output: 'doctor ok' });
    mocks.runManagedHermesDump.mockResolvedValueOnce({ success: true, output: 'dump ok' });
    mocks.runManagedHermesBackup.mockResolvedValueOnce({ success: true, output: 'backup ok', filePath: '/backup.tgz' });
    mocks.importManagedHermesBackup.mockResolvedValueOnce({ success: true, output: 'import ok' });

    await expect(runHermesAgentDoctor()).resolves.toMatchObject({ output: 'doctor ok' });
    await expect(runHermesAgentDump()).resolves.toMatchObject({ output: 'dump ok' });
    await expect(backupHermesAgentData()).resolves.toMatchObject({ filePath: '/backup.tgz' });
    await expect(importHermesAgentData('/backup.tgz')).resolves.toMatchObject({ output: 'import ok' });
    expect(mocks.importManagedHermesBackup).toHaveBeenCalledWith('/backup.tgz');
  });

  it('delegates runtime network config reads and writes', async () => {
    mocks.getManagedHermesConfig.mockResolvedValueOnce({
      forceIpv4: false,
      proxy: '',
      configPath: '/home/config.yaml',
      exists: true,
    });
    mocks.updateManagedHermesConfig.mockResolvedValueOnce({
      forceIpv4: true,
      proxy: 'http://127.0.0.1:7890',
      configPath: '/home/config.yaml',
      exists: true,
    });

    await expect(getHermesAgentRuntimeConfig()).resolves.toMatchObject({ configPath: '/home/config.yaml' });
    await expect(
      updateHermesAgentRuntimeConfig({ forceIpv4: true, proxy: 'http://127.0.0.1:7890' })
    ).resolves.toMatchObject({ forceIpv4: true });
    expect(mocks.updateManagedHermesConfig).toHaveBeenCalledWith({
      forceIpv4: true,
      proxy: 'http://127.0.0.1:7890',
    });
  });
});
