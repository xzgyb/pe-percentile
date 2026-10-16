const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class HttpError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

async function once(url, { timeout = 15000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': DEFAULT_UA, Accept: '*/*', ...headers },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new HttpError(`HTTP ${res.status} ${res.statusText}`, {
        status: res.status,
        body: text.slice(0, 500),
      });
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchText(url, options = {}) {
  const { retries = 3, retryDelay = 400, timeout = 15000, headers, shouldRetry } = options;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await once(url, { timeout, headers });
    } catch (err) {
      lastError = err;
      const retryable = shouldRetry ? shouldRetry(err) : true;
      if (!retryable || attempt === retries) break;
      await sleep(retryDelay * 2 ** attempt);
    }
  }
  throw lastError;
}

export async function fetchJson(url, options = {}) {
  const text = await fetchText(url, options);
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(`响应不是合法 JSON: ${text.slice(0, 200)}`);
  }
}

export async function fetchJsonPost(url, payload, options = {}) {
  const text = await fetchText(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return JSON.parse(text);
}

export async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}
