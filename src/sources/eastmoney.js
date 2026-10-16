import { fetchJson, pool } from '../http.js';

const ENDPOINT = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
const PAGE_SIZE = 500;

const STOCK_FIELDS = [
  'SECURITY_CODE',
  'TRADE_DATE',
  'PE_TTM',
  'PB_MRQ',
  'TOTAL_MARKET_CAP',
  'TOTAL_SHARES',
];

function normalizeDate(raw) {
  if (!raw) return null;
  return String(raw).slice(0, 10);
}

function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function query(params, options = {}) {
  const { retries = 4, retryDelay = 500, ...rest } = options;
  const search = new URLSearchParams({
    source: 'WEB',
    client: 'WEB',
    ...Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    ),
  });
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const json = await fetchJson(`${ENDPOINT}?${search}`, {
        timeout: 20000,
        ...rest,
        shouldRetry: (err) => !(err?.status >= 400 && err?.status < 500),
      });
      if (json?.success === false) {
        const err = new Error(`东财接口报错: ${json.message} (code=${json.code})`);
        err.code = json.code;
        if (!/9701|服务器繁忙/.test(json.message || '') || attempt === retries) throw err;
        lastError = err;
      } else {
        return json?.result ?? { data: [], count: 0, pages: 0 };
      }
    } catch (err) {
      lastError = err;
      if (attempt === retries) throw err;
    }
    await new Promise((r) => setTimeout(r, retryDelay * (attempt + 1)));
  }
  throw lastError;
}

export async function fetchIndexConstituents(indexCode) {
  const result = await query({
    reportName: 'RPT_INDEX_CONSTITUENT',
    columns: 'ALL',
    filter: `(INDEX_CODE="${indexCode}")`,
    sortColumns: 'TRADE_DATE',
    sortTypes: -1,
    pageSize: PAGE_SIZE,
    pageNumber: 1,
  });
  const rows = result.data || [];
  const seen = new Map();
  for (const row of rows) {
    const code = row.SECURITY_CODE;
    if (code && !seen.has(code)) {
      seen.set(code, { code, name: row.SECURITY_NAME_ABBR || code });
    }
  }
  const meta = rows[0] || {};
  return {
    indexCode,
    indexName: meta.INDEX_NAME || indexCode,
    snapshotDate: normalizeDate(meta.TRADE_DATE),
    constituents: [...seen.values()],
  };
}

export async function fetchStockValuationHistory(code) {
  const rows = [];
  let page = 1;
  let pages = 1;
  do {
    const result = await query({
      reportName: 'RPT_VALUEANALYSIS_DET',
      columns: STOCK_FIELDS.join(','),
      filter: `(SECURITY_CODE="${code}")`,
      sortColumns: 'TRADE_DATE',
      sortTypes: 1,
      pageSize: PAGE_SIZE,
      pageNumber: page,
    });
    rows.push(...(result.data || []));
    pages = result.pages || 1;
    page += 1;
  } while (page <= pages && rows.length < 5000);

  return rows
    .map((row) => ({
      date: normalizeDate(row.TRADE_DATE),
      peTtm: toNum(row.PE_TTM),
      pb: toNum(row.PB_MRQ),
      marketCap: toNum(row.TOTAL_MARKET_CAP),
      shares: toNum(row.TOTAL_SHARES),
    }))
    .filter((row) => row.date);
}

export function aggregateValuation(histories, options = {}) {
  const {
    minCoverageRatio = 0.6,
    minConstituents = 30,
    lossMakersInDenominator = false,
  } = options;

  const totalConstituents = histories.length;
  const minCoverage = Math.max(minConstituents, Math.ceil(totalConstituents * minCoverageRatio));
  const byDate = new Map();

  for (const history of histories) {
    for (const row of history) {
      let bucket = byDate.get(row.date);
      if (!bucket) {
        bucket = { date: row.date, present: 0, pePositive: 0, pbPositive: 0 };
        byDate.set(row.date, bucket);
      }
      bucket.present += 1;
      if (row.marketCap !== null && row.peTtm !== null && row.peTtm !== 0) {
        const earnings = row.marketCap / row.peTtm;
        if (row.peTtm > 0) {
          bucket.pePositive += 1;
          bucket.sumMktCapPositive = (bucket.sumMktCapPositive || 0) + row.marketCap;
          bucket.sumEarningsPositive = (bucket.sumEarningsPositive || 0) + earnings;
        } else {
          bucket.peNegative = (bucket.peNegative || 0) + 1;
        }
        if (lossMakersInDenominator) {
          bucket.sumMktCapAll = (bucket.sumMktCapAll || 0) + row.marketCap;
          bucket.sumEarningsAll = (bucket.sumEarningsAll || 0) + earnings;
        }
      }
      if (row.marketCap !== null && row.pb !== null && row.pb > 0) {
        const book = row.marketCap / row.pb;
        bucket.pbPositive += 1;
        bucket.sumMktCapPb = (bucket.sumMktCapPb || 0) + row.marketCap;
        bucket.sumBook = (bucket.sumBook || 0) + book;
      }
    }
  }

  const series = [];
  for (const bucket of byDate.values()) {
    if (bucket.present < minCoverage) continue;
    const peTtm =
      bucket.sumEarningsPositive > 0 ? bucket.sumMktCapPositive / bucket.sumEarningsPositive : null;
    const peTtmAll =
      bucket.sumEarningsAll !== undefined && bucket.sumEarningsAll > 0
        ? bucket.sumMktCapAll / bucket.sumEarningsAll
        : null;
    const pb =
      bucket.sumBook > 0 ? bucket.sumMktCapPb / bucket.sumBook : null;
    series.push({
      date: bucket.date,
      peTtm,
      peTtmAll,
      pb,
      constituents: bucket.present,
      peSample: bucket.pePositive,
      pbSample: bucket.pbPositive,
      marketCap: bucket.sumMktCapPositive ?? null,
    });
  }

  series.sort((a, b) => (a.date < b.date ? -1 : 1));
  return series.filter((row) => row.peTtm !== null && row.pb !== null);
}

export async function loadConstituentHistories(constituents, options = {}) {
  const { concurrency = 6, cache = null, onProgress = null } = options;
  return pool(constituents, concurrency, async (item, index) => {
    const key = `em-valuation-${item.code}`;
    const cached = cache ? await cache.read(key) : null;
    if (cached) {
      onProgress?.({ code: item.code, index, total: constituents.length, cached: true });
      return { code: item.code, name: item.name, rows: cached, cached: true };
    }
    const rows = await fetchStockValuationHistory(item.code);
    if (cache) await cache.write(key, rows);
    onProgress?.({ code: item.code, index, total: constituents.length, cached: false });
    return { code: item.code, name: item.name, rows, cached: false };
  });
}
