// agent.js | Discord WEBHOOK EMBED digest (one message, rich embed card)
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
  return s.replace(/\s+/g, " ").trim();
}

function isJunk(it) {
  const t = it.title.toLowerCase();
  const bad = [
    "country", "taylor swift", "bruce springsteen", "jewelry", "necklace",
    "rock pendant", "unisex", "fashion", "watch", "politics"
  ];
  return bad.some((b) => t.includes(b));
}

// Discord embed limits:
// - up to 25 fields
// - field name 256 chars, value 1024 chars
// - embed description 4096 chars
function buildEmbed(top, failures) {
  const fields = top.slice(0, 10).map((item, idx) => ({
    name: `${idx + 1}. ${cleanTitle(item.title).slice(0, 240)}`,
    value: `[Open link](${item.link}) • _${item.source}_`,
    inline: false
  }));

  const skipped = failures.length ? `Skipped: ${failures.map(f => f.name).join(", ")}` : "";

  return {
    // color is optional; remove if you don’t care
    // color: 0x5865F2,
    title: "Rap / Hip-Hop Trend Digest",
    description: skipped ? `**${now}**\n${skipped}` : `**${now}**`,
    fields,
    footer: { text: "Reply with a number and I’ll write the caption + take." }
  };
}

async function postToDiscordEmbed(embed) {
  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: "",      // keep blank (optional)
      embeds: [embed]   // THIS creates the rich embed card
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
      all.push(...parseRss(xml, feed.name).slice(0, 25));
    } catch (e) {
      failures.push({ name: feed.name, err: String(e.message || e) });
    }
  }

  const merged = sortNewestFirst(dedupe(all)).filter((it) => !isJunk(it));
  if (!merged.length) throw new Error("No items parsed from RSS feeds.");

  // pick top N; embed handles layout
  const top = merged.slice(0, 10);

  const embed = buildEmbed(top, failures);
  await postToDiscordEmbed(embed);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
