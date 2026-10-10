import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { fetchStats, renderStats, type Stats } from "./stats.ts";

const SITE = "https://glpecile.xyz";
type Page = "Home" | "Work" | "Blog" | "Films";
type Documents = Record<Page, string>;
type Link = { title: string; url: string };
type Post = Link & { date: string; description?: string; image?: string };
type Film = Post & { year: string; image?: string };

export function gravatar(email: string): string {
  const hash = createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
  return `https://gravatar.com/avatar/${hash}?s=192&d=mp`;
}

export function httpsUrl(value: string, sameSite = false): string {
  const url = new URL(value, SITE);
  if (url.protocol !== "https:" || url.username || url.password || (sameSite && url.origin !== SITE)) {
    throw new Error(`Unexpected source URL: ${value}`);
  }
  return url.href.replace(/\(/g, "%28").replace(/\)/g, "%29");
}

export function discoverPages(guide: string): Record<Page, string> {
  const pages = {} as Record<Page, string>;
  for (const name of ["Home", "Work", "Blog", "Films"] as const) {
    const match = guide.match(new RegExp(`\\[${name}\\]\\(([^\\s)]+)\\)`));
    if (!match) throw new Error(`llms.txt is missing the ${name} markdown link`);
    const url = httpsUrl(match[1]!, true);
    if (!new URL(url).pathname.endsWith(".md")) throw new Error(`${name} must link to Markdown`);
    pages[name] = url;
  }
  return pages;
}

function section(markdown: string, heading: string): string {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const start = lines.indexOf(`## ${heading}`);
  if (start === -1) throw new Error(`Missing source section: ${heading}`);
  const end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
}

function required(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`Missing source data: ${label}`);
  return value.trim();
}

function validDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid source date: ${value}`);
  }
  return value;
}

function canonical(url: string): string {
  const parsed = new URL(httpsUrl(url, true));
  parsed.pathname = parsed.pathname.replace(/\/index\.html\.md$/, "") || "/";
  return parsed.href;
}

export function parseSite(documents: Documents) {
  const name = required(documents.Home.match(/^# (.+)$/m)?.[1], "name");
  const bio = required(documents.Home.match(/^> (.+)$/m)?.[1], "bio");
  const currentRole = required(documents.Home.match(/^- Current role: (.+)$/m)?.[1], "current role");
  const role = currentRole.match(/^(.+?) @ \[([^\]]+)\]\(([^)]+)\)$/);
  if (!role) throw new Error("Current role must contain a title and linked employer");
  const employment = section(documents.Work, "Roles").split("\n").find((line) => line.startsWith(`- ${currentRole} — `));
  const location = required(employment?.split(" — ")[2], "current role location");
  const navigation = (["Home", "Work", "Blog"] as const).map((page) => ({
    title: { Home: "Website", Work: "Work", Blog: "Writing" }[page],
    url: httpsUrl(required(documents[page].match(/^- Canonical HTML: (.+)$/m)?.[1], `${page} canonical URL`), true),
  }));

  const writing: Post[] = [];
  for (const line of section(documents.Blog, "Posts").split("\n")) {
    if (!line.startsWith("- ")) continue;
    const match = line.match(/^- \[([^\]]+)\]\(([^)]+)\) — (\S+) — (.+)$/);
    if (!match) throw new Error(`Unrecognized blog entry: ${line}`);
    writing.push({ title: match[1]!, url: canonical(match[2]!), date: validDate(match[3]!), description: match[4]! });
  }

  const films: Film[] = [];
  for (const line of section(documents.Films, "Recently watched").split("\n")) {
    if (!line.startsWith("- ")) continue;
    const match = line.match(/^- (\S+) — \[([^\]]+)\]\(([^)]+)\) \((\d{4})\)$/);
    if (!match) throw new Error(`Unrecognized film entry: ${line}`);
    films.push({ title: match[2]!, url: httpsUrl(match[3]!), date: validDate(match[1]!), year: match[4]! });
  }
  if (!writing.length || !films.length) throw new Error("Writing or film export is empty; keeping the existing README");

  const links: Link[] = [];
  for (const line of section(documents.Home, "Public links").split("\n")) {
    const match = line.match(/^- \[([^\]]+)\]\(([^)]+)\)$/);
    if (match && match[1] !== "GitHub") links.push({ title: match[1]!, url: httpsUrl(match[2]!) });
  }
  if (!links.length) throw new Error("No public links found in home export");
  return {
    name, bio, title: role[1]!, employer: { title: role[2]!, url: httpsUrl(role[3]!) }, location,
    writing: writing.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4),
    films: films.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4),
    links, navigation,
  };
}

function html(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!).replace(/[\r\n]+/g, " ");
}

function text(value: string): string {
  return html(value).replace(/([\\`*_{}\[\]|#!])/g, "\\$1");
}

const link = (item: Link) => `[${text(item.title)}](${item.url})`;
const date = (value: string) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value));
const anchor = (item: Link) => `<a href="${html(item.url)}">${html(item.title)}</a>`;

export function withPosters(data: ReturnType<typeof parseSite>, payload: unknown): ReturnType<typeof parseSite> {
  if (!payload || typeof payload !== "object" || !("films" in payload) || !Array.isArray(payload.films)) {
    throw new Error("Invalid film poster feed; keeping the existing README");
  }
  const images = new Map<string, string>();
  for (const film of payload.films) {
    if (film && typeof film.url === "string" && typeof film.image === "string" && film.image) {
      images.set(httpsUrl(film.url), httpsUrl(film.image));
    }
  }
  return { ...data, films: data.films.map((film) => ({ ...film, image: images.get(film.url) })) };
}

export function renderReadme(data: ReturnType<typeof parseSite>, stats?: Stats): string {
  const writing = data.writing.slice(0, 4).map((post) => `<td width="25%" valign="top">
${post.image ? `<a href="${html(post.url)}"><img src="${html(post.image)}" width="200" alt="${html(post.title)} — article preview"></a>` : ""}
<p><strong>${anchor(post)}</strong><br><samp>${html(date(post.date))}</samp></p>
</td>`).join("\n");
  const films = data.films.map((film) => `<td width="25%" align="center" valign="top">\n${film.image ? `<a href="${html(film.url)}"><img src="${html(film.image)}" width="120" height="180" alt="${html(film.title)} (${film.year}) poster" loading="lazy"></a>\n` : ""}<p><strong>${anchor(film)}</strong><br><samp>${film.year} · ${html(date(film.date))}</samp></p>\n</td>`).join("\n");
  return `<!-- Generated daily at 04:17 UTC from ${SITE}/llms.txt by today.ts. Edit the website content, not this file. -->
<a href="${html(data.navigation[0]!.url)}"><img align="right" src="${html(gravatar("glpecile@gmail.com"))}" width="96" height="96" alt="${html(data.name)}'s Gravatar"></a>

# ${text(data.name)}

**${text(data.title)} @ ${link(data.employer)}**<br>${text(data.location)}

${text(data.bio)}

${data.navigation.map((item, i) => i === 0 ? `**${link(item)}**` : link(item)).join(" · ")}

## Writing

<table>
<tr>
${writing}
</tr>
</table>

${stats ? `## GitHub

<a href="https://github.com/glpecile?tab=overview">
<picture>
  <source media="(prefers-reduced-motion: reduce) and (prefers-color-scheme: dark)" srcset="./assets/github-dark-static.svg">
  <source media="(prefers-reduced-motion: reduce)" srcset="./assets/github-light-static.svg">
  <source media="(prefers-color-scheme: dark)" srcset="./assets/github-dark.svg">
  <img src="./assets/github-light.svg" width="900" alt="GitHub activity: ${stats.contributions.toLocaleString("en-US")} contributions, ${stats.activeDays} active days, ${stats.repositories} public repositories, ${stats.followers} followers. Weekly contribution skyline from ${stats.from} to ${stats.to}.">
</picture>
</a>

` : ""}## Recently watched

<table>
<tr>
${films}
</tr>
</table>

${data.links.map(link).join(" · ")}
`;
}

export function ogImage(page: string, url: string): string {
  for (const tag of page.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = Object.fromEntries([...tag[0].matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)].map((match) => [match[1]!.toLowerCase(), match[3]!]));
    if (attributes.property?.toLowerCase() === "og:image" && attributes.content) {
      const value = attributes.content.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      return httpsUrl(new URL(value, url).href, true);
    }
  }
  throw new Error(`Missing article OG image: ${url}`);
}

export async function withArticleImages(data: ReturnType<typeof parseSite>, fetcher: (url: string, options?: RequestInit) => Promise<Response> = fetch): Promise<ReturnType<typeof parseSite>> {
  const writing = await Promise.all(data.writing.map(async (post) => {
    let url = post.url;
    let response: Response | undefined;
    const signal = AbortSignal.timeout(15_000);
    for (let redirects = 0; redirects <= 3; redirects++) {
      response = await fetcher(url, { redirect: "manual", signal });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("Location");
      if (!location || redirects === 3) throw new Error("Invalid article redirect");
      url = httpsUrl(new URL(location, url).href, true);
    }
    if (!response) throw new Error("Missing article response");
    if (!response.ok) throw new Error(`Fetching article preview failed: HTTP ${response.status}`);
    const page = await response.text();
    if (page.length > 2_000_000) throw new Error("Article HTML is too large");
    return { ...post, image: ogImage(page, url) };
  }));
  return { ...data, writing };
}

export async function fetchArticleImage(url: string, fetcher: (url: string, options?: RequestInit) => Promise<Response> = fetch): Promise<Uint8Array> {
  const response = await fetcher(httpsUrl(url, true), { redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Fetching OG image failed: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length > 5_000_000 || !signature.every((byte, i) => bytes[i] === byte)) throw new Error("Invalid OG PNG image");
  return bytes;
}

export async function fetchPosters(fetcher: (url: string, options?: RequestInit) => Promise<Response> = fetch): Promise<unknown> {
  const response = await fetcher(`${SITE}/api/films.json`, { redirect: "error", signal: AbortSignal.timeout(15_000), headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Fetching film posters failed: HTTP ${response.status}`);
  const body = await response.text();
  if (!body.trim() || body.length > 1_000_000) throw new Error("Invalid film poster response");
  return JSON.parse(body);
}

export async function fetchSite(fetcher: (url: string, options?: RequestInit) => Promise<Response> = fetch): Promise<Documents> {
  async function markdown(url: string) {
    const response = await fetcher(url, { redirect: "error", signal: AbortSignal.timeout(15_000), headers: { Accept: "text/markdown, text/plain" } });
    if (!response.ok) throw new Error(`Fetching ${url} failed: HTTP ${response.status}`);
    const body = await response.text();
    if (!body.trim() || body.length > 1_000_000) throw new Error(`Invalid Markdown response from ${url}`);
    return body;
  }
  const pages = discoverPages(await markdown(`${SITE}/llms.txt`));
  const entries = await Promise.all(Object.entries(pages).map(async ([name, url]) => [name, await markdown(url)] as const));
  return Object.fromEntries(entries) as Documents;
}

if (import.meta.main) {
  try {
    let token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
    if (!token) {
      const auth = Bun.spawn(["gh", "auth", "token"], { stdout: "pipe", stderr: "ignore" });
      token = (await new Response(auth.stdout).text()).trim();
      if (await auth.exited || !token) throw new Error("Set GH_TOKEN or sign in with gh auth login to fetch GitHub stats");
    }
    const [documents, posters, stats] = await Promise.all([fetchSite(), fetchPosters(), fetchStats(token)]);
    const data = await withArticleImages(withPosters(parseSite(documents), posters));
    const previews = await Promise.all(data.writing.map((post) => fetchArticleImage(post.image!)));
    await mkdir("assets", { recursive: true });
    for (const [i, bytes] of previews.entries()) {
      const path = `./assets/article-${i + 1}.png`;
      await Bun.write(path, bytes);
      data.writing[i]!.image = path;
    }
    for (const dark of [false, true]) {
      for (const animated of [false, true]) {
        await Bun.write(`assets/github-${dark ? "dark" : "light"}${animated ? "" : "-static"}.svg`, renderStats(stats, dark, animated));
      }
    }
    await Bun.write("README.md", renderReadme(data, stats));
    console.log(`README refreshed from ${SITE}: ${data.writing.length} posts, ${data.films.length} films`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
