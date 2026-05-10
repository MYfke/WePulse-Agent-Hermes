/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getPlatformServices } from '@/common/platform';
import { APP_MULTI_INSTANCE_ENV } from './appBrand';

/**
 * Returns baseName unchanged in release builds, or baseName + '-dev' in dev builds.
 * When WEPULSE_HERMES_MULTI_INSTANCE=1, appends '-2' to isolate the second dev instance.
 * Used to isolate symlink and directory names between environments.
 *
 * @example
 * getEnvAwareName('.wepulse-hermes')        // release → '.wepulse-hermes',        dev → '.wepulse-hermes-dev'
 * getEnvAwareName('.wepulse-hermes-config') // release → '.wepulse-hermes-config', dev → '.wepulse-hermes-config-dev'
 * // with WEPULSE_HERMES_MULTI_INSTANCE=1: dev → '.wepulse-hermes-dev-2'
 */
export function getEnvAwareName(baseName: string): string {
  if (getPlatformServices().paths.isPackaged() === true) return baseName;
  const suffix = process.env[APP_MULTI_INSTANCE_ENV] === '1' ? '-dev-2' : '-dev';
  return `${baseName}${suffix}`;
}
