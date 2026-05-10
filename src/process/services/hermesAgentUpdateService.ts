/**
 * @license
 * Copyright 2026 WePulse
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HermesAgentUpdateResult, HermesAgentUpdateStatus } from '@/common/update/updateTypes';
import { safeExecFile } from '@process/utils/safeExec';
import { getEnhancedEnv } from '@process/utils/shellEnv';

const HERMES_COMMAND = 'hermes';
const VERSION_TIMEOUT_MS = 15_000;
const CHECK_TIMEOUT_MS = 90_000;
const UPDATE_TIMEOUT_MS = 10 * 60_000;

type ExecLikeError = Error & {
  stdout?: string;
  stderr?: string;
  code?: number;
};

const getHermesEnv = (): NodeJS.ProcessEnv => {
  return getEnhancedEnv();
};

const trimOutput = (value: string | undefined): string => {
  return (value || '').trim();
};

const combineOutput = (stdout?: string, stderr?: string): string => {
  return [trimOutput(stdout), trimOutput(stderr)].filter(Boolean).join('\n');
};

const errorToMessage = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error);
  const execError = error as ExecLikeError;
  const output = combineOutput(execError.stdout, execError.stderr);
  return output ? `${error.message}\n${output}` : error.message;
};

const extractVersion = (output: string): string | undefined => {
  const match = output.match(/Hermes Agent v([^\s]+)/i);
  return match?.[1];
};

export const parseHermesUpdateAvailable = (output: string): boolean | null => {
  const normalized = output.toLowerCase();
  if (!normalized.trim()) return null;
  if (/update available|commits? behind|behind\s+origin|run ['"]?hermes update/i.test(output)) return true;
  if (/already up[-\s]?to[-\s]?date|up[-\s]?to[-\s]?date|no update/i.test(output)) return false;
  return null;
};

const resolveHermesPath = async (): Promise<string | undefined> => {
  const command = process.platform === 'win32' ? 'where' : 'which';
  try {
    const { stdout } = await safeExecFile(command, [HERMES_COMMAND], {
      timeout: VERSION_TIMEOUT_MS,
      env: getHermesEnv(),
    });
    return trimOutput(stdout).split(/\r?\n/).find(Boolean);
  } catch {
    return undefined;
  }
};

export async function checkHermesAgentUpdate(): Promise<HermesAgentUpdateStatus> {
  let versionOutput = '';
  try {
    const versionResult = await safeExecFile(HERMES_COMMAND, ['--version'], {
      timeout: VERSION_TIMEOUT_MS,
      env: getHermesEnv(),
    });
    versionOutput = combineOutput(versionResult.stdout, versionResult.stderr);
  } catch (error) {
    return {
      installed: false,
      updateAvailable: null,
      checkError: errorToMessage(error),
    };
  }

  const path = await resolveHermesPath();
  const version = extractVersion(versionOutput);

  try {
    const checkResult = await safeExecFile(HERMES_COMMAND, ['update', '--check'], {
      timeout: CHECK_TIMEOUT_MS,
      env: getHermesEnv(),
    });
    const checkOutput = combineOutput(checkResult.stdout, checkResult.stderr);
    return {
      installed: true,
      updateAvailable: parseHermesUpdateAvailable(checkOutput),
      version,
      path,
      versionOutput,
      checkOutput,
    };
  } catch (error) {
    return {
      installed: true,
      updateAvailable: null,
      version,
      path,
      versionOutput,
      checkError: errorToMessage(error),
    };
  }
}

export async function updateHermesAgent(): Promise<HermesAgentUpdateResult> {
  const updateResult = await safeExecFile(HERMES_COMMAND, ['update', '--yes'], {
    timeout: UPDATE_TIMEOUT_MS,
    env: getHermesEnv(),
  });
  const updateOutput = combineOutput(updateResult.stdout, updateResult.stderr);
  const status = await checkHermesAgentUpdate();

  return {
    ...status,
    updateOutput,
  };
}
