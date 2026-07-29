/**
 * Rewrites the "Uptime" line in dark_mode.svg / light_mode.svg.
 *
 * Credit where it's due — the neofetch-style profile README and the SVG
 * dot-leader justification trick are Andrew Grant's work, ported here from
 * Python to TypeScript on Bun:
 *   https://github.com/Andrew6rant/Andrew6rant
 * which in turn builds on https://github.com/jstrieb/github-stats
 *
 * The upstream version also pulls live repo/star/commit/LOC counts from the
 * GitHub GraphQL API. That needs a personal access token, so it is left out
 * here; everything below runs with no credentials at all.
 */

export {};

/** From .env, which Bun loads automatically and which is committed. */
const BIRTHDAY = process.env.BIRTHDAY;
if (!BIRTHDAY) throw new Error("Missing BIRTHDAY — expected it in .env");

/** Widest the value can get, used to size the dot leader before it. */
const AGE_WIDTH = 49;

/**
 * e.g. "23 years, 5 months, 29 days", with a 🎂 on the day itself.
 * Everything is done in UTC — mixing a UTC-parsed birthday with local "today"
 * parts shifts the day count by one for anyone west of Greenwich.
 */
function uptime(birthday: string, today = new Date()): string {
  const [birthYear, birthMonth, birthDay] = birthday.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  let years = today.getUTCFullYear() - birthYear;
  let months = today.getUTCMonth() + 1 - birthMonth;
  let days = today.getUTCDate() - birthDay;
  if (days < 0) {
    months -= 1;
    // Day 0 of this month is the last day of the previous one.
    days += new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0)).getUTCDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  const plural = (n: number) => (n === 1 ? "" : "s");
  const cake = months === 0 && days === 0 ? " 🎂" : "";
  return `${years} year${plural(years)}, ${months} month${plural(months)}, ${days} day${plural(days)}${cake}`;
}

/**
 * Replaces the text of `<tspan id="...">…</tspan>`, and resizes the matching
 * `<tspan id="..._dots">` so the value stays right-aligned.
 */
function justify(svg: string, id: string, value: string, width: number): string {
  const gap = Math.max(0, width - value.length);
  const dots = gap <= 2 ? ["", " ", ". "][gap]! : ` ${".".repeat(gap)} `;
  return setText(setText(svg, id, value), `${id}_dots`, dots);
}

function setText(svg: string, id: string, text: string): string {
  const pattern = new RegExp(`(<tspan[^>]*\\bid="${id}"[^>]*>)[^<]*(</tspan>)`);
  if (!pattern.test(svg)) return svg; // element absent — nothing to justify
  return svg.replace(
    pattern,
    (_, open: string, close: string) => `${open}${escapeXml(text)}${close}`,
  );
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const age = uptime(BIRTHDAY);

for (const path of ["dark_mode.svg", "light_mode.svg"]) {
  const svg = await Bun.file(path).text();
  await Bun.write(path, justify(svg, "age_data", age, AGE_WIDTH));
}

console.log(`Uptime: ${age}`);
