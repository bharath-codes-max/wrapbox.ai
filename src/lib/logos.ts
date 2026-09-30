// Real vendor marks, bundled with the page (sources: LobeHub icons, svgl, simple-icons, vendor GitHub orgs).
const files = import.meta.glob("../assets/logos/*.{svg,png}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const byName: Record<string, string> = {};
for (const [path, url] of Object.entries(files)) {
  const base = path.split("/").pop()!.replace(/\.(svg|png)$/, "");
  byName[base] = url;
}

export const logoUrl = (name: string) => byName[name] ?? byName["mcp"];
