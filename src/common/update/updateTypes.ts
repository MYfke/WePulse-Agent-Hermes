/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export interface GitHubReleaseAsset {
  name: string;
  /** Primary download URL. */
  url: string;
  /** Fallback URL tried when the primary URL fails. */
  fallbackUrl?: string;
  size: number;
  contentType?: string;
}

export interface UpdateReleaseInfo {
  tagName: string;
  version: string;
  name?: string;
  body?: string;
  htmlUrl: string;
  publishedAt?: string;
  prerelease: boolean;
  draft: boolean;
  assets: GitHubReleaseAsset[];
  recommendedAsset?: GitHubReleaseAsset;
}

export interface UpdateCheckResult {
  currentVersion: string;
  updateAvailable: boolean;
  latest?: UpdateReleaseInfo;
}

export interface UpdateCheckRequest {
  includePrerelease?: boolean;
  /** Defaults to MYfke/WePulse-Agent-Hermes when omitted */
  repo?: string;
}

export interface UpdateDownloadRequest {
  url: string;
  /** Fallback URL tried when the primary URL fails (e.g. CDN down). */
  fallbackUrl?: string;
  fileName?: string;
}

export interface UpdateDownloadResult {
  downloadId: string;
  filePath: string;
}

export type UpdateDownloadStatus = 'starting' | 'downloading' | 'completed' | 'error' | 'cancelled';

export interface UpdateDownloadProgressEvent {
  downloadId: string;
  status: UpdateDownloadStatus;
  receivedBytes: number;
  totalBytes?: number;
  percent?: number;
  bytesPerSecond?: number;
  filePath?: string;
  error?: string;
}

// Auto-updater status types (electron-updater)
export type AutoUpdateStatusType =
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'cancelled';

export interface AutoUpdateProgress {
  bytesPerSecond: number;
  percent: number;
  transferred: number;
  total: number;
}

export interface AutoUpdateStatus {
  status: AutoUpdateStatusType;
  version?: string;
  releaseDate?: string;
  releaseNotes?: string;
  progress?: AutoUpdateProgress;
  error?: string;
}

export type HermesAgentUpdateStatus = {
  installed: boolean;
  installStatus?: 'not-installed' | 'installing' | 'installed' | 'failed';
  installStage?: 'checking' | 'downloading' | 'python' | 'venv' | 'dependencies' | 'wrapper' | 'verifying' | 'complete';
  installStep?: number;
  installTotalSteps?: number;
  installDetail?: string;
  updateAvailable: boolean | null;
  version?: string;
  path?: string;
  runtimeRoot?: string;
  hermesHome?: string;
  versionOutput?: string;
  checkOutput?: string;
  checkError?: string;
  warning?: string;
};

export type HermesAgentUpdateResult = HermesAgentUpdateStatus & {
  updateOutput: string;
};

export type HermesAgentCommandResult = {
  success: boolean;
  output: string;
  error?: string;
};

export type HermesAgentBackupResult = HermesAgentCommandResult & {
  filePath?: string;
};

export type HermesAgentRuntimeConfig = {
  forceIpv4: boolean;
  proxy: string;
  configPath: string;
  exists: boolean;
};
