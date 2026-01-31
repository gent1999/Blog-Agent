// agent.js (RSS -> Discord)
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
if (!WEBHOOK_URL) throw new Error("Missing DISCORD_WEBHOOK_URL");

const now = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });

const FEEDS = [
  { name: "HipHopDX", url: "https://hiphopdx.com/feed" },
  { name: "Complex (Music)", url: "https://www.complex.com/music/rss" },
  { name: "XXL", url: "https://www.xxlmag.com/feed/" }
];

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "rap-trends-agent/1.0 (+github actions)" }
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status} ${res.statusText}`);
  return res.text();
}

// Super simple RSS parser (no deps): grabs <item> blocks and reads <title>/<link>/<pubDate>
function parseRss(xml, sourceName) {
  const items = [];
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/g) || [];

  for (const block of itemBlocks) {
    const title =
      (block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i)?.[1] ||
        block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ||
        "")
        .trim();

    let link =
      (block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || "").trim();

    // Some feeds put the real URL in <guid>
    if (!link || link.startsWith("http") === false) {
      const guid = (block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i)?.[1] || "").trim();
      if (guid.startsWith("http")) link = guid;
    }

    const pubDate =
      (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || "").trim();

    if (!title || !link) continue;

    items.push({ source: sourceName, title, link, pubDate });
  }

  return items;
}

function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = (it.title + "|" + it.link).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

function formatMessage(top) {
  const lines = [];
  lines.push(`**Rap / Hip-Hop Headlines — ${now}**`);
  lines.push(`Top pulls from HipHopDX + Complex + XXL`);
  lines.push("");

  top.forEach((t, i) => {
    lines.push(`${i + 1}. **${t.title}**`);
    lines.push(`${t.link} _(via ${t.source})_`);
    lines.push("");
  });

  lines.push("Reply with a number and I’ll turn it into a post caption + take.");
  const msg = lines.join("\n");

  // Discord content limit safety
  return msg.length > 1900 ? msg.slice(0, 1900) + "\n…" : msg;
}

async function postToDiscord(content) {
  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord webhook failed: ${res.status} ${res.statusText}\n${text}`);
  }
}

async function main() {
  const all = [];

  for (const feed of FEEDS) {
    const xml = await fetchText(feed.url);
    const items = parseRss(xml, feed.name).slice(0, 10);
    all.push(...items);
  }

  const merged = dedupe(all);

  // Light “trending” sort: newest pubDate first if present
  merged.sort((a, b) => {
    const da = a.pubDate ? Date.parse(a.pubDate) : 0;
    const db = b.pubDate ? Date.parse(b.pubDate) : 0;
    return db - da;
  });

  const top = merged.slice(0, 8);
  if (!top.length) throw new Error("No items parsed from RSS feeds.");

  await postToDiscord(formatMessage(top));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
