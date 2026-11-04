// Bot detection for visitor counts and scraper limits (rebuilt from the old site's BotDetector).
// Where it fits: used by visit tracking on the website API and by rate limits.
// How it works: known crawlers and headless browsers are recognised by user agent and headers.
// Rules: search engines are still served normally (they index listings); they are only left out of analytics.

const BOT = new RegExp([
  "bot|crawl|spider|slurp|mediapartners|adsbot|bingpreview|yandex|baidu|duckduck|sogou|exabot|petalbot|applebot",
  "ahrefs|semrush|mj12|dotbot|screaming frog|seokicks|serpstat|dataforseo",
  "facebookexternalhit|facebookcatalog|twitterbot|linkedinbot|whatsapp|telegrambot|slackbot|discordbot|skypeuripreview|viber|embedly|preview|pinterest|redditbot",
  "gptbot|chatgpt|oai-searchbot|claudebot|claude-web|anthropic|perplexity|ccbot|bytespider|amazonbot|cohere|diffbot|meta-externalagent",
  "curl|wget|python|axios|node-fetch|undici|go-http|java/|okhttp|libwww|httpclient|guzzle|postman|insomnia",
  "headless|phantom|selenium|puppeteer|playwright|lighthouse|pagespeed|gtmetrix|pingdom|uptime|statuscake|monitor|scan|validator",
].join("|"), "i");

const SEARCH_ENGINE = /googlebot|google-inspectiontool|bingbot|duckduckbot|yandexbot|applebot|baiduspider/i;

export function isBotUserAgent(ua?: string | null): boolean {
  const s = (ua ?? "").trim();
  if (s.length < 20) return true;
  return BOT.test(s);
}

export function isSearchEngine(ua?: string | null): boolean {
  return SEARCH_ENGINE.test(ua ?? "");
}

/** A request that should not count as a real visitor. Browsers always send Accept-Language; most bots don't. */
export function isBotRequest(headers: { "user-agent"?: string; "accept-language"?: string }): boolean {
  return isBotUserAgent(headers["user-agent"]) || !headers["accept-language"];
}
