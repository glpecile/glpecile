type Week = { date: string; count: number };
export type Stats = { contributions: number; activeDays: number; repositories: number; followers: number; weeks: Week[]; from: string; to: string };

export async function fetchStats(token: string, fetcher: (url: string, options?: RequestInit) => Promise<Response> = fetch): Promise<Stats> {
  const response = await fetcher("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ query: `query { user(login: "glpecile") {
      followers { totalCount }
      repositories(privacy: PUBLIC, ownerAffiliations: OWNER) { totalCount }
      contributionsCollection { contributionCalendar {
        totalContributions weeks { contributionDays { date contributionCount } }
      } }
    } }` }),
  });
  if (!response.ok) throw new Error(`GitHub stats failed: HTTP ${response.status}`);
  return parseStats(await response.json());
}

export function parseStats(payload: unknown): Stats {
  const result = payload as { errors?: unknown[]; data?: { user?: {
    followers?: { totalCount?: number }; repositories?: { totalCount?: number };
    contributionsCollection?: { contributionCalendar?: { totalContributions?: number; weeks?: { contributionDays: { date: string; contributionCount: number }[] }[] } };
  } } } | null;
  const user = result?.data?.user;
  const calendar = user?.contributionsCollection?.contributionCalendar;
  const number = (value: unknown) => {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Invalid GitHub stats count");
    return value;
  };
  if (result?.errors?.length || !Array.isArray(calendar?.weeks) || !calendar.weeks.length || calendar.weeks.length > 54) throw new Error("Invalid GitHub contribution calendar");
  let activeDays = 0;
  const dates: string[] = [];
  const weeks = calendar.weeks.map((week) => {
    if (!Array.isArray(week.contributionDays) || !week.contributionDays.length || week.contributionDays.length > 7) throw new Error("Invalid contribution week");
    const count = week.contributionDays.reduce((total, day) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date) || Number.isNaN(Date.parse(day.date)) || new Date(day.date).toISOString().slice(0, 10) !== day.date) throw new Error("Invalid contribution date");
      dates.push(day.date);
      const count = number(day.contributionCount);
      if (count) activeDays++;
      return total + count;
    }, 0);
    return { date: week.contributionDays[0]!.date, count };
  });
  return { contributions: number(calendar.totalContributions), activeDays, repositories: number(user?.repositories?.totalCount), followers: number(user?.followers?.totalCount), weeks, from: dates[0]!, to: dates.at(-1)! };
}

export function renderStats(stats: Stats, dark: boolean, animated = true): string {
  const colors = dark
    ? { background: "#0d1117", border: "#30363d", text: "#e6edf3", muted: "#9198a1", grid: "#212830", blue: "#79c0ff", purple: "#bc8cff" }
    : { background: "#ffffff", border: "#d1d9e0", text: "#1f2328", muted: "#59636e", grid: "#eff2f5", blue: "#0969da", purple: "#8250df" };
  const step = 848 / stats.weeks.length;
  const max = Math.max(1, ...stats.weeks.map((week) => week.count));
  const bars = stats.weeks.map((week, i) => {
    const height = Math.max(3, week.count / max * 90);
    return `<rect x="${(26 + i * step).toFixed(2)}" y="${(226 - height).toFixed(2)}" width="${(step - 4).toFixed(2)}" height="${height.toFixed(2)}" rx="2"><title>Week of ${week.date}: ${week.count} contributions</title></rect>`;
  }).join("\n");
  const metrics = [[stats.contributions, "contributions"], [stats.activeDays, "active days"], [stats.repositories, "public repositories"], [stats.followers, "followers"]] as const;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="272" viewBox="0 0 900 272" role="img" aria-labelledby="title desc">
<title id="title">glpecile's GitHub activity skyline</title>
<desc id="desc">${stats.contributions} contributions, ${stats.activeDays} active days, ${stats.repositories} public repositories and ${stats.followers} followers. Weekly contributions from ${stats.from} to ${stats.to}; bar height represents contribution count.</desc>
<defs>
  <linearGradient id="ink"><stop stop-color="${colors.blue}"/><stop offset="1" stop-color="${colors.purple}"/></linearGradient>
  <linearGradient id="glint"><stop stop-color="white" stop-opacity="0"/><stop offset=".5" stop-color="white" stop-opacity=".5"/><stop offset="1" stop-color="white" stop-opacity="0"/></linearGradient>
  <clipPath id="skyline">${bars}</clipPath>
</defs>
${animated ? `<style>.scan{animation:scan 8s linear infinite}@keyframes scan{from{transform:translateX(-100px)}to{transform:translateX(900px)}}@media(prefers-reduced-motion:reduce){.scan{display:none;animation:none}}</style>` : ""}
<rect x=".5" y=".5" width="899" height="271" rx="10" fill="${colors.background}" stroke="${colors.border}"/>
<g font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" fill="${colors.text}">
  <text x="26" y="30" font-size="13" font-weight="600">glpecile / github</text>
  <text x="874" y="30" text-anchor="end" font-size="12" fill="${colors.muted}">${stats.from} — ${stats.to}</text>
  ${metrics.map(([value, label], i) => `<text x="${26 + i * 218}" y="80" font-size="30" font-weight="600">${value.toLocaleString("en-US")}</text><text x="${26 + i * 218}" y="102" font-size="12" fill="${colors.muted}">${label}</text>`).join("\n")}
  <path d="M26 136H874 M26 181H874 M26 226H874" stroke="${colors.grid}"/>
  <g fill="url(#ink)">${bars}</g>
  ${animated ? '<g clip-path="url(#skyline)"><rect class="scan" x="0" y="130" width="100" height="96" fill="url(#glint)"/></g>' : ""}
  <text x="26" y="251" font-size="11" fill="${colors.muted}">WEEKLY CONTRIBUTIONS</text>
  <text x="874" y="251" text-anchor="end" font-size="11" fill="${colors.muted}">Each column is one week · refreshed daily</text>
</g>
</svg>\n`;
}
