import { fetchJson } from '../http.js';

const ENDPOINT = 'https://open.lixinger.com/api/cn/index/fundamental';

function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function isAvailable() {
  return Boolean(process.env.LIXINGER_TOKEN);
}

export async function fetchSeries(indexCode = '399006', options = {}) {
  const token = options.token || process.env.LIXINGER_TOKEN;
  if (!token) throw new Error('未配置 LIXINGER_TOKEN');
  const startDate = options.startDate || '2005-01-01';
  const metrics = 'pe_ttm.mcw,pb.mcw';
  const rows = [];
  let from = startDate;
  for (;;) {
    const search = new URLSearchParams({
      token,
      stockCodes: indexCode,
      metricsList: metrics,
      startDate: from,
      endDate: options.endDate || '',
      type: '0',
    });
    const json = await fetchJson(`${ENDPOINT}?${search}`, {
      timeout: 20000,
      retries: 2,
      headers: { 'Accept-Encoding': 'gzip, deflate' },
    });
    const data = Array.isArray(json?.data) ? json.data : [];
    if (data.length === 0) break;
    rows.push(...data);
    const lastDate = data[data.length - 1].date;
    if (data.length < 300 || lastDate === from) break;
    const next = new Date(lastDate);
    next.setDate(next.getDate() + 1);
    from = next.toISOString().slice(0, 10);
    if (from > (options.endDate || '2999-12-31')) break;
  }

  return rows
    .map((row) => ({
      date: String(row.date).slice(0, 10),
      peTtm: toNumber(row['pe_ttm.mcw'] ?? row.pe_ttm),
      peTtmAll: toNumber(row['pe_ttm.mcw'] ?? row.pe_ttm),
      pb: toNumber(row['pb.mcw'] ?? row.pb),
      constituents: null,
      peSample: null,
      pbSample: null,
      marketCap: toNumber(row.mc),
    }))
    .filter((row) => row.date && row.peTtm !== null && row.pb !== null)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}
