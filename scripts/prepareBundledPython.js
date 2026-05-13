const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CACHE_META_FILE = 'runtime-meta.json';
const DEFAULT_PYTHON_VERSION_PREFIX = '3.12';
const RELEASE_API_ROOT = 'https://api.github.com/repos/astral-sh/python-build-standalone/releases';
const DOWNLOAD_TIMEOUT_MS = 20 * 60 * 1000;

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function removeDirectorySafe(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function writeJson(filePath, payload) {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
}

function runCommand(command, args, options = {}) {
  execFileSync(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 300000,
    ...options,
  });
}

function getRuntimeVersionPrefix() {
  const configured = process.env.WEPULSE_HERMES_PYTHON_VERSION;
  return configured && configured.trim() ? configured.trim() : DEFAULT_PYTHON_VERSION_PREFIX;
}

function getReleaseSelector() {
  const configured = process.env.WEPULSE_HERMES_PYTHON_RELEASE;
  return configured && configured.trim() ? configured.trim() : 'latest';
}

function getGitHubApiHeaders() {
  const token = (process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '').trim();
  const headers = ['Accept: application/vnd.github+json'];
  if (token) {
    headers.push(`Authorization: token ${token}`);
  }
  return headers;
}

function getCacheRootDir() {
  const custom = process.env.WEPULSE_HERMES_PYTHON_CACHE_DIR;
  if (custom && custom.trim()) {
    return path.resolve(custom.trim());
  }

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, 'WePulse-Agent-Hermes', 'cache', 'bundled-python');
  }

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Caches', 'WePulse-Agent-Hermes', 'bundled-python');
  }

  const xdgCacheHome = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(xdgCacheHome, 'WePulse-Agent-Hermes', 'bundled-python');
}

function getTargetTriple(platform, arch) {
  const triples = {
    'darwin-arm64': 'aarch64-apple-darwin',
    'darwin-x64': 'x86_64-apple-darwin',
    'linux-arm64': 'aarch64-unknown-linux-gnu',
    'linux-x64': 'x86_64-unknown-linux-gnu',
    'win32-arm64': 'aarch64-pc-windows-msvc',
    'win32-x64': 'x86_64-pc-windows-msvc',
  };
  return triples[`${platform}-${arch}`] || null;
}

function getPythonBinaryPath(runtimeDir, platform) {
  if (platform === 'win32') {
    const binaryPath = path.join(runtimeDir, 'python.exe');
    return fs.existsSync(binaryPath) ? binaryPath : null;
  }

  const candidates = [
    path.join(runtimeDir, 'bin', 'python3'),
    path.join(runtimeDir, 'bin', 'python3.12'),
    path.join(runtimeDir, 'bin', 'python3.11'),
    path.join(runtimeDir, 'bin', 'python'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function ensureExecutableMode(filePath) {
  if (process.platform === 'win32') return;
  try {
    fs.chmodSync(filePath, 0o755);
  } catch {}
}

function listDirectoriesRecursive(dirPath, acc = []) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(dirPath, entry.name);
    acc.push(fullPath);
    listDirectoriesRecursive(fullPath, acc);
  }
  return acc;
}

function findRuntimeDirectory(rootDir, platform) {
  const candidateDirs = [rootDir, ...listDirectoriesRecursive(rootDir)];
  for (const candidate of candidateDirs) {
    if (getPythonBinaryPath(candidate, platform)) {
      return candidate;
    }
  }
  return null;
}

function copyDirectory(sourceDir, targetDir, platform) {
  removeDirectorySafe(targetDir);
  ensureDirectory(path.dirname(targetDir));
  fs.cpSync(sourceDir, targetDir, { dereference: true, recursive: true });
  materializeSymlinks(targetDir);
  const pythonBinary = getPythonBinaryPath(targetDir, platform);
  if (pythonBinary) {
    ensureExecutableMode(pythonBinary);
  }
}

function materializeSymlinks(rootDir) {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isSymbolicLink()) {
      const realPath = fs.realpathSync(fullPath);
      const stat = fs.statSync(realPath);
      fs.rmSync(fullPath, { recursive: true, force: true });
      if (stat.isDirectory()) {
        fs.cpSync(realPath, fullPath, { dereference: true, recursive: true });
        materializeSymlinks(fullPath);
      } else {
        ensureDirectory(path.dirname(fullPath));
        fs.copyFileSync(realPath, fullPath);
      }
      continue;
    }
    if (entry.isDirectory()) {
      materializeSymlinks(fullPath);
    }
  }
}

function extractArchive(archivePath, outputDir) {
  removeDirectorySafe(outputDir);
  ensureDirectory(outputDir);
  runCommand('tar', ['-xzf', archivePath, '-C', outputDir]);
}

function downloadFile(url, outputPath) {
  console.log(`Downloading Python runtime from ${url}`);
  ensureDirectory(path.dirname(outputPath));

  if (process.platform === 'win32') {
    const psScript = [
      "$ProgressPreference='SilentlyContinue'",
      `Invoke-WebRequest -Uri '${url.replace(/'/g, "''")}' -OutFile '${outputPath.replace(/'/g, "''")}'`,
    ].join('; ');
    runCommand('powershell', ['-NoProfile', '-NonInteractive', '-Command', psScript], { timeout: DOWNLOAD_TIMEOUT_MS });
    return;
  }

  try {
    runCommand(
      'curl',
      [
        '-L',
        '--fail',
        '--retry',
        '3',
        '--retry-delay',
        '5',
        '--connect-timeout',
        '30',
        '--max-time',
        '1100',
        '-C',
        '-',
        '--silent',
        '--show-error',
        '-o',
        outputPath,
        url,
      ],
      { timeout: DOWNLOAD_TIMEOUT_MS }
    );
    return;
  } catch {
    runCommand('wget', ['-c', '-q', '-O', outputPath, url], { timeout: DOWNLOAD_TIMEOUT_MS });
  }
}

function readJsonFromUrl(url) {
  const headerArgs = getGitHubApiHeaders().flatMap((header) => ['-H', header]);
  const output = execFileSync('curl', ['-L', '--fail', '--silent', '--show-error', ...headerArgs, url], {
    encoding: 'utf-8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120000,
  });
  return JSON.parse(output);
}

function selectAsset(release, targetTriple, versionPrefix) {
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const matchingAssets = assets.filter((asset) => {
    const name = asset.name || '';
    return (
      name.startsWith(`cpython-${versionPrefix}`) &&
      name.includes(`-${targetTriple}-install_only`) &&
      name.endsWith('.tar.gz')
    );
  });
  const stripped = matchingAssets.find((asset) => asset.name.includes('install_only_stripped'));
  return stripped || matchingAssets[0] || null;
}

function resolveReleaseAsset(platform, arch, versionPrefix) {
  const targetTriple = getTargetTriple(platform, arch);
  if (!targetTriple) {
    throw new Error(`Unsupported bundled Python target: ${platform}-${arch}`);
  }

  const configuredUrl = process.env.WEPULSE_HERMES_PYTHON_STANDALONE_URL;
  if (configuredUrl && configuredUrl.trim()) {
    const url = configuredUrl.trim();
    return {
      releaseTag: 'custom-url',
      targetTriple,
      assetName: path.basename(new URL(url).pathname),
      downloadUrl: url,
    };
  }

  const configuredLocalSource =
    process.env.WEPULSE_HERMES_PYTHON_STANDALONE_DIR || process.env.WEPULSE_HERMES_PYTHON_STANDALONE_ARCHIVE;
  if (configuredLocalSource && configuredLocalSource.trim()) {
    return {
      releaseTag: 'local',
      targetTriple,
      assetName: `local-cpython-${versionPrefix}-${targetTriple}.tar.gz`,
      downloadUrl: null,
    };
  }

  const selector = getReleaseSelector();
  const releaseUrl =
    selector === 'latest' ? `${RELEASE_API_ROOT}/latest` : `${RELEASE_API_ROOT}/tags/${encodeURIComponent(selector)}`;
  const release = readJsonFromUrl(releaseUrl);
  const asset = selectAsset(release, targetTriple, versionPrefix);
  if (!asset) {
    throw new Error(`No CPython ${versionPrefix} install_only asset found for ${targetTriple} in ${release.tag_name}`);
  }

  return {
    releaseTag: release.tag_name || selector,
    targetTriple,
    assetName: asset.name,
    downloadUrl: asset.browser_download_url,
  };
}

function getCacheMetaPath(cacheRuntimeDir) {
  return path.join(cacheRuntimeDir, CACHE_META_FILE);
}

function isCachedRuntimeValid(cacheRuntimeDir, platform, arch, versionPrefix, asset) {
  if (!getPythonBinaryPath(cacheRuntimeDir, platform)) return false;
  const meta = readJsonSafe(getCacheMetaPath(cacheRuntimeDir));
  if (!meta) return false;
  return (
    meta.platform === platform &&
    meta.arch === arch &&
    meta.versionPrefix === versionPrefix &&
    meta.assetName === asset.assetName &&
    meta.releaseTag === asset.releaseTag &&
    !!meta.sourceType
  );
}

function writeRuntimeMeta(runtimeDir, meta) {
  writeJson(getCacheMetaPath(runtimeDir), meta);
}

function copyRuntimeFromLocalDir(cacheRuntimeDir, platform, arch, versionPrefix, asset) {
  const configured = process.env.WEPULSE_HERMES_PYTHON_STANDALONE_DIR;
  if (!configured || !configured.trim()) return null;

  const sourceDir = path.resolve(configured.trim());
  const runtimeDir = findRuntimeDirectory(sourceDir, platform);
  if (!runtimeDir) {
    throw new Error(`Configured Python runtime does not contain an expected Python binary: ${sourceDir}`);
  }

  copyDirectory(runtimeDir, cacheRuntimeDir, platform);
  const cacheMeta = {
    platform,
    arch,
    versionPrefix,
    releaseTag: asset.releaseTag,
    targetTriple: asset.targetTriple,
    assetName: asset.assetName,
    sourceType: 'local-dir',
    source: { dir: runtimeDir },
    updatedAt: new Date().toISOString(),
  };
  writeRuntimeMeta(cacheRuntimeDir, cacheMeta);
  return cacheMeta;
}

function copyRuntimeFromArchive(cacheRuntimeDir, platform, arch, versionPrefix, asset) {
  const configured = process.env.WEPULSE_HERMES_PYTHON_STANDALONE_ARCHIVE;
  if (!configured || !configured.trim()) return null;

  const archivePath = path.resolve(configured.trim());
  const tempRoot = path.join(os.tmpdir(), 'wepulse-hermes-bundled-python', 'local-archive', `${platform}-${arch}`);
  const extractedDir = path.join(tempRoot, 'extracted');
  extractArchive(archivePath, extractedDir);

  const runtimeDir = findRuntimeDirectory(extractedDir, platform);
  if (!runtimeDir) {
    throw new Error(`Configured Python archive does not contain an expected Python binary: ${archivePath}`);
  }

  copyDirectory(runtimeDir, cacheRuntimeDir, platform);
  const cacheMeta = {
    platform,
    arch,
    versionPrefix,
    releaseTag: asset.releaseTag,
    targetTriple: asset.targetTriple,
    assetName: asset.assetName,
    sourceType: 'local-archive',
    source: { archive: archivePath },
    updatedAt: new Date().toISOString(),
  };
  writeRuntimeMeta(cacheRuntimeDir, cacheMeta);
  removeDirectorySafe(tempRoot);
  return cacheMeta;
}

function downloadRuntimeIntoCache(cacheRuntimeDir, platform, arch, versionPrefix, asset) {
  if (!asset.downloadUrl) {
    throw new Error('No bundled Python download URL resolved.');
  }

  const tempRoot = path.join(os.tmpdir(), 'wepulse-hermes-bundled-python', asset.releaseTag, `${platform}-${arch}`);
  const archivePath = path.join(tempRoot, asset.assetName);
  const extractedDir = path.join(tempRoot, 'extracted');

  removeDirectorySafe(tempRoot);
  ensureDirectory(tempRoot);
  downloadFile(asset.downloadUrl, archivePath);
  extractArchive(archivePath, extractedDir);

  const runtimeDir = findRuntimeDirectory(extractedDir, platform);
  if (!runtimeDir) {
    throw new Error(`Downloaded Python archive does not contain an expected Python binary: ${asset.assetName}`);
  }

  copyDirectory(runtimeDir, cacheRuntimeDir, platform);
  const cacheMeta = {
    platform,
    arch,
    versionPrefix,
    releaseTag: asset.releaseTag,
    targetTriple: asset.targetTriple,
    assetName: asset.assetName,
    sourceType: 'download',
    source: {
      url: asset.downloadUrl,
    },
    updatedAt: new Date().toISOString(),
  };
  writeRuntimeMeta(cacheRuntimeDir, cacheMeta);
  removeDirectorySafe(tempRoot);
  return cacheMeta;
}

function prepareBundledPython(targetArch) {
  const projectRoot = path.resolve(__dirname, '..');
  const platform = process.platform;
  const arch = targetArch || process.env.npm_config_target_arch || process.arch;
  const runtimeKey = `${platform}-${arch}`;
  const versionPrefix = getRuntimeVersionPrefix();
  const targetDir = path.join(projectRoot, 'resources', 'bundled-python', runtimeKey);

  console.log(`Preparing bundled Python for ${runtimeKey} (version prefix: ${versionPrefix})`);

  try {
    const asset = resolveReleaseAsset(platform, arch, versionPrefix);
    const cacheRuntimeDir = path.join(getCacheRootDir(), asset.releaseTag, runtimeKey);
    ensureDirectory(cacheRuntimeDir);

    let cacheMeta = null;
    if (isCachedRuntimeValid(cacheRuntimeDir, platform, arch, versionPrefix, asset)) {
      cacheMeta = readJsonSafe(getCacheMetaPath(cacheRuntimeDir));
    } else {
      removeDirectorySafe(cacheRuntimeDir);
      ensureDirectory(cacheRuntimeDir);
      cacheMeta =
        copyRuntimeFromLocalDir(cacheRuntimeDir, platform, arch, versionPrefix, asset) ||
        copyRuntimeFromArchive(cacheRuntimeDir, platform, arch, versionPrefix, asset) ||
        downloadRuntimeIntoCache(cacheRuntimeDir, platform, arch, versionPrefix, asset);
    }

    copyDirectory(cacheRuntimeDir, targetDir, platform);
    const pythonBinary = getPythonBinaryPath(targetDir, platform);
    const manifest = {
      platform,
      arch,
      versionPrefix,
      releaseTag: asset.releaseTag,
      targetTriple: asset.targetTriple,
      assetName: asset.assetName,
      generatedAt: new Date().toISOString(),
      sourceType: cacheMeta?.sourceType || 'cache',
      cacheDir: cacheRuntimeDir,
      pythonBinary: pythonBinary ? path.relative(targetDir, pythonBinary).replace(/\\/g, '/') : null,
      skipped: false,
    };
    writeJson(path.join(targetDir, 'manifest.json'), manifest);

    console.log(
      `Bundled Python runtime prepared: ${path.relative(projectRoot, targetDir)} (${manifest.pythonBinary}) [source=${manifest.sourceType}]`
    );
    return { prepared: true, dir: targetDir, sourceType: manifest.sourceType };
  } catch (error) {
    if (process.env.WEPULSE_HERMES_ALLOW_MISSING_BUNDLED_PYTHON === '1') {
      ensureDirectory(targetDir);
      const manifest = {
        platform,
        arch,
        versionPrefix,
        generatedAt: new Date().toISOString(),
        sourceType: 'none',
        skipped: true,
        reason: error instanceof Error ? error.message : String(error),
      };
      writeJson(path.join(targetDir, 'manifest.json'), manifest);
      console.warn(`Failed to prepare bundled Python runtime: ${manifest.reason}`);
      return { prepared: false, reason: manifest.reason };
    }

    throw error;
  }
}

module.exports = prepareBundledPython;

if (require.main === module) {
  prepareBundledPython();
}
