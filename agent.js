// agent.js (RSS -> Discord) | single clean message, minimal embeds
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
if (!WEBHOOK_URL) throw new Error("Missing DISCORD_WEBHOOK_URL");

const now = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });

const FEEDS = [
  { name: "XXL", url: "https://www.xxlmag.com/feed/" },
  { name: "Google News: Hip Hop", url: "https://news.google.com/rss/search?q=hip+hop+when:1d&hl=en-US&gl=US&ceid=US:en" },
  { name: "Google News: Rap", url: "https://news.google.com/rss/search?q=rap+music+when:1d&hl=en-US&gl=US&ceid=US:en" },
  { name: "Google News: Album Sales", url: "https://news.google.com/rss/search?q=first+week+sales+rapper+when:7d&hl=en-US&gl=US&ceid=US:en" },
  { name: "Google News: Rap beef", url: "https://news.google.com/rss/search?q=rap+beef+when:7d&hl=en-US&gl=US&ceid=US:en" }
];

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "rap-trends-agent/1.0 (+github actions)" }
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status} ${res.statusText}`);
  return res.text();
}

function parseRss(xml, sourceName) {
  const items = [];
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/g) || [];

  for (const block of itemBlocks) {
    const title =
      (block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i)?.[1] ||
        block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ||
        "")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .trim();

    let link = (block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || "").trim();

    if (!link || !link.startsWith("http")) {
      const guid = (block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i)?.[1] || "").trim();
      if (guid.startsWith("http")) link = guid;
    }

    const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || "").trim();

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

function sortNewestFirst(items) {
  return items.sort((a, b) => {
    const da = a.pubDate ? Date.parse(a.pubDate) : 0;
    const db = b.pubDate ? Date.parse(b.pubDate) : 0;
    return db - da;
  });
}

function cleanTitle(s) {
  return s
    .replace(/\s+/g, " ")
    .replace(/\s-\s.*$/, "") // trims " - BBC" style endings sometimes
    .trim();
}

// Trick to reduce embed spam: wrap URL in < >
// Still clickable, but usually no preview.
function noEmbedUrl(url) {
  return `<${url}>`;
}

function formatDigest(top, failures) {
  const lines = [];
  lines.push(`**Rap / Hip-Hop Trend Digest — ${now}**`);
  lines.push(`Sources: XXL + Google News`);
  if (failures.length) lines.push(`_Skipped: ${failures.map(f => f.name).join(", ")}_`);
  lines.push("");

  top.forEach((t, i) => {
    const title = cleanTitle(t.title);
    lines.push(`${i + 1}. **${title}**`);
    lines.push(`${noEmbedUrl(t.link)} _(via ${t.source})_`);
    lines.push("");
  });

  lines.push("Reply with a number and I’ll write the caption + take.");

  const msg = lines.join("\n");
  return msg.length > 1900 ? msg.slice(0, 1900) + "\n…" : msg;
}

async function postToDiscord(content) {
  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // IMPORTANT: disable embeds
    body: JSON.stringify({
      content,
      flags: 1 << 2 // SUPPRESS_EMBEDS
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord webhook failed: ${res.status} ${res.statusText}\n${text}`);
  }
}

async function main() {
  const all = [];
  const failures = [];

  for (const feed of FEEDS) {
    try {
      const xml = await fetchText(feed.url);
      all.push(...parseRss(xml, feed.name).slice(0, 12));
    } catch (e) {
      failures.push({ name: feed.name, err: String(e.message || e) });
    }
  }

  const merged = sortNewestFirst(dedupe(all));

  // Quick junk filter (tune later)
  const filtered = merged.filter((it) => {
    const t = it.title.toLowerCase();
    const bad = ["bruce springsteen", "country", "taylor swift", "rock pendant", "necklace", "unisex", "jewelry"];
    if (bad.some((b) => t.includes(b))) return false;
    return true;
  });

  const top = filtered.slice(0, 10);
  if (!top.length) throw new Error("No items parsed from RSS feeds.");

  await postToDiscord(formatDigest(top, failures));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
