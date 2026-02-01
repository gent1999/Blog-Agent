// agent.js | Discord embed digest from (1) RSS + (2) Twitter/X (official API v2)
// IMPORTANT:
// - Instagram ingestion (reading other pages' posts) is NOT available safely/officially.
// - Twitter/X requires API access + a Bearer Token.
//
// Env vars you may set:
//   DISCORD_WEBHOOK_URL=...
//   TWITTER_BEARER_TOKEN=...           (optional; if missing, Twitter is skipped)
//   MODE=hybrid | accounts | keywords  (optional; default = hybrid)
//   MAX_ITEMS=10                       (optional; default = 10)

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
if (!WEBHOOK_URL) throw new Error("Missing DISCORD_WEBHOOK_URL");

const TWITTER_BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN || "";
const MODE = (process.env.MODE || "hybrid").toLowerCase(); // hybrid | accounts | keywords
const MAX_ITEMS = Math.max(5, Math.min(20, Number(process.env.MAX_ITEMS || 10)));

const now = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });

/** -----------------------------
 *  SOURCES (RSS)
 *  ----------------------------- */
const FEEDS = [
  { name: "XXL", url: "https://www.xxlmag.com/feed/" },
  { name: "Google News: Hip Hop", url: "https://news.google.com/rss/search?q=hip+hop+when:1d&hl=en-US&gl=US&ceid=US:en" },
  { name: "Google News: Rap", url: "https://news.google.com/rss/search?q=rap+music+when:1d&hl=en-US&gl=US&ceid=US:en" },
  { name: "Google News: Album Sales", url: "https://news.google.com/rss/search?q=first+week+sales+rapper+when:7d&hl=en-US&gl=US&ceid=US:en" },
  { name: "Google News: Rap beef", url: "https://news.google.com/rss/search?q=rap+beef+when:7d&hl=en-US&gl=US&ceid=US:en" },
  { name: "Google News: Rap arrest", url: "https://news.google.com/rss/search?q=rapper+arrested+when:7d&hl=en-US&gl=US&ceid=US:en" }
];

/** -----------------------------
 *  SOURCES (Twitter/X)
 *  IG-style “news pages” usually repost these types of accounts
 *  You can edit this list anytime.
 *  ----------------------------- */
const TWITTER_ACCOUNTS = [
  "Akademiks",
  "RapTV",
  "chartdata",
  "HipHopDX",
  "XXL",
  "DailyRapFacts",
  "OnThinIce",
  "RapAlert6"
];

// Keywords tuned to pages like OurGenerationMusic / Rap / RapSpotsTV / Akademiks / HelloYassine
const TWITTER_KEYWORDS = [
  `"first week" sales`,
  `billboard rapper`,
  `album announced`,
  `new single`,
  `music video`,
  `snippet`,
  `leak`,
  `diss track`,
  `rap beef`,
  `rapper arrested`,
  `rapper indicted`,
  `lawsuit rapper`,
  `sentenced rapper`,
  `tour cancelled`,
  `statement responds`
];

/** -----------------------------
 *  HTTP helpers
 *  ----------------------------- */
async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "rap-trends-agent/1.0 (+github actions)" }
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status} ${res.statusText}`);
  return res.text();
}

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": "rap-trends-agent/1.0 (+github actions)", ...headers }
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`${url} -> ${res.status} ${res.statusText}\n${t}`);
  }
  return res.json();
}

/** -----------------------------
 *  RSS parsing
 *  ----------------------------- */
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

    items.push({
      kind: "news",
      source: sourceName,
      title,
      url: link,
      created_at: pubDate ? new Date(pubDate).toISOString() : ""
    });
  }

  return items;
}

/** -----------------------------
 *  Twitter/X (official API v2)
 *  ----------------------------- */
const twitterHeaders = TWITTER_BEARER_TOKEN
  ? { Authorization: `Bearer ${TWITTER_BEARER_TOKEN}` }
  : null;

async function twitterGetUserId(username) {
  const url = `https://api.x.com/2/users/by/username/${encodeURIComponent(username)}`;
  const json = await fetchJson(url, twitterHeaders);
  return json?.data?.id || "";
}

async function twitterGetLatestTweetsByUserId(userId, maxResults = 5) {
  const url =
    `https://api.x.com/2/users/${userId}/tweets` +
    `?max_results=${Math.min(10, Math.max(5, maxResults))}` +
    `&tweet.fields=created_at,public_metrics,entities` +
    `&exclude=replies,retweets`;

  const json = await fetchJson(url, twitterHeaders);
  const data = json?.data || [];

  return data.map((t) => {
    const metrics = t.public_metrics || {};
    const score = (metrics.like_count || 0) + (metrics.retweet_count || 0) * 2 + (metrics.reply_count || 0);
    return {
      kind: "tweet",
      source: `@${userId}`, // overwritten later with username
      title: t.text || "",
      url: `https://x.com/i/web/status/${t.id}`,
      created_at: t.created_at || "",
      score
    };
  });
}

async function twitterRecentSearch(query, maxResults = 10) {
  // recent search endpoint
  const url =
    `https://api.x.com/2/tweets/search/recent` +
    `?query=${encodeURIComponent(query)}` +
    `&max_results=${Math.min(20, Math.max(10, maxResults))}` +
    `&tweet.fields=created_at,public_metrics,entities` +
    `&expansions=author_id`;

  const json = await fetchJson(url, twitterHeaders);
  const data = json?.data || [];
  const users = new Map((json?.includes?.users || []).map((u) => [u.id, u.username]));

  return data.map((t) => {
    const metrics = t.public_metrics || {};
    const score = (metrics.like_count || 0) + (metrics.retweet_count || 0) * 2 + (metrics.reply_count || 0);
    const username = users.get(t.author_id) || "unknown";
    return {
      kind: "tweet",
      source: `@${username}`,
      title: t.text || "",
      url: `https://x.com/${username}/status/${t.id}`,
      created_at: t.created_at || "",
      score
    };
  });
}

/** -----------------------------
 *  Filters / scoring
 *  ----------------------------- */
function isJunkTitle(title) {
  const t = title.toLowerCase();
  const bad = ["taylor swift", "bruce springsteen", "country", "jewelry", "necklace", "pendant", "unisex", "fashion"];
  return bad.some((b) => t.includes(b));
}

function cleanTitle(s) {
  return s.replace(/\s+/g, " ").trim();
}

function mdLink(title, url) {
  const safeTitle = title.replace(/\]/g, "\\]").replace(/\)/g, "\\)");
  return `[${safeTitle}](${url})`;
}

function recencyBoost(iso) {
  const ts = iso ? Date.parse(iso) : 0;
  if (!ts) return 0;
  const ageMin = (Date.now() - ts) / 60000;
  if (ageMin <= 60) return 50;
  if (ageMin <= 180) return 25;
  if (ageMin <= 720) return 10;
  return 0;
}

function rankItems(items) {
  return items
    .map((it) => {
      const base = it.kind === "tweet" ? (it.score || 0) : 10;
      const boost = recencyBoost(it.created_at);
      return { ...it, _rank: base + boost };
    })
    .sort((a, b) => b._rank - a._rank);
}

function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = (it.kind + "|" + cleanTitle(it.title).toLowerCase()).slice(0, 220);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

/** -----------------------------
 *  Discord embed
 *  ----------------------------- */
function buildEmbed(top, failures) {
  const fields = top.slice(0, 15).map((item, idx) => {
    const title = cleanTitle(item.title).slice(0, 240);
    const source = item.kind === "tweet" ? `X ${item.source}` : item.source;
    const value = `${mdLink("Open", item.url)} • _${source}_`;

    return {
      name: `${idx + 1}. ${title}`,
      value: value.length > 1024 ? value.slice(0, 1020) + "…" : value,
      inline: false
    };
  });

  const skipped = failures.length ? `Skipped: ${failures.map((f) => f.name).join(", ")}` : "";

  return {
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
      content: "",
      embeds: [embed]
    })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord webhook failed: ${res.status} ${res.statusText}\n${text}`);
  }
}

/** -----------------------------
 *  Main
 *  ----------------------------- */
async function main() {
  const failures = [];
  const allItems = [];

  // RSS
  for (const feed of FEEDS) {
    try {
      const xml = await fetchText(feed.url);
      const parsed = parseRss(xml, feed.name).filter((x) => !isJunkTitle(x.title));
      allItems.push(...parsed.slice(0, 20));
    } catch (e) {
      failures.push({ name: feed.name, err: String(e.message || e) });
    }
  }

  // Twitter/X (optional)
  if (twitterHeaders) {
    try {
      if (MODE === "accounts" || MODE === "hybrid") {
        // Resolve usernames -> ids, then pull recent tweets
        const idPairs = [];
        for (const u of TWITTER_ACCOUNTS) {
          try {
            const id = await twitterGetUserId(u);
            if (id) idPairs.push({ username: u, id });
          } catch {
            // ignore per-account failure
          }
        }

        for (const pair of idPairs) {
          try {
            const tweets = await twitterGetLatestTweetsByUserId(pair.id, 6);
            for (const t of tweets) {
              // overwrite source with username
              allItems.push({ ...t, source: `@${pair.username}` });
            }
          } catch {
            // ignore per-user failure
          }
        }
      }

      if (MODE === "keywords" || MODE === "hybrid") {
        for (const q of TWITTER_KEYWORDS) {
          try {
            const hits = await twitterRecentSearch(`(${q}) lang:en -is:reply -is:retweet`, 12);
            allItems.push(...hits);
          } catch {
            // ignore per-query failure
          }
        }
      }
    } catch (e) {
      failures.push({ name: "Twitter/X", err: String(e.message || e) });
    }
  } else {
    failures.push({ name: "Twitter/X", err: "No TWITTER_BEARER_TOKEN set (skipped)" });
  }

  const merged = dedupe(allItems);
  const ranked = rankItems(merged);
  const top = ranked.slice(0, MAX_ITEMS);

  if (!top.length) throw new Error("No items collected from any sources.");

  const embed = buildEmbed(top, failures);
  await postToDiscordEmbed(embed);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
