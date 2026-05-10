/**
 * @license
 * Copyright 2026 WePulse
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  safeExecFile: vi.fn(),
}));

vi.mock('@process/utils/safeExec', () => ({
  safeExecFile: mocks.safeExecFile,
}));

vi.mock('@process/utils/shellEnv', () => ({
  getEnhancedEnv: () => ({ PATH: '/usr/local/bin' }),
}));

import {
  checkHermesAgentUpdate,
  parseHermesUpdateAvailable,
  updateHermesAgent,
} from '@/process/services/hermesAgentUpdateService';

describe('hermesAgentUpdateService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects update availability from Hermes check output', () => {
    expect(parseHermesUpdateAvailable('⚕ Update available: 128 commits behind origin/main.')).toBe(true);
    expect(parseHermesUpdateAvailable('Hermes Agent is already up to date.')).toBe(false);
    expect(parseHermesUpdateAvailable('')).toBeNull();
  });

  it('returns installed status with version, path, and update availability', async () => {
    mocks.safeExecFile
      .mockResolvedValueOnce({
        stdout: 'Hermes Agent v0.13.0 (2026.5.7)\nUpdate available: 128 commits behind',
        stderr: '',
      })
      .mockResolvedValueOnce({ stdout: '/Users/miao/.local/bin/hermes\n', stderr: '' })
      .mockResolvedValueOnce({
        stdout: "→ Fetching from origin...\n⚕ Update available: 128 commits behind origin/main.\nRun 'hermes update'",
        stderr: '',
      });

    const result = await checkHermesAgentUpdate();

    expect(result).toMatchObject({
      installed: true,
      updateAvailable: true,
      version: '0.13.0',
      path: '/Users/miao/.local/bin/hermes',
    });
    expect(mocks.safeExecFile).toHaveBeenNthCalledWith(
      3,
      'hermes',
      ['update', '--check'],
      expect.objectContaining({ timeout: 90_000 })
    );
  });

  it('returns not installed when Hermes cannot be executed', async () => {
    mocks.safeExecFile.mockRejectedValueOnce(new Error('spawn hermes ENOENT'));

    const result = await checkHermesAgentUpdate();

    expect(result.installed).toBe(false);
    expect(result.updateAvailable).toBeNull();
    expect(result.checkError).toContain('spawn hermes ENOENT');
  });

  it('runs non-interactive update and rechecks status', async () => {
    mocks.safeExecFile
      .mockResolvedValueOnce({ stdout: 'Updated Hermes Agent\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'Hermes Agent v0.14.0 (2026.5.10)', stderr: '' })
      .mockResolvedValueOnce({ stdout: '/Users/miao/.local/bin/hermes\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'Hermes Agent is already up to date.', stderr: '' });

    const result = await updateHermesAgent();

    expect(mocks.safeExecFile).toHaveBeenNthCalledWith(
      1,
      'hermes',
      ['update', '--yes'],
      expect.objectContaining({ timeout: 600_000 })
    );
    expect(result.updateOutput).toBe('Updated Hermes Agent');
    expect(result.version).toBe('0.14.0');
    expect(result.updateAvailable).toBe(false);
  });
});
