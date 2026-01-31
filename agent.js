// agent.js (RSS -> Discord) | single clean digest, NO embeds, auto-fit under 2000 chars
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
    .replace(/\s-\s(BBC|CNN|Complex|XXL|E! News|People|Rolling Stone|The Fader|Billboard)\s*$/i, "")
    .trim();
}

// Discord markdown link: [title](url)
// IMPORTANT: escape ] and ) so it doesn’t break formatting
function mdLink(title, url) {
  const safeTitle = title.replace(/\]/g, "\\]").replace(/\)/g, "\\)");
  return `[${safeTitle}](${url})`;
}

function isJunk(it) {
  const t = it.title.toLowerCase();
  const bad = [
    "country", "taylor swift", "bruce springsteen", "jewelry", "necklace",
    "rock pendant", "unisex", "fashion", "watch", "stock", "politics"
  ];
  return bad.some((b) => t.includes(b));
}

// Build message and keep adding items until close to limit
function buildDigest(items, failures) {
  const header = [
    `**Rap / Hip-Hop Trend Digest — ${now}**`,
    `Sources: XXL + Google News`,
    failures.length ? `_Skipped: ${failures.map(f => f.name).join(", ")}_` : "",
    "",
    "**Top topics:**"
  ].filter(Boolean).join("\n");

  const footer = "\n\nReply with a number and I’ll write the caption + take.";

  let msg = header;
  let count = 0;

  for (let i = 0; i < items.length; i++) {
    const line = `\n${count + 1}. ${mdLink(cleanTitle(items[i].title), items[i].link)} _(via ${items[i].source})_`;
    // if adding this line would exceed 2000, stop
    if ((msg + line + footer).length > 1950) break;
    msg += line;
    count++;
  }

  msg += footer;
  return msg;
}

async function postToDiscord(content) {
  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content,
      flags: 1 << 2 // SUPPRESS_EMBEDS (no link previews)
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
      all.push(...parseRss(xml, feed.name).slice(0, 20));
    } catch (e) {
      failures.push({ name: feed.name, err: String(e.message || e) });
    }
  }

  const merged = sortNewestFirst(dedupe(all)).filter((it) => !isJunk(it));

  if (!merged.length) throw new Error("No items parsed from RSS feeds.");

  // Try up to 30 candidates, but message builder will auto-stop at char limit
  const digest = buildDigest(merged.slice(0, 30), failures);

  await postToDiscord(digest);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
