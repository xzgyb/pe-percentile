import { fetchJsonPost } from '../http.js';

const ENDPOINT = 'https://api.tushare.pro';
const PAGE_SIZE = 5000;

const INDEX_MAP = {
  '399006': '399006.SZ',
  '399001': '399001.SZ',
  '000300': '000300.SH',
  '000001': '000001.SH',
  '000905': '000905.SH',
  '000852': '000852.SH',
  '000688': '000688.SH',
};

function toSeries(rows, indexCode) {
  return rows
    .map((row) => ({
      date: row.date,
      peTtm: row.peTtm,
      peTtmAll: row.peTtm,
      pb: row.pb,
      constituents: null,
      peSample: null,
      pbSample: null,
      marketCap: row.totalMv,
    }))
    .filter((row) => row.date && row.peTtm !== null && row.pb !== null)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function isAvailable() {
  return Boolean(process.env.TUSHARE_TOKEN);
}

export async function fetchSeries(indexCode = '399006', options = {}) {
  const token = options.token || process.env.TUSHARE_TOKEN;
  if (!token) throw new Error('未配置 TUSHARE_TOKEN');
  const tsCode = INDEX_MAP[indexCode] || `${indexCode}.SZ`;
  const collected = [];
  let offset = 0;
  for (;;) {
    const payload = {
      api_name: 'index_dailybasic',
      token,
      params: { ts_code: tsCode, offset, limit: PAGE_SIZE },
      fields: 'ts_code,trade_date,total_mv,pe,pe_ttm,pb',
    };
    const json = await fetchJsonPost(ENDPOINT, payload, { timeout: 20000, retries: 2 });
    if (json.code !== 0) throw new Error(`tushare 接口报错: ${json.msg} (code=${json.code})`);
    const { fields, items } = json.data || {};
    if (!items || items.length === 0) break;
    for (const item of items) {
      const row = {};
      fields.forEach((key, i) => {
        row[key] = item[i];
      });
      collected.push({
        date: String(row.trade_date).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
        peTtm: row.pe_ttm === null ? null : Number(row.pe_ttm),
        pb: row.pb === null ? null : Number(row.pb),
        totalMv: row.total_mv === null ? null : Number(row.total_mv),
      });
    }
    offset += PAGE_SIZE;
    if (items.length < PAGE_SIZE) break;
  }
  return toSeries(collected, indexCode);
}
