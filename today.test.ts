import { expect, test } from "bun:test";
import { discoverPages, fetchArticleImage, fetchPosters, fetchSite, gravatar, httpsUrl, ogImage, parseSite, renderReadme, withArticleImages, withPosters } from "./today.ts";
import { fetchStats, parseStats, renderStats } from "./stats.ts";

const guide = ["Home", "Work", "Blog", "Films"].map((name) => `- [${name}](https://glpecile.xyz/${name.toLowerCase()}/index.html.md)`).join("\n");
const documents = {
  Home: `# Gian Luca Pecile
> Frontend engineer focused on design systems.
- Canonical HTML: https://glpecile.xyz/
- Current role: Senior Frontend Engineer @ [Humand](https://humand.co)
## Public links
- [GitHub](https://github.com/glpecile)
- [Bluesky](https://bsky.app/profile/glpecile.xyz)
`,
  Work: `# Work
- Canonical HTML: https://glpecile.xyz/work
## Roles
- Senior Frontend Engineer @ [Humand](https://humand.co) — Sep 2026 - Present — Buenos Aires · Hybrid
  - Job description, not another role.
## Projects
- [Personal site](https://glpecile.xyz) — Astro
- [shinobu](https://github.com/glpecile/shinobu) — React Native / Expo
  - Description, not another project.
- [srt-cli](https://github.com/glpecile/srt-cli) — TypeScript / Bun
## Skills
- Frontend: React
`,
  Blog: `# Blog
- Canonical HTML: https://glpecile.xyz/blog
## Posts
- [Older post](https://glpecile.xyz/blog/older/index.html.md) — 2026-05-18 — Description.
- [Newer post](https://glpecile.xyz/blog/newer/index.html.md) — 2026-07-18 — Description.
`,
  Films: `# Films
- Canonical HTML: https://glpecile.xyz/films
## Recently watched
- 2026-10-04 — [Vampire Hunter D](https://letterboxd.com/glp/film/vampire-hunter-d/) (1985)
- 2026-10-06 — [Spider-Man](https://letterboxd.com/glp/film/spider-man/) (2026)
[View all](https://letterboxd.com/Glp/)
`,
};

test("discover and process source data, sort dates, and link to human-readable articles", () => {
  expect(discoverPages(guide).Work).toBe("https://glpecile.xyz/work/index.html.md");
  const data = parseSite(documents);
  expect(data.title).toBe("Senior Frontend Engineer");
  expect(data.location).toBe("Buenos Aires · Hybrid");
  expect(data.writing[0]?.url).toBe("https://glpecile.xyz/blog/newer");
  expect(data.films[0]?.title).toBe("Spider-Man");
  const readme = renderReadme(data);
  expect(readme).toContain("**Senior Frontend Engineer @ [Humand](https://humand.co/)**");
  expect(readme).toContain("[Bluesky](https://bsky.app/profile/glpecile.xyz)");
  expect(readme).toContain("gravatar.com/avatar/");
  expect(readme).not.toContain("glpecile@gmail.com");
  expect(readme).toContain("Generated daily at 04:17 UTC");
  expect(readme).not.toContain("whoami");
  expect(readme).toContain('<td width="25%" valign="top">');
  expect(readme).not.toContain("Slot");
  expect(readme).not.toContain("## Projects");
  expect(readme).not.toContain("<summary>Source</summary>");
  expect(readme).not.toContain("https://glpecile.xyz/films");
  expect(readme).not.toContain("undefined");
  expect(parseSite({ ...documents, Work: documents.Work.split("## Projects")[0]! }).title).toBe("Senior Frontend Engineer");
  expect(renderReadme(parseSite({ ...documents, Home: documents.Home.replace("Gian Luca Pecile", "Updated name") }))).toContain("# Updated name");
});

test("article thumbnails come from OG metadata and retain source descriptions", async () => {
  const data = parseSite(documents);
  const image = "https://glpecile.xyz/blog/newer/preview?a=1&b=2";
  const page = '<meta content="/blog/newer/preview?a=1&amp;b=2" property="og:image">';
  expect(ogImage(page, data.writing[0]!.url)).toBe(image);
  expect(() => ogImage('<meta property="og:image" content="javascript:alert(1)">', data.writing[0]!.url)).toThrow();
  expect(() => ogImage("<html>No metadata</html>", data.writing[0]!.url)).toThrow();
  const enriched = await withArticleImages(data, async () => new Response(page));
  expect(enriched.writing[0]?.image).toBe(image);
  const readme = renderReadme(enriched);
  expect(readme).toContain('width="200"');
  expect(enriched.writing[0]?.description).toBe("Description.");
  expect(readme).toContain('<td width="25%" valign="top">');
  await expect(withArticleImages(data, async () => new Response("Unavailable", { status: 503 }))).rejects.toThrow("HTTP 503");
  const redirected = await withArticleImages(data, async (url) => url.endsWith("/")
    ? new Response(page)
    : new Response(null, { status: 307, headers: { Location: `${url}/` } }));
  expect(redirected.writing[0]?.image).toBe(image);
  await expect(withArticleImages(data, async () => new Response(null, { status: 307, headers: { Location: "https://example.com/" } }))).rejects.toThrow("Unexpected source URL");
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
  expect(await fetchArticleImage(image, async () => new Response(png))).toEqual(png);
  await expect(fetchArticleImage(image, async () => new Response("<html>Error</html>"))).rejects.toThrow("Invalid OG PNG");
  await expect(fetchArticleImage(image, async () => new Response("Missing", { status: 404 }))).rejects.toThrow("HTTP 404");
});

test("writing shows only the four latest posts in one row, without filler", () => {
  const posts = Array.from({ length: 18 }, (_, i) => `- [Post ${i + 1}](https://glpecile.xyz/blog/post-${i + 1}/index.html.md) — 2026-07-${String(18 - i).padStart(2, "0")} — Description.`).join("\n");
  const data = parseSite({ ...documents, Blog: `# Blog\n- Canonical HTML: https://glpecile.xyz/blog\n## Posts\n${posts}` });
  expect(data.writing).toHaveLength(4);
  const writing = renderReadme(data).split("## Writing")[1]!.split("## Recently watched")[0]!;
  const rows = [...writing.matchAll(/<tr>([\s\S]*?)<\/tr>/g)];
  expect(rows).toHaveLength(1);
  for (const row of rows) expect(row[1]!.match(/<td /g)).toHaveLength(4);
  expect(writing).not.toContain("Post 5");
  const partial = renderReadme({ ...data, writing: data.writing.slice(0, 2) }).split("## Writing")[1]!.split("## Recently watched")[0]!;
  const partialRows = [...partial.matchAll(/<tr>([\s\S]*?)<\/tr>/g)];
  expect(partialRows).toHaveLength(1);
  expect(partialRows[0]![1]!.match(/<td /g)).toHaveLength(2);
});

test("GitHub skyline uses real weekly totals and has dark, light and static variants", async () => {
  const payload = { data: { user: {
    followers: { totalCount: 65 }, repositories: { totalCount: 31 },
    contributionsCollection: { contributionCalendar: { totalContributions: 9, weeks: [
      { contributionDays: [{ date: "2026-10-01", contributionCount: 0 }, { date: "2026-10-02", contributionCount: 4 }] },
      { contributionDays: [{ date: "2026-10-03", contributionCount: 5 }] },
    ] } },
  } } };
  const stats = parseStats(payload);
  expect(stats.activeDays).toBe(2);
  expect(stats.weeks.map((week) => week.count)).toEqual([4, 5]);
  const svg = renderStats(stats, true);
  expect(svg).toContain("Week of 2026-10-01: 4 contributions");
  expect(svg).toContain("prefers-reduced-motion:reduce");
  expect(svg).toContain("animation:scan 8s linear infinite");
  expect(svg).not.toContain("NaN");
  expect(renderStats(stats, false, false)).not.toContain("animation");
  expect(renderStats(stats, false, false)).not.toContain('class="scan"');
  const readme = renderReadme(parseSite(documents), stats);
  expect(readme).toContain("## GitHub");
  expect(readme).toContain("9 contributions, 2 active days, 31 public repositories, 65 followers");
  expect(readme).toContain("github-dark-static.svg");
  expect(() => parseStats({ errors: [{ message: "Not authorized" }] })).toThrow();
  expect(() => parseStats({})).toThrow();
  expect(() => parseStats({ data: { user: { ...payload.data.user, followers: { totalCount: -1 } } } })).toThrow();
  const zero = { ...stats, contributions: 0, activeDays: 0, weeks: [{ date: "2026-10-01", count: 0 }] };
  expect(renderStats(zero, true)).not.toContain("NaN");
  expect(await fetchStats("test-token", async (_url, options) => {
    expect(options?.headers).toHaveProperty("Authorization", "Bearer test-token");
    return new Response(JSON.stringify(payload));
  })).toEqual(stats);
  await expect(fetchStats("test-token", async () => new Response("Unavailable", { status: 503 }))).rejects.toThrow("HTTP 503");
});

test("Gravatar uses a normalized SHA-256 email hash", () => {
  const expected = "https://gravatar.com/avatar/e9655caa7a32794c9b1f6422b7d8d76c8671cdc3b6cb3e175661a9143ff44422?s=192&d=mp";
  expect(gravatar("glpecile@gmail.com")).toBe(expected);
  expect(gravatar(" GLPECILE@GMAIL.COM ")).toBe(expected);
});

test("poster feed enriches matching films without changing their source titles or order", async () => {
  const data = parseSite(documents);
  const payload = { films: [{ url: data.films[0]!.url, image: "https://a.ltrbxd.com/poster.jpg?v=1", title: "Do not replace the source title" }] };
  const enriched = withPosters(data, payload);
  expect(enriched.films[0]?.title).toBe("Spider-Man");
  expect(enriched.films[0]?.image).toBe("https://a.ltrbxd.com/poster.jpg?v=1");
  expect(enriched.films[1]?.image).toBeUndefined();
  expect(renderReadme(enriched)).toContain('width="120" height="180"');
  expect(renderReadme(enriched)).toContain("6 Oct 2026");
  expect(() => withPosters(data, {})).toThrow();
  expect(() => withPosters(data, { films: [{ url: data.films[0]!.url, image: "javascript:alert(1)" }] })).toThrow();
  expect(await fetchPosters(async () => new Response(JSON.stringify(payload)))).toEqual(payload);
  await expect(fetchPosters(async () => new Response("Unavailable", { status: 503 }))).rejects.toThrow("HTTP 503");
});

test("reject unexpected URLs and schema changes instead of silently clearing sections", () => {
  expect(() => httpsUrl("javascript:alert(1)")).toThrow();
  expect(() => httpsUrl("https://user:password@example.com/")).toThrow();
  expect(() => discoverPages(guide.replace("https://glpecile.xyz/work", "https://example.com/work"))).toThrow();
  expect(() => discoverPages("# No export links")).toThrow();
  expect(() => parseSite({ ...documents, Work: "# Work" })).toThrow();
  expect(() => parseSite({ ...documents, Films: "## Recently watched\n" })).toThrow();
  expect(() => parseSite({ ...documents, Blog: documents.Blog.replace("2026-07-18", "2026-02-30") })).toThrow();
  const rendered = renderReadme({ ...parseSite(documents), name: "<script>*not markup*</script>" });
  expect(rendered).toContain("&lt;script&gt;\\*not markup\\*&lt;/script&gt;");
});

test("fetch only the guide's Markdown exports; propagate HTTP failures", async () => {
  const requests: string[] = [];
  const fetcher = async (url: string) => {
    requests.push(String(url));
    if (String(url).endsWith("llms.txt")) return new Response(guide);
    const name = Object.keys(documents).find((key) => String(url).includes(`/${key.toLowerCase()}/`)) as keyof typeof documents;
    return new Response(documents[name]);
  };
  expect(await fetchSite(fetcher)).toEqual(documents);
  expect(requests).toHaveLength(5);
  await expect(fetchSite(async () => new Response("Unavailable", { status: 503 }))).rejects.toThrow("HTTP 503");
});
