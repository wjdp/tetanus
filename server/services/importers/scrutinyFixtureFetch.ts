import type { FetchImpl } from "~~/server/services/importers/scrutinyApi";
import { readFixture } from "~~/test/fixtures";

export const SCRUTINY_TEST_URL = "http://scrutiny.test";

export const ATA_KEY = "0x5000ccad5ed6ee0c";
export const NVME_KEY = "453939583131";
export const UNMATCHED_KEY = "0x5000c50bd5ec0ece";

const DETAILS_FIXTURES: Record<string, string> = {
  [ATA_KEY]: "details-ata.json",
  [NVME_KEY]: "details-nvme.json",
  [UNMATCHED_KEY]: "details-unmatched.json",
};

export type FixtureOverrides = Record<string, string | Response>;

function scrutinyFixturePath(url: URL): string | undefined {
  const path = url.pathname.replace(/^\/api\//, "");
  if (path === "summary") return "summary.json";
  if (path === "summary/temp") return "summary-temp.json";
  const details = /^device\/([^/]+)\/details$/.exec(path);
  return details ? DETAILS_FIXTURES[decodeURIComponent(details[1])] : undefined;
}

// Serves test/fixtures/scrutiny-api by path; overrides, keyed by pathname,
// replace a body or the whole response.
export function scrutinyFixtureFetch(
  overrides: FixtureOverrides = {},
): FetchImpl & { requests: URL[] } {
  const requests: URL[] = [];
  const stub = async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input);
    requests.push(url);
    const override = overrides[url.pathname];
    if (override instanceof Response) return override;
    if (override !== undefined) return new Response(override);
    const fixture = scrutinyFixturePath(url);
    if (!fixture) return new Response("not found", { status: 404 });
    return new Response(readFixture(`scrutiny-api/${fixture}`));
  };
  return Object.assign(stub as FetchImpl, { requests });
}
