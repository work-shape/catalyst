import { RELEASE_VERSION, type PlatformDocs } from "@work-shape/catalyst-api-contract";

/** SemVer precedence: build metadata does not affect it; numeric prerelease parts sort numerically. */
function versionParts(version: string) {
  const number = "(?:0|[1-9][0-9]*)";
  const identifier = `(?:${number}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`;
  const match = new RegExp(
    `^(${number})\\.(${number})\\.(${number})(?:-(${identifier}(?:\\.${identifier})*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`,
    "u"
  ).exec(version);
  return match && match[0] === version
    ? {
        numbers: {
          major: BigInt(match[1] ?? "0"),
          minor: BigInt(match[2] ?? "0"),
          patch: BigInt(match[3] ?? "0")
        },
        prerelease: match[4]?.split(".") ?? []
      }
    : undefined;
}

function older(left: string, right: string): boolean {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) return false;
  for (const part of ["major", "minor", "patch"] as const) {
    if (a.numbers[part] !== b.numbers[part]) return a.numbers[part] < b.numbers[part];
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length > 0 && b.prerelease.length === 0;
  }
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i += 1) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined;
    const numericX = /^[0-9]+$/u.test(x);
    const numericY = /^[0-9]+$/u.test(y);
    if (numericX && numericY) return BigInt(x) < BigInt(y);
    if (numericX !== numericY) return numericX;
    return x < y;
  }
  return false;
}

export function cliVersionNotice(cliVersion: string | undefined): string | undefined {
  return cliVersion !== undefined && older(RELEASE_VERSION, cliVersion)
    ? `This CLI is ${RELEASE_VERSION}; the instance names ${cliVersion}: npm install --global @work-shape/catalyst-cli@${cliVersion}`
    : undefined;
}

export function formatDocs(docs: PlatformDocs): string {
  if ("markdown" in docs) return docs.markdown;
  const sections = new Map<string, string[]>();
  for (const page of docs.pages) {
    const section = page.path.includes("/") ? page.path.slice(0, page.path.indexOf("/")) : "Pages";
    const pages = sections.get(section) ?? [];
    pages.push(`  ${page.path}  ${page.title}: ${page.description}`);
    sections.set(section, pages);
  }
  return [...sections].map(([section, pages]) => `${section}\n${pages.join("\n")}`).join("\n\n");
}

/** CLI and server ship one contract per release; build metadata does not change it. */
export function cliCompatibilityError(
  cliVersion: string,
  serverVersion: string
): Error | undefined {
  if (!versionParts(cliVersion) || !versionParts(serverVersion)) {
    return new Error(
      "The instance did not report a valid release version; check its address with 'catalyst doctor'."
    );
  }
  return cliVersion.split("+")[0] === serverVersion.split("+")[0]
    ? undefined
    : new CliVersionError(cliVersion, serverVersion);
}

export class CliVersionError extends Error {
  constructor(
    readonly cliVersion: string,
    readonly serverVersion: string
  ) {
    super(
      `Catalyst CLI ${cliVersion} does not match server ${serverVersion}; run: npm install --global @work-shape/catalyst-cli@${serverVersion.split("+")[0]}`
    );
    this.name = "CliVersionError";
  }
}
