import { createCache } from './cache.js';
import {
  describe,
  LEVEL_SCHEMES,
  sliceByRange,
  sliceByYears,
} from './percentile.js';
import * as eastmoney from './sources/eastmoney.js';
import * as tushare from './sources/tushare.js';
import * as lixinger from './sources/lixinger.js';

export const DEFAULT_INDEX = '399006';

const SOURCES = { eastmoney, tushare, lixinger };

function resolveSource(preferred) {
  if (preferred && preferred !== 'auto') {
    if (!SOURCES[preferred]) throw new Error(`未知数据源: ${preferred}`);
    return preferred;
  }
  if (tushare.isAvailable()) return 'tushare';
  if (lixinger.isAvailable()) return 'lixinger';
  return 'eastmoney';
}

async function buildSeries(source, indexCode, options) {
  if (source === 'tushare') {
    return {
      series: await tushare.fetchSeries(indexCode, options),
      indexName: indexCode,
      constituents: null,
      note: 'tushare index_dailybasic 官方指数估值',
    };
  }
  if (source === 'lixinger') {
    return {
      series: await lixinger.fetchSeries(indexCode, options),
      indexName: indexCode,
      constituents: null,
      note: '理杏仁指数估值 PE-TTM/PB (市值加权)',
    };
  }
  const meta = await eastmoney.fetchIndexConstituents(indexCode);
  const histories = await eastmoney.loadConstituentHistories(meta.constituents, {
    concurrency: options.concurrency,
    cache: options.cache,
    onProgress: options.onProgress,
  });
  return {
    series: eastmoney.aggregateValuation(
      histories.map((h) => h.rows),
      {
        minCoverageRatio: options.minCoverageRatio,
        minConstituents: options.minConstituents,
        lossMakersInDenominator: options.lossMakersInDenominator,
      },
    ),
    indexName: meta.indexName,
    constituents: histories.length,
    note: '东方财富数据中心：按当前成分股整体法聚合 PE-TTM / PB（存在成分股回溯偏差）',
  };
}

export async function getValuationPercentile(options = {}) {
  const {
    index = DEFAULT_INDEX,
    metric = 'both',
    peBasis = 'all',
    levelScheme = 'rocket',
    years = null,
    startDate = null,
    endDate = null,
    source = 'auto',
    cacheDir = '.cache',
    useCache = true,
    cacheTtlMs = 12 * 3600 * 1000,
    concurrency = 6,
    minCoverageRatio = 0.6,
    minConstituents = 30,
    lossMakersInDenominator = true,
    onProgress = null,
  } = options;

  if (!['all', 'positive'].includes(peBasis)) {
    throw new Error(`peBasis 只能是 all 或 positive，收到: ${peBasis}`);
  }
  if (!LEVEL_SCHEMES[levelScheme]) {
    throw new Error(`levelScheme 只能是 ${Object.keys(LEVEL_SCHEMES).join(' / ')}，收到: ${levelScheme}`);
  }

  const chosen = resolveSource(source);
  const cache = createCache(cacheDir, { ttlMs: cacheTtlMs, enabled: useCache });

  const built = await buildSeries(chosen, index, {
    ...options,
    cache,
    concurrency,
    minCoverageRatio,
    minConstituents,
    lossMakersInDenominator,
  });

  const full = built.series;
  if (full.length === 0) {
    throw new Error(`${chosen} 未返回 ${index} 的估值历史数据`);
  }

  const asOf = full[full.length - 1].date;
  let window = full;
  if (years) window = sliceByYears(window, asOf, years);
  if (startDate || endDate) window = sliceByRange(window, startDate, endDate);
  if (window.length === 0) throw new Error('指定的时间窗口内没有数据');

  const latest = window[window.length - 1];
  const wantPe = metric === 'both' || metric === 'pe' || metric === 'peTtm';
  const wantPb = metric === 'both' || metric === 'pb';

  const metrics = {};
  if (wantPe) {
    const peAll = (r) => r.peTtmAll ?? r.peTtm;
    const pePositive = (r) => r.peTtm;
    const primary = peBasis === 'positive' ? pePositive : peAll;
    metrics.peTtm = describe(window.map(primary), primary(latest), { levelScheme });
    const alternative = peBasis === 'positive' ? peAll : pePositive;
    const altValue = alternative(latest);
    if (altValue !== null && altValue !== undefined) {
      metrics.peTtmAlternative = describe(window.map(alternative), altValue, { levelScheme });
      metrics.peTtmAlternative.peBasis = peBasis === 'positive' ? 'all' : 'positive';
    }
    metrics.peBasis = peBasis;
  }
  if (wantPb) {
    metrics.pb = describe(
      window.map((r) => r.pb),
      latest.pb,
      { levelScheme },
    );
  }

  return {
    index: {
      code: index,
      name: built.indexName,
      constituents: built.constituents,
    },
    source: chosen,
    note: built.note,
    peBasis: peBasis === 'all' ? '整体法含亏损股' : '整体法剔除亏损股',
    levelScheme,
    asOf,
    latest: {
      date: latest.date,
      peTtm: peBasis === 'positive' ? latest.peTtm : latest.peTtmAll ?? latest.peTtm,
      peTtmExcludingLoss: latest.peTtm,
      pb: latest.pb,
      constituents: latest.constituents,
    },
    window: {
      start: window[0].date,
      end: latest.date,
      years,
      samples: window.length,
    },
    metrics,
    generatedAt: new Date().toISOString(),
  };
}

export async function getValuationSeries(options = {}) {
  const {
    index = DEFAULT_INDEX,
    source = 'auto',
    cacheDir = '.cache',
    useCache = true,
    cacheTtlMs = 12 * 3600 * 1000,
    concurrency = 6,
    minCoverageRatio = 0.6,
    minConstituents = 30,
    lossMakersInDenominator = true,
    onProgress = null,
  } = options;

  const chosen = resolveSource(source);
  const cache = createCache(cacheDir, { ttlMs: cacheTtlMs, enabled: useCache });
  const built = await buildSeries(chosen, index, {
    ...options,
    cache,
    concurrency,
    minCoverageRatio,
    minConstituents,
    lossMakersInDenominator,
  });
  return {
    index: { code: index, name: built.indexName, constituents: built.constituents },
    source: chosen,
    peBasis: lossMakersInDenominator ? '整体法含亏损股' : '整体法剔除亏损股',
    series: built.series,
  };
}

export async function getValuationWindows(windows, options = {}) {
  const list = windows && windows.length ? windows : [1, 3, 5, 10, null];
  const results = [];
  for (const years of list) {
    results.push(await getValuationPercentile({ ...options, years }));
  }
  return results;
}

export { eastmoney, tushare, lixinger };
export { describe, percentileRank, quantile, levelLabel, LEVEL_SCHEMES } from './percentile.js';
