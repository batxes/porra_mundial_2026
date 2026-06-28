import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const defaultDir = path.join(projectRoot, "public", "trainer-cards");

const options = parseArgs(process.argv.slice(2));
const targetDir = options.dir
  ? path.resolve(projectRoot, options.dir)
  : defaultDir;

if (!isPathInside(projectRoot, targetDir)) {
  throw new Error(`Target directory must be inside ${projectRoot}`);
}

if (options.help) {
  printHelp();
  process.exit(0);
}

const files = (await readdir(targetDir))
  .filter((fileName) => fileName.toLowerCase().endsWith(".png"))
  .sort((a, b) => a.localeCompare(b));

if (files.length === 0) {
  console.log(`No PNG files found in ${path.relative(projectRoot, targetDir)}`);
  process.exit(0);
}

let totalInputBytes = 0;
let totalOutputBytes = 0;

for (const fileName of files) {
  const inputPath = path.join(targetDir, fileName);
  const outputPath = path.join(
    targetDir,
    fileName.replace(/\.png$/i, ".webp"),
  );
  const inputBytes = (await stat(inputPath)).size;

  await sharp(inputPath)
    .webp(
      options.lossless
        ? { lossless: true, effort: 6 }
        : { quality: options.quality, effort: 6 },
    )
    .toFile(outputPath);

  const outputBytes = (await stat(outputPath)).size;
  totalInputBytes += inputBytes;
  totalOutputBytes += outputBytes;

  if (options.deleteOriginals) {
    await unlink(inputPath);
  }

  console.log(
    `${fileName} -> ${path.basename(outputPath)} (${formatBytes(inputBytes)} -> ${formatBytes(outputBytes)})`,
  );
}

const savedBytes = totalInputBytes - totalOutputBytes;
const savedPercent =
  totalInputBytes > 0 ? Math.round((savedBytes / totalInputBytes) * 100) : 0;

console.log(
  `Converted ${files.length} files. Saved ${formatBytes(savedBytes)} (${savedPercent}%).`,
);

function parseArgs(args) {
  const parsed = {
    deleteOriginals: false,
    dir: "",
    help: false,
    lossless: false,
    quality: 88,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--delete-originals") {
      parsed.deleteOriginals = true;
    } else if (arg === "--dir") {
      const value = args[index + 1];
      if (!value) throw new Error("--dir needs a relative path");
      parsed.dir = value;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--lossless") {
      parsed.lossless = true;
    } else if (arg === "--quality") {
      const value = Number(args[index + 1]);
      if (!Number.isInteger(value) || value < 1 || value > 100) {
        throw new Error("--quality needs an integer from 1 to 100");
      }
      parsed.quality = value;
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

function isPathInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function printHelp() {
  console.log(`
Usage:
  npm run convert:trainer-cards -- [options]

Options:
  --quality <1-100>     WebP quality for lossy output. Default: 88.
  --lossless            Write lossless WebP files instead of lossy files.
  --delete-originals    Remove PNG files after each successful conversion.
  --dir <path>          Convert PNG files in another project-relative folder.
`);
}
