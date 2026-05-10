/**
 * Prepare aionrs binary for Electron packaging.
 *
 * Resolution order:
 *  1. Local cache / installed app binary
 *  2. GitHub release download (requires AIONRS_VERSION or defaults to "latest")
 *
 * Output: resources/bundled-aionrs/{platform}-{arch}/aionrs[.exe]
 *
 * Pattern follows prepareBundledBun.js.
 */

const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const GITHUB_OWNER = 'iOfficeAI';
const GITHUB_REPO = 'aionrs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function removeDirectorySafe(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function copyFileSafe(sourcePath, targetPath) {
  ensureDirectory(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

function ensureExecutableMode(filePath) {
  if (process.platform === 'win32') return;
  try {
    fs.chmodSync(filePath, 0o755);
  } catch {}
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
}

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function getBinaryName(platform) {
  return platform === 'win32' ? 'aionrs.exe' : 'aionrs';
}

function getVersion() {
  return (process.env.AIONRS_VERSION || 'latest').trim();
}

function getCacheRootDir() {
  const custom = process.env.WEPULSE_HERMES_AIONRS_CACHE_DIR || process.env.AIONRS_CACHE_DIR;
  if (custom && custom.trim()) {
    return path.resolve(custom.trim());
  }

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, 'WePulse-Hermes', 'cache', 'bundled-aionrs');
  }

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Caches', 'WePulse-Hermes', 'bundled-aionrs');
  }

  const xdgCacheHome = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(xdgCacheHome, 'WePulse-Hermes', 'bundled-aionrs');
}

function getCacheRuntimeDir(tag, runtimeKey) {
  return path.join(getCacheRootDir(), tag, runtimeKey);
}

function getCacheMetaPath(cacheRuntimeDir) {
  return path.join(cacheRuntimeDir, 'manifest.json');
}

function isUsableBinary(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile() && fs.statSync(filePath).size > 0;
  } catch {
    return false;
  }
}

function copyBinaryToDirectory(sourcePath, targetDir, binaryName) {
  const targetPath = path.join(targetDir, binaryName);
  copyFileSafe(sourcePath, targetPath);
  ensureExecutableMode(targetPath);
  return targetPath;
}

function resolveLocalBinary(projectRoot, platform, arch, runtimeKey, binaryName) {
  const configured = process.env.WEPULSE_HERMES_AIONRS_PATH || process.env.AIONRS_PATH;
  const candidates = [];

  if (configured && configured.trim()) {
    const configuredPath = path.resolve(configured.trim());
    candidates.push(
      fs.existsSync(configuredPath) && fs.statSync(configuredPath).isDirectory()
        ? path.join(configuredPath, binaryName)
        : configuredPath
    );
  }

  candidates.push(path.join(projectRoot, 'resources', 'bundled-aionrs', runtimeKey, binaryName));

  if (platform === process.platform && arch === process.arch) {
    if (platform === 'darwin') {
      candidates.push(
        path.join(
          '/Applications',
          'WePulse-Hermes.app',
          'Contents',
          'Resources',
          'bundled-aionrs',
          runtimeKey,
          binaryName
        )
      );
    }
  }

  return candidates.find(isUsableBinary) || null;
}

// ---------------------------------------------------------------------------
// Source resolvers
// ---------------------------------------------------------------------------

/**
 * Resolve the actual version tag when "latest" is requested.
 * Uses GitHub API via `gh` CLI (needs GH_TOKEN in CI) or falls back to
 * `curl` with an optional Authorization header (GITHUB_TOKEN / GH_TOKEN).
 */
function resolveLatestTag() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';

  // 1. Try gh CLI (honours GH_TOKEN automatically)
  try {
    const out = execSync(`gh api repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest --jq .tag_name`, {
      encoding: 'utf-8',
      timeout: 15000,
    }).trim();
    if (out) return out;
  } catch {
    // gh CLI not available or no token — fall back to curl
  }

  // 2. Curl with optional token to avoid rate-limit 403
  try {
    const authArgs = token ? ['-H', `Authorization: token ${token}`] : [];
    const args = ['-fsSL', ...authArgs, `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`];
    const out = execFileSync('curl', args, { encoding: 'utf-8', timeout: 15000 });
    const tag = JSON.parse(out).tag_name;
    if (tag) return tag;
  } catch {
    // network issue or rate-limited
  }

  return null;
}

/**
 * 1. Download from GitHub releases
 *
 * aionrs release assets include the version tag in the filename:
 *   aionrs-v0.1.9-aarch64-apple-darwin.tar.gz
 */
function getAssetName(platform, arch, tag) {
  const archMap = { x64: 'x86_64', arm64: 'aarch64' };
  const platformMap = { darwin: 'apple-darwin', linux: 'unknown-linux-gnu', win32: 'pc-windows-msvc' };
  const normalizedArch = archMap[arch];
  const normalizedPlatform = platformMap[platform];
  if (!normalizedArch || !normalizedPlatform) return null;
  const ext = platform === 'win32' ? '.zip' : '.tar.gz';
  return `aionrs-${tag}-${normalizedArch}-${normalizedPlatform}${ext}`;
}

function getDownloadUrl(assetName, tag) {
  return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/${tag}/${assetName}`;
}

function downloadFile(url, outputPath) {
  console.log(`  Downloading aionrs from ${url}`);
  if (process.platform === 'win32') {
    const ps = `$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '${url}' -OutFile '${outputPath.replace(/'/g, "''")}'`;
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 120000 });
    return;
  }
  try {
    execFileSync('curl', ['-L', '--fail', '--silent', '--show-error', '-o', outputPath, url], { timeout: 120000 });
  } catch {
    execFileSync('wget', ['-q', '-O', outputPath, url], { timeout: 120000 });
  }
}

function extractArchive(archivePath, outputDir, platform) {
  ensureDirectory(outputDir);
  if (platform === 'win32' || archivePath.endsWith('.zip')) {
    if (platform === 'win32') {
      const ps = `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${outputDir.replace(/'/g, "''")}' -Force`;
      execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]);
    } else {
      execFileSync('unzip', ['-o', archivePath, '-d', outputDir]);
    }
  } else {
    execFileSync('tar', ['-xzf', archivePath, '-C', outputDir]);
  }
}

function findBinaryInDir(dir, binaryName) {
  // Search recursively for the binary
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === binaryName) return fullPath;
    if (entry.isDirectory()) {
      const found = findBinaryInDir(fullPath, binaryName);
      if (found) return found;
    }
  }
  return null;
}

function downloadAndExtract(platform, arch, tag) {
  const assetName = getAssetName(platform, arch, tag);
  if (!assetName) {
    throw new Error(`Unsupported aionrs target: ${platform}-${arch}`);
  }

  const url = getDownloadUrl(assetName, tag);
  const tempDir = path.join(os.tmpdir(), 'aionui-aionrs', tag, `${platform}-${arch}`);
  const archivePath = path.join(tempDir, assetName);
  const extractDir = path.join(tempDir, 'extracted');

  removeDirectorySafe(tempDir);
  ensureDirectory(tempDir);

  downloadFile(url, archivePath);
  extractArchive(archivePath, extractDir, platform);

  const binaryName = getBinaryName(platform);
  const binaryPath = findBinaryInDir(extractDir, binaryName);
  if (!binaryPath) {
    throw new Error(`Binary ${binaryName} not found in downloaded archive`);
  }

  return { binaryPath, tempDir, url };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function prepareAionrs() {
  const projectRoot = path.resolve(__dirname, '..');
  const platform = process.platform;
  // Support cross-compilation: AIONRS_ARCH > npm_config_target_arch > process.arch
  const arch = process.env.AIONRS_ARCH || process.env.npm_config_target_arch || process.arch;
  const runtimeKey = `${platform}-${arch}`;
  const version = getVersion();

  // Resolve the actual version tag — asset filenames include the tag
  let tag;
  if (version === 'latest') {
    const resolved = resolveLatestTag();
    if (!resolved) {
      throw new Error('Failed to resolve latest aionrs release tag from GitHub API');
    }
    tag = resolved;
    console.log(`Resolved aionrs "latest" → ${tag}`);
  } else {
    tag = version.startsWith('v') ? version : `v${version}`;
  }

  const targetDir = path.join(projectRoot, 'resources', 'bundled-aionrs', runtimeKey);
  const binaryName = getBinaryName(platform);
  const targetBinaryPath = path.join(targetDir, binaryName);
  const cacheRuntimeDir = getCacheRuntimeDir(tag, runtimeKey);
  const cacheBinaryPath = path.join(cacheRuntimeDir, binaryName);

  console.log(`Preparing aionrs for ${runtimeKey} (version: ${tag})`);

  let sourcePath = null;
  let sourceType = 'none';
  let sourceDetail = {};
  let tempDir = null;

  // 1. Reuse cache first. GitHub release downloads are frequently slow in CN networks.
  if (!sourcePath && isUsableBinary(cacheBinaryPath)) {
    const cacheMeta = readJsonSafe(getCacheMetaPath(cacheRuntimeDir));
    sourcePath = cacheBinaryPath;
    sourceType = 'cache';
    sourceDetail = {
      dir: cacheRuntimeDir,
      origin: cacheMeta?.source || {},
    };
    console.log(`  Reusing cached aionrs binary`);
  }

  // 2. Reuse a local installed/dev bundle when building for the current platform.
  if (!sourcePath) {
    const localBinary = resolveLocalBinary(projectRoot, platform, arch, runtimeKey, binaryName);
    if (localBinary) {
      removeDirectorySafe(cacheRuntimeDir);
      ensureDirectory(cacheRuntimeDir);
      sourcePath = copyBinaryToDirectory(localBinary, cacheRuntimeDir, binaryName);
      sourceType = 'local';
      sourceDetail = { path: localBinary };
      writeJson(getCacheMetaPath(cacheRuntimeDir), {
        platform,
        arch,
        version: tag,
        generatedAt: new Date().toISOString(),
        sourceType,
        source: sourceDetail,
        files: [binaryName],
        skipped: false,
      });
      console.log(`  Reusing local aionrs binary from ${localBinary}`);
    }
  }

  // 3. Download from GitHub releases
  if (!sourcePath) {
    try {
      const result = downloadAndExtract(platform, arch, tag);
      removeDirectorySafe(cacheRuntimeDir);
      ensureDirectory(cacheRuntimeDir);
      sourcePath = copyBinaryToDirectory(result.binaryPath, cacheRuntimeDir, binaryName);
      tempDir = result.tempDir;
      sourceType = 'download';
      sourceDetail = { url: result.url };
      writeJson(getCacheMetaPath(cacheRuntimeDir), {
        platform,
        arch,
        version: tag,
        generatedAt: new Date().toISOString(),
        sourceType,
        source: sourceDetail,
        files: [binaryName],
        skipped: false,
      });
      console.log(`  Downloaded from GitHub releases`);
    } catch (error) {
      console.warn(`  Download failed: ${error.message}`);
    }
  }

  // Write result
  if (sourcePath) {
    removeDirectorySafe(targetDir);
    ensureDirectory(targetDir);
    copyFileSafe(sourcePath, targetBinaryPath);
    ensureExecutableMode(targetBinaryPath);

    // Get version info from binary
    let binaryVersion = tag;
    try {
      binaryVersion = execSync(`"${targetBinaryPath}" --version`, { encoding: 'utf-8', timeout: 5000 }).trim();
    } catch {}

    const manifest = {
      platform,
      arch,
      version: binaryVersion,
      generatedAt: new Date().toISOString(),
      sourceType,
      source: sourceDetail,
      files: [binaryName],
      skipped: false,
    };

    writeJson(path.join(targetDir, 'manifest.json'), manifest);
    console.log(
      `  Bundled aionrs prepared: resources/bundled-aionrs/${runtimeKey}/${binaryName} [source=${sourceType}]`
    );

    if (tempDir) removeDirectorySafe(tempDir);
    return { prepared: true, dir: targetDir, sourceType };
  }

  // Not found — write skip manifest (non-fatal, like bundled-bun)
  removeDirectorySafe(targetDir);
  ensureDirectory(targetDir);
  const manifest = {
    platform,
    arch,
    version: tag,
    generatedAt: new Date().toISOString(),
    sourceType: 'none',
    source: {},
    files: [],
    skipped: true,
    reason: 'aionrs binary not found (ensure GitHub release exists)',
  };

  writeJson(path.join(targetDir, 'manifest.json'), manifest);
  console.warn(`  aionrs not found — skipping bundle (agent will not be available in packaged app)`);
  return { prepared: false, reason: 'not_found' };
}

module.exports = prepareAionrs;
