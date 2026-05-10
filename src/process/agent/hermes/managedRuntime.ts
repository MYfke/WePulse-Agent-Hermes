/**
 * @license
 * Copyright 2026 WePulse
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, readFileSync } from 'node:fs';
import { chmod, cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { getPlatformServices } from '@/common/platform';
import { getDataPath } from '@process/utils/utils';
import { getEnhancedEnv } from '@process/utils/shellEnv';

const HERMES_REPO = process.env.WEPULSE_HERMES_AGENT_REPO || 'https://github.com/NousResearch/hermes-agent.git';
const HERMES_REF = process.env.WEPULSE_HERMES_AGENT_REF || 'main';
const INSTALL_TIMEOUT_MS = 30 * 60_000;
const UPDATE_CHECK_TIMEOUT_MS = 90_000;
const VERSION_TIMEOUT_MS = 15_000;
const INSTALL_PROGRESS_WRITE_INTERVAL_MS = 750;
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, 'g');

export type HermesRuntimeInstallStatus = 'not-installed' | 'installing' | 'installed' | 'failed';
export type HermesRuntimeInstallStage =
  | 'checking'
  | 'downloading'
  | 'python'
  | 'venv'
  | 'dependencies'
  | 'wrapper'
  | 'verifying'
  | 'complete';

export type HermesRuntimeState = {
  status: HermesRuntimeInstallStatus;
  stage?: HermesRuntimeInstallStage;
  step?: number;
  totalSteps?: number;
  detail?: string;
  version?: string;
  versionOutput?: string;
  sourceCommit?: string;
  updatedAt: string;
  error?: string;
  warning?: string;
  output?: string;
};

export type HermesRuntimePaths = {
  root: string;
  python: string;
  source: string;
  sourceTmp: string;
  venv: string;
  bin: string;
  binary: string;
  hermesHome: string;
  state: string;
};

export type HermesRuntimeStatus = HermesRuntimeState & {
  installed: boolean;
  binaryPath?: string;
  runtimeRoot: string;
  hermesHome: string;
  updateAvailable: boolean | null;
  checkOutput?: string;
  checkError?: string;
};

export type HermesRuntimeCommandResult = {
  success: boolean;
  output: string;
  error?: string;
};

export type HermesRuntimeBackupResult = HermesRuntimeCommandResult & {
  filePath?: string;
};

export type HermesRuntimeConfig = {
  forceIpv4: boolean;
  proxy: string;
  configPath: string;
  exists: boolean;
};

type RunOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
  onOutput?: (chunk: string, stream: 'stdout' | 'stderr') => void;
};

type RunResult = {
  stdout: string;
  stderr: string;
};

type PythonCandidate = {
  file: string;
  args: string[];
  expectedHome: string;
};

type InstallProgressCallbacks = {
  setStage: (stage: HermesRuntimeInstallStage, detail?: string) => Promise<void>;
  appendOutput: (text: string) => void;
};

let installPromise: Promise<HermesRuntimeState> | null = null;
const PYTHON_RUNTIME_META_FILE = 'runtime-meta.json';

const INSTALL_STAGES: Record<HermesRuntimeInstallStage, { step: number; title: string }> = {
  checking: { step: 1, title: 'Checking prerequisites' },
  downloading: { step: 2, title: 'Downloading Hermes Agent' },
  python: { step: 3, title: 'Preparing bundled Python' },
  venv: { step: 4, title: 'Creating Python environment' },
  dependencies: { step: 5, title: 'Installing dependencies' },
  wrapper: { step: 6, title: 'Writing launcher' },
  verifying: { step: 7, title: 'Verifying Hermes Agent' },
  complete: { step: 7, title: 'Hermes Agent ready' },
};

const INSTALL_TOTAL_STEPS = INSTALL_STAGES.complete.step;

export function getHermesRuntimePaths(): HermesRuntimePaths {
  const root = path.join(getDataPath(), 'hermes-agent-runtime');
  const bin = path.join(root, 'bin');
  const binaryName = process.platform === 'win32' ? 'hermes.cmd' : 'hermes';

  return {
    root,
    python: path.join(root, 'python'),
    source: path.join(root, 'source'),
    sourceTmp: path.join(root, 'source.tmp'),
    venv: path.join(root, 'venv'),
    bin,
    binary: path.join(bin, binaryName),
    hermesHome: path.join(getDataPath(), 'hermes-home'),
    state: path.join(root, 'install-state.json'),
  };
}

export function resolveManagedHermesBinary(): string | null {
  const { binary } = getHermesRuntimePaths();
  return existsSync(binary) ? binary : null;
}

export function isManagedHermesRuntimeCurrent(): boolean {
  const paths = getHermesRuntimePaths();
  if (!existsSync(paths.binary)) return false;

  const bundledPythonDir = getBundledPythonResourceDir();
  if (!bundledPythonDir) {
    return !getPlatformServices().paths.isPackaged();
  }

  const managedPython = getManagedPythonBinary(paths.python);
  if (!existsSync(managedPython) || !runtimeMetaMatchesSync(bundledPythonDir, paths.python)) {
    return false;
  }

  const venvPython = getVenvPython(paths.venv);
  if (!existsSync(venvPython)) return false;

  const configuredHome = readTextSyncSafe(path.join(paths.venv, 'pyvenv.cfg'))
    ?.match(/^home\s*=\s*(.+)$/m)?.[1]
    ?.trim();
  return configuredHome
    ? normalizeComparablePath(configuredHome) === normalizeComparablePath(path.dirname(managedPython))
    : false;
}

export function getManagedHermesEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const { hermesHome } = getHermesRuntimePaths();
  return {
    ...getEnhancedEnv(extra),
    HERMES_HOME: hermesHome,
  };
}

export function isManagedHermesInstallRunning(): boolean {
  return installPromise !== null;
}

function getVenvPython(venvPath: string): string {
  return process.platform === 'win32'
    ? path.join(venvPath, 'Scripts', 'python.exe')
    : path.join(venvPath, 'bin', 'python');
}

function getRuntimeKey(): string {
  return `${process.platform}-${process.arch}`;
}

function getBundledPythonResourceDir(): string | null {
  const resourcesPath = getPlatformServices().paths.isPackaged()
    ? process.resourcesPath
    : path.join(process.cwd(), 'resources');
  const pythonDir = path.join(resourcesPath, 'bundled-python', getRuntimeKey());
  return existsSync(pythonDir) ? pythonDir : null;
}

function getManagedPythonBinary(pythonRoot: string): string {
  const candidates =
    process.platform === 'win32'
      ? [path.join(pythonRoot, 'python.exe')]
      : [
          path.join(pythonRoot, 'bin', 'python3'),
          path.join(pythonRoot, 'bin', 'python3.12'),
          path.join(pythonRoot, 'bin', 'python3.11'),
          path.join(pythonRoot, 'bin', 'python'),
        ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function getPythonMetaPath(pythonRoot: string): string {
  return path.join(pythonRoot, PYTHON_RUNTIME_META_FILE);
}

async function readTextSafe(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function readTextSyncSafe(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function normalizeComparablePath(value: string): string {
  const normalized = path.resolve(value).replace(/\\/g, '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function getNowIso(): string {
  return new Date().toISOString();
}

function combineOutput(stdout?: string, stderr?: string): string {
  return [stdout?.trim(), stderr?.trim()].filter(Boolean).join('\n');
}

function combineRawOutput(chunks: string[]): string {
  return chunks.join('');
}

function errorToMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const withOutput = error as Error & { stdout?: string; stderr?: string };
  const output = combineOutput(withOutput.stdout, withOutput.stderr);
  return output ? `${error.message}\n${output}` : error.message;
}

function truncateOutput(output: string, maxLength = 20_000): string {
  if (output.length <= maxLength) return output;
  return `${output.slice(0, maxLength)}\n... output truncated ...`;
}

function stripAnsi(output: string): string {
  return output.replace(ANSI_ESCAPE_PATTERN, '');
}

function extractVersion(output: string): string | undefined {
  const match = output.match(/Hermes Agent v([^\s]+)/i);
  return match?.[1];
}

function extractBackupPath(output: string): string | undefined {
  const match = output.match(/(?:Backup saved|Written|Created).*?(\S+\.(?:tar\.gz|zip|tgz))/i);
  return match?.[1];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parsePythonVersion(output: string): { major: number; minor: number } | null {
  const match = output.match(/Python\s+(\d+)\.(\d+)\./);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

function isPythonVersionSupported(output: string): boolean {
  const version = parsePythonVersion(output);
  if (!version) return false;
  return version.major > 3 || (version.major === 3 && version.minor >= 11);
}

function runCommand(file: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    child.stdout.on('data', (chunk: Buffer) => {
      const text = stripAnsi(chunk.toString());
      stdout += text;
      options.onOutput?.(text, 'stdout');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const text = stripAnsi(chunk.toString());
      stderr += text;
      options.onOutput?.(text, 'stderr');
    });

    const timeout = options.timeout
      ? setTimeout(() => {
          if (settled) return;
          settled = true;
          child.kill('SIGTERM');
          reject(
            Object.assign(new Error(`${file} timed out after ${options.timeout}ms`), {
              stdout,
              stderr,
              killed: true,
            })
          );
        }, options.timeout)
      : null;

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      reject(Object.assign(error, { stdout, stderr }));
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(Object.assign(new Error(`${file} exited with code ${code}`), { stdout, stderr, code }));
    });
  });
}

async function readState(paths: HermesRuntimePaths): Promise<HermesRuntimeState | null> {
  try {
    return JSON.parse(await readFile(paths.state, 'utf-8')) as HermesRuntimeState;
  } catch {
    return null;
  }
}

async function writeState(paths: HermesRuntimePaths, state: HermesRuntimeState): Promise<HermesRuntimeState> {
  await mkdir(paths.root, { recursive: true });
  await writeFile(paths.state, JSON.stringify(state, null, 2) + '\n');
  return state;
}

function getInstallerEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  return getEnhancedEnv({
    TERM: 'dumb',
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
    PYTHONNOUSERSITE: '1',
    ...extra,
  });
}

function prependPath(env: NodeJS.ProcessEnv, dirPath: string): NodeJS.ProcessEnv {
  const separator = process.platform === 'win32' ? ';' : ':';
  return {
    ...env,
    PATH: `${dirPath}${separator}${env.PATH ?? ''}`,
  };
}

async function runtimeMetaMatches(sourceDir: string, targetDir: string): Promise<boolean> {
  const sourceMeta = await readTextSafe(getPythonMetaPath(sourceDir));
  const targetMeta = await readTextSafe(getPythonMetaPath(targetDir));
  if (!sourceMeta || !targetMeta) return false;
  return sourceMeta.trim() === targetMeta.trim();
}

function runtimeMetaMatchesSync(sourceDir: string, targetDir: string): boolean {
  const sourceMeta = readTextSyncSafe(getPythonMetaPath(sourceDir));
  const targetMeta = readTextSyncSafe(getPythonMetaPath(targetDir));
  if (!sourceMeta || !targetMeta) return false;
  return sourceMeta.trim() === targetMeta.trim();
}

async function validatePython(candidate: PythonCandidate, callbacks?: InstallProgressCallbacks): Promise<void> {
  callbacks?.appendOutput(`Checking ${candidate.file} ${candidate.args.join(' ')}\n`.replace(/\s+\n$/, '\n'));
  const result = await runCommand(candidate.file, [...candidate.args, '--version'], {
    env: getInstallerEnv(),
    timeout: VERSION_TIMEOUT_MS,
  });
  const output = combineOutput(result.stdout, result.stderr);
  callbacks?.appendOutput(`${output}\n`);
  if (!isPythonVersionSupported(output)) {
    throw new Error(`Bundled Python is unsupported: ${output || candidate.file}`);
  }
}

async function resolvePython(
  paths: HermesRuntimePaths,
  callbacks?: InstallProgressCallbacks
): Promise<PythonCandidate> {
  await callbacks?.setStage('python', INSTALL_STAGES.python.title);

  const configured = process.env.WEPULSE_HERMES_PYTHON?.trim();
  if (configured) {
    const candidate: PythonCandidate = { file: configured, args: [], expectedHome: path.dirname(configured) };
    await validatePython(candidate, callbacks);
    callbacks?.appendOutput(`Using configured Python override: ${configured}\n`);
    return candidate;
  }

  const bundledPythonDir = getBundledPythonResourceDir();
  if (!bundledPythonDir) {
    throw new Error(
      `Bundled Python runtime was not found for ${getRuntimeKey()}. Run node scripts/prepareBundledPython.js before packaging or set WEPULSE_HERMES_PYTHON for development.`
    );
  }

  const sourcePython = getManagedPythonBinary(bundledPythonDir);
  if (!existsSync(sourcePython)) {
    throw new Error(`Bundled Python runtime is incomplete: ${sourcePython} is missing.`);
  }

  let managedPython = getManagedPythonBinary(paths.python);
  const shouldRefreshPython = !existsSync(managedPython) || !(await runtimeMetaMatches(bundledPythonDir, paths.python));
  if (shouldRefreshPython) {
    callbacks?.appendOutput(`Installing bundled Python runtime into ${paths.python}\n`);
    await rm(paths.python, { recursive: true, force: true });
    await mkdir(path.dirname(paths.python), { recursive: true });
    await cp(bundledPythonDir, paths.python, { dereference: true, recursive: true });
    managedPython = getManagedPythonBinary(paths.python);
    if (process.platform !== 'win32') {
      await chmod(managedPython, 0o755);
    }
    await rm(paths.venv, { recursive: true, force: true });
  } else {
    callbacks?.appendOutput(`Reusing bundled Python runtime at ${paths.python}\n`);
  }

  const candidate: PythonCandidate = { file: managedPython, args: [], expectedHome: path.dirname(managedPython) };
  await validatePython(candidate, callbacks);
  callbacks?.appendOutput(`Using bundled Python: ${managedPython}\n`);
  return candidate;
}

async function prepareSource(paths: HermesRuntimePaths, callbacks: InstallProgressCallbacks): Promise<void> {
  await callbacks.setStage('downloading', `${HERMES_REPO}#${HERMES_REF}`);
  if (!existsSync(path.join(paths.source, '.git'))) {
    await rm(paths.sourceTmp, { recursive: true, force: true });
    await rm(paths.source, { recursive: true, force: true });
    callbacks.appendOutput(`Cloning ${HERMES_REPO}#${HERMES_REF}\n`);
    await runCommand('git', ['clone', '--depth', '1', '--branch', HERMES_REF, HERMES_REPO, paths.sourceTmp], {
      env: getInstallerEnv(),
      timeout: INSTALL_TIMEOUT_MS,
      onOutput: callbacks.appendOutput,
    });
    await rename(paths.sourceTmp, paths.source);
    callbacks.appendOutput(`Cloned ${HERMES_REPO}#${HERMES_REF}\n`);
    return;
  }

  callbacks.appendOutput(`Updating ${HERMES_REPO}#${HERMES_REF}\n`);
  await runCommand('git', ['-C', paths.source, 'fetch', '--depth', '1', 'origin', HERMES_REF], {
    env: getInstallerEnv(),
    timeout: UPDATE_CHECK_TIMEOUT_MS,
    onOutput: callbacks.appendOutput,
  });
  await runCommand('git', ['-C', paths.source, 'checkout', '-f', 'FETCH_HEAD'], {
    env: getInstallerEnv(),
    timeout: UPDATE_CHECK_TIMEOUT_MS,
    onOutput: callbacks.appendOutput,
  });
  callbacks.appendOutput(`Updated source from ${HERMES_REPO}#${HERMES_REF}\n`);
}

async function prepareVenv(paths: HermesRuntimePaths, callbacks: InstallProgressCallbacks): Promise<void> {
  const python = await resolvePython(paths, callbacks);
  const venvPython = getVenvPython(paths.venv);
  const pyvenvConfig = path.join(paths.venv, 'pyvenv.cfg');
  const pyvenvConfigContent = await readTextSafe(pyvenvConfig);
  const expectedHome = normalizeComparablePath(python.expectedHome);
  const configuredHome = pyvenvConfigContent?.match(/^home\s*=\s*(.+)$/m)?.[1]?.trim();
  const venvMatchesPython = configuredHome
    ? normalizeComparablePath(configuredHome) === expectedHome
    : !existsSync(venvPython);

  await callbacks.setStage('venv', paths.venv);
  if (!existsSync(venvPython) || !venvMatchesPython) {
    await rm(paths.venv, { recursive: true, force: true });
    callbacks.appendOutput(`Creating Python venv at ${paths.venv}\n`);
    await runCommand(python.file, [...python.args, '-m', 'venv', paths.venv], {
      env: getInstallerEnv(),
      timeout: INSTALL_TIMEOUT_MS,
      onOutput: callbacks.appendOutput,
    });
    callbacks.appendOutput(
      `Created Python venv with ${python.file} ${python.args.join(' ')}\n`.replace(/\s+\n$/, '\n')
    );
  } else {
    callbacks.appendOutput(`Reusing Python venv at ${paths.venv}\n`);
  }

  await callbacks.setStage('dependencies', 'Installing hermes-agent[acp]');
  const pipEnv = prependPath(getInstallerEnv(), path.dirname(venvPython));
  await runCommand(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip', 'setuptools', 'wheel'], {
    env: pipEnv,
    timeout: INSTALL_TIMEOUT_MS,
    onOutput: callbacks.appendOutput,
  });
  await runCommand(venvPython, ['-m', 'pip', 'install', '-e', '.[acp]'], {
    cwd: paths.source,
    env: pipEnv,
    timeout: INSTALL_TIMEOUT_MS,
    onOutput: callbacks.appendOutput,
  });
  callbacks.appendOutput('Installed hermes-agent[acp] into managed venv\n');
}

async function writeHermesWrapper(paths: HermesRuntimePaths): Promise<void> {
  const venvPython = getVenvPython(paths.venv);
  await mkdir(paths.bin, { recursive: true });
  await mkdir(paths.hermesHome, { recursive: true });

  if (process.platform === 'win32') {
    await writeFile(
      paths.binary,
      [
        '@echo off',
        'set PYTHONPATH=',
        'set PYTHONHOME=',
        `set HERMES_HOME=${paths.hermesHome}`,
        `"${venvPython}" -m hermes_cli.main %*`,
        '',
      ].join('\r\n')
    );
    return;
  }

  await writeFile(
    paths.binary,
    [
      '#!/usr/bin/env bash',
      'unset PYTHONPATH',
      'unset PYTHONHOME',
      `export HERMES_HOME="${paths.hermesHome.replace(/"/g, '\\"')}"`,
      `exec "${venvPython.replace(/"/g, '\\"')}" -m hermes_cli.main "$@"`,
      '',
    ].join('\n')
  );
  await chmod(paths.binary, 0o755);
}

async function readVersionOutput(paths: HermesRuntimePaths): Promise<string> {
  const result = await runCommand(paths.binary, ['--version'], {
    env: getManagedHermesEnv(),
    timeout: VERSION_TIMEOUT_MS,
  });
  return combineOutput(result.stdout, result.stderr);
}

async function readSourceCommit(paths: HermesRuntimePaths): Promise<string | undefined> {
  try {
    const result = await runCommand('git', ['-C', paths.source, 'rev-parse', 'HEAD'], {
      env: getEnhancedEnv(),
      timeout: VERSION_TIMEOUT_MS,
    });
    return result.stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function checkRemoteUpdate(paths: HermesRuntimePaths): Promise<{
  updateAvailable: boolean | null;
  checkOutput?: string;
  checkError?: string;
}> {
  try {
    const [local, remote] = await Promise.all([
      runCommand('git', ['-C', paths.source, 'rev-parse', 'HEAD'], {
        env: getEnhancedEnv(),
        timeout: VERSION_TIMEOUT_MS,
      }),
      runCommand('git', ['-C', paths.source, 'ls-remote', 'origin', HERMES_REF], {
        env: getEnhancedEnv(),
        timeout: UPDATE_CHECK_TIMEOUT_MS,
      }),
    ]);
    const localCommit = local.stdout.trim();
    const remoteCommit = remote.stdout.trim().split(/\s+/)[0] || '';
    return {
      updateAvailable: Boolean(localCommit && remoteCommit && localCommit !== remoteCommit),
      checkOutput: `local=${localCommit}\nremote=${remoteCommit}`,
    };
  } catch (error) {
    return { updateAvailable: null, checkError: errorToMessage(error) };
  }
}

function getHermesConfigPath(paths = getHermesRuntimePaths()): string {
  return path.join(paths.hermesHome, 'config.yaml');
}

function readYamlScalar(content: string, key: string): string | null {
  const match = content.match(new RegExp(`^\\s*${escapeRegex(key)}:\\s*["']?([^"'\\n#]*)["']?`, 'm'));
  return match ? match[1].trim() : null;
}

function writeYamlScalar(content: string, key: string, value: string): string {
  const line = `${key}: "${value.replace(/"/g, '\\"')}"`;
  const regex = new RegExp(`^(\\s*#?\\s*${escapeRegex(key)}:\\s*)["']?[^"'\\n#]*["']?`, 'm');
  if (regex.test(content)) {
    return content.replace(regex, line);
  }
  return `${content.trimEnd()}\n${line}\n`;
}

async function runManagedHermesCommand(args: string[], timeout: number): Promise<HermesRuntimeCommandResult> {
  const paths = getHermesRuntimePaths();
  if (!existsSync(paths.binary)) {
    return {
      success: false,
      output: '',
      error: 'Managed Hermes Agent is not installed.',
    };
  }

  try {
    const result = await runCommand(paths.binary, args, {
      cwd: existsSync(paths.source) ? paths.source : paths.root,
      env: getManagedHermesEnv({ TERM: 'dumb' }),
      timeout,
    });
    return {
      success: true,
      output: truncateOutput(combineOutput(result.stdout, result.stderr)),
    };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: errorToMessage(error),
    };
  }
}

export async function runManagedHermesDoctor(): Promise<HermesRuntimeCommandResult> {
  return runManagedHermesCommand(['doctor'], 30_000);
}

export async function runManagedHermesDump(): Promise<HermesRuntimeCommandResult> {
  return runManagedHermesCommand(['dump'], 30_000);
}

export async function runManagedHermesBackup(): Promise<HermesRuntimeBackupResult> {
  const result = await runManagedHermesCommand(['backup'], 120_000);
  return {
    ...result,
    filePath: result.success ? extractBackupPath(result.output) : undefined,
  };
}

export async function importManagedHermesBackup(archivePath: string): Promise<HermesRuntimeCommandResult> {
  if (!archivePath.trim()) {
    return { success: false, output: '', error: 'Backup archive path is required.' };
  }
  return runManagedHermesCommand(['import', archivePath], 120_000);
}

export async function getManagedHermesConfig(): Promise<HermesRuntimeConfig> {
  const paths = getHermesRuntimePaths();
  const configPath = getHermesConfigPath(paths);
  if (!existsSync(configPath)) {
    return {
      forceIpv4: false,
      proxy: '',
      configPath,
      exists: false,
    };
  }

  const content = await readFile(configPath, 'utf-8');
  const forceIpv4 = readYamlScalar(content, 'network.force_ipv4');
  const proxy = readYamlScalar(content, 'network.proxy');
  return {
    forceIpv4: forceIpv4 === 'true' || forceIpv4 === 'True',
    proxy: proxy ?? '',
    configPath,
    exists: true,
  };
}

export async function updateManagedHermesConfig(
  input: Pick<HermesRuntimeConfig, 'forceIpv4' | 'proxy'>
): Promise<HermesRuntimeConfig> {
  const paths = getHermesRuntimePaths();
  const configPath = getHermesConfigPath(paths);
  await mkdir(paths.hermesHome, { recursive: true });
  const existingContent = existsSync(configPath) ? await readFile(configPath, 'utf-8') : '';
  const withIpv4 = writeYamlScalar(existingContent, 'network.force_ipv4', input.forceIpv4 ? 'true' : 'false');
  const nextContent = writeYamlScalar(withIpv4, 'network.proxy', input.proxy.trim());
  await writeFile(configPath, nextContent, 'utf-8');
  return getManagedHermesConfig();
}

async function installOrUpdateManagedRuntime(mode: 'install' | 'update'): Promise<HermesRuntimeState> {
  if (installPromise) return installPromise;

  const paths = getHermesRuntimePaths();
  const output: string[] = [];
  installPromise = (async () => {
    let currentState: HermesRuntimeState = {
      status: 'installing',
      stage: 'checking',
      step: INSTALL_STAGES.checking.step,
      totalSteps: INSTALL_TOTAL_STEPS,
      detail: INSTALL_STAGES.checking.title,
      updatedAt: getNowIso(),
    };
    let lastProgressWriteAt = 0;
    let progressWrite = Promise.resolve();

    const persistProgress = (force = false): Promise<void> => {
      const now = Date.now();
      if (!force && now - lastProgressWriteAt < INSTALL_PROGRESS_WRITE_INTERVAL_MS) {
        return progressWrite;
      }
      lastProgressWriteAt = now;
      const snapshot = { ...currentState };
      progressWrite = progressWrite
        .then(() => writeState(paths, snapshot))
        .then((): void => undefined)
        .catch((): void => undefined);
      return progressWrite;
    };

    const appendOutput = (text: string): void => {
      if (!text) return;
      output.push(text);
      const detail = text.trim().split(/\r?\n/).filter(Boolean).pop();
      currentState = {
        ...currentState,
        detail: detail ? detail.slice(0, 160) : currentState.detail,
        output: truncateOutput(combineRawOutput(output)),
        updatedAt: getNowIso(),
      };
      void persistProgress(false);
    };

    const setStage = async (stage: HermesRuntimeInstallStage, detail = INSTALL_STAGES[stage].title): Promise<void> => {
      currentState = {
        ...currentState,
        status: 'installing',
        stage,
        step: INSTALL_STAGES[stage].step,
        totalSteps: INSTALL_TOTAL_STEPS,
        detail,
        output: truncateOutput(combineRawOutput(output)),
        updatedAt: getNowIso(),
      };
      await persistProgress(true);
    };

    const writeFinalState = async (state: HermesRuntimeState): Promise<HermesRuntimeState> => {
      currentState = state;
      await progressWrite;
      return writeState(paths, state);
    };

    await writeState(paths, currentState);
    try {
      await mkdir(paths.root, { recursive: true });
      await prepareSource(paths, { setStage, appendOutput });
      await prepareVenv(paths, { setStage, appendOutput });
      await setStage('wrapper', paths.binary);
      await writeHermesWrapper(paths);
      await setStage('verifying', 'Running hermes --version');
      const [versionOutput, sourceCommit] = await Promise.all([readVersionOutput(paths), readSourceCommit(paths)]);
      const version = extractVersion(versionOutput);

      return writeFinalState({
        status: 'installed',
        stage: 'complete',
        step: INSTALL_STAGES.complete.step,
        totalSteps: INSTALL_TOTAL_STEPS,
        detail: INSTALL_STAGES.complete.title,
        version,
        versionOutput,
        sourceCommit,
        updatedAt: getNowIso(),
        output: truncateOutput(combineRawOutput(output)),
      });
    } catch (error) {
      const warning = errorToMessage(error);
      try {
        if (existsSync(paths.binary)) {
          const [versionOutput, sourceCommit] = await Promise.all([readVersionOutput(paths), readSourceCommit(paths)]);
          const version = extractVersion(versionOutput);
          return writeFinalState({
            status: 'installed',
            stage: 'complete',
            step: INSTALL_STAGES.complete.step,
            totalSteps: INSTALL_TOTAL_STEPS,
            detail: 'Hermes Agent ready with installer warnings',
            version,
            versionOutput,
            sourceCommit,
            updatedAt: getNowIso(),
            warning,
            output: truncateOutput(`${combineRawOutput(output)}\n${warning}`),
          });
        }
      } catch {
        // The binary exists but cannot run, so keep the original installer failure.
      }

      const state = await writeFinalState({
        status: 'failed',
        stage: currentState.stage,
        step: currentState.step,
        totalSteps: INSTALL_TOTAL_STEPS,
        detail: currentState.detail,
        updatedAt: getNowIso(),
        error: warning,
        output: truncateOutput(combineRawOutput(output)),
      });
      throw Object.assign(new Error(`${mode} Hermes Agent failed`), state);
    } finally {
      installPromise = null;
    }
  })();

  return installPromise;
}

export async function installManagedHermesRuntime(): Promise<HermesRuntimeState> {
  return installOrUpdateManagedRuntime('install');
}

export async function updateManagedHermesRuntime(): Promise<HermesRuntimeState> {
  return installOrUpdateManagedRuntime('update');
}

export function startManagedHermesRuntimeInstall(onComplete?: (state: HermesRuntimeState) => void): void {
  if (isManagedHermesRuntimeCurrent() || installPromise) return;

  void installManagedHermesRuntime()
    .then((state) => {
      onComplete?.(state);
    })
    .catch((error) => {
      console.warn('[Hermes] Managed runtime install failed:', errorToMessage(error));
    });
}

export async function getManagedHermesRuntimeStatus(checkRemote = false): Promise<HermesRuntimeStatus> {
  const paths = getHermesRuntimePaths();
  const state = (await readState(paths)) ?? {
    status: 'not-installed' as const,
    updatedAt: getNowIso(),
  };

  if (installPromise) {
    return {
      ...state,
      status: 'installing',
      installed: false,
      runtimeRoot: paths.root,
      hermesHome: paths.hermesHome,
      updateAvailable: null,
    };
  }

  if (!existsSync(paths.binary)) {
    return {
      ...state,
      status: state.status === 'failed' ? 'failed' : 'not-installed',
      installed: false,
      runtimeRoot: paths.root,
      hermesHome: paths.hermesHome,
      updateAvailable: null,
    };
  }

  try {
    const versionOutput = await readVersionOutput(paths);
    const version = extractVersion(versionOutput);
    const remote = checkRemote ? await checkRemoteUpdate(paths) : { updateAvailable: null };
    return {
      ...state,
      status: 'installed',
      installed: true,
      version: version ?? state.version,
      versionOutput,
      binaryPath: paths.binary,
      runtimeRoot: paths.root,
      hermesHome: paths.hermesHome,
      updateAvailable: remote.updateAvailable,
      checkOutput: remote.checkOutput,
      checkError: remote.checkError,
    };
  } catch (error) {
    return {
      ...state,
      status: 'failed',
      installed: false,
      runtimeRoot: paths.root,
      hermesHome: paths.hermesHome,
      updateAvailable: null,
      checkError: errorToMessage(error),
    };
  }
}
