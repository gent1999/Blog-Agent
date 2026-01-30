// agent.js
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
if (!WEBHOOK_URL) throw new Error("Missing DISCORD_WEBHOOK_URL");

const now = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      "User-Agent": "rap-trends-agent/1.0",
      ...(opts.headers || {})
    }
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

function scoreRedditPost(p) {
  return (p.ups || 0) + (p.num_comments || 0) * 2;
}

async function getRedditTrends() {
  const subs = ["hiphopheads", "rap", "hiphop101"];
  const items = [];

  for (const sub of subs) {
    const data = await fetchJson(`https://www.reddit.com/r/${sub}/hot.json?limit=20`);
    for (const ch of data.data.children) {
      const p = ch.data;
      const title = p.title;
      if (!title) continue;

      items.push({
        source: `r/${sub}`,
        title,
        url: `https://reddit.com${p.permalink}`,
        score: scoreRedditPost(p)
      });
    }
  }

  return items
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

async function postToDiscord(content) {
  await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content })
  });
}

async function main() {
  const trends = await getRedditTrends();

  const message =
    `**Rap Trend Watch — ${now}**\n\n` +
    trends
      .map((t, i) => `${i + 1}. ${t.title}\n${t.url}`)
      .join("\n\n");

  await postToDiscord(message);
}

main();
