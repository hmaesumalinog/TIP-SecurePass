// Adds a short content hash (?v=...) to every local asset reference in the
// published pages and scripts. A changed file gets a new URL, which lets
// browsers cache assets for a year (see netlify.toml) and still pick up every
// change immediately. Run "npm run version-assets" after editing anything in
// public/assets; "npm test" fails if a reference is out of date.
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ASSET_REF =
  /((?:\.\.\/|\/)?assets\/)([A-Za-z0-9_./-]+\.(?:css|js|mjs|svg|png|jpe?g|webp|ico))(?:\?v=[A-Za-z0-9]+)?/g;
const MODULE_IMPORT =
  /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(\.\.?\/[^"'?#]+)(?:\?v=[A-Za-z0-9]+)?\2/g;

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    }),
  );
  return nested.flat();
}

const digest = (content) =>
  createHash("sha256").update(content).digest("hex").slice(0, 10);

export async function versionAssets({
  root = resolve("public"),
  write = true,
} = {}) {
  const assets = join(root, "assets");
  const files = await walk(root);
  const sources = new Map();
  for (const file of files)
    if (/\.(html|css|js|mjs)$/.test(file))
      sources.set(file, await readFile(file, "utf8"));
  const hashes = new Map();
  const pending = new Set();
  const updated = new Map();

  async function hashOf(file) {
    if (hashes.has(file)) return hashes.get(file);
    if (pending.has(file))
      throw new Error(`Circular module import: ${relative(root, file)}`);
    pending.add(file);
    let content = sources.has(file)
      ? await rewrite(file, sources.get(file))
      : await readFile(file);
    pending.delete(file);
    const hash = digest(content);
    hashes.set(file, hash);
    return hash;
  }

  async function rewrite(file, source) {
    let output = source;
    // Page-relative or root-relative asset URLs, in HTML and script strings.
    const references = [...source.matchAll(ASSET_REF)];
    for (const [, prefix, rest] of references) await hashOf(join(assets, rest));
    output = output.replace(
      ASSET_REF,
      (match, prefix, rest) =>
        `${prefix}${rest}?v=${hashes.get(join(assets, rest))}`,
    );
    if (/\.m?js$/.test(file)) {
      // Module imports resolve relative to the importing file.
      const imports = [...output.matchAll(MODULE_IMPORT)];
      for (const [, , , specifier] of imports)
        await hashOf(resolve(dirname(file), specifier));
      output = output.replace(
        MODULE_IMPORT,
        (match, keyword, quote, specifier) =>
          `${keyword}${quote}${specifier}?v=${hashes.get(resolve(dirname(file), specifier))}${quote}`,
      );
    }
    if (output !== source) updated.set(file, output);
    return output;
  }

  for (const file of sources.keys())
    if (file.startsWith(assets + sep)) await hashOf(file);
  for (const [file, source] of sources)
    if (file.endsWith(".html")) await rewrite(file, source);
  if (write)
    for (const [file, content] of updated) await writeFile(file, content);
  return [...updated.keys()].map((file) => relative(root, file)).sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const changed = await versionAssets();
  console.log(
    changed.length
      ? `Updated asset versions in ${changed.length} files.`
      : "Asset versions are current.",
  );
}
