export function toFiniteNumbers(values) {
  return values
    .map((v) => (typeof v === 'number' ? v : Number(v)))
    .filter((v) => Number.isFinite(v));
}

export function quantile(sortedAsc, q) {
  const n = sortedAsc.length;
  if (n === 0) return NaN;
  if (n === 1) return sortedAsc[0];
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}

export function percentileRank(values, current) {
  const nums = toFiniteNumbers(values);
  if (nums.length === 0 || !Number.isFinite(current)) return NaN;
  let below = 0;
  for (const v of nums) {
    if (v < current) below += 1;
  }
  return (below / nums.length) * 100;
}

export function mean(values) {
  const nums = toFiniteNumbers(values);
  if (nums.length === 0) return NaN;
  let sum = 0;
  for (const v of nums) sum += v;
  return sum / nums.length;
}

export const LEVEL_SCHEMES = {
  rocket: {
    label: '五档(红色火箭口径)',
    inclusive: true,
    bands: [
      { max: 10, name: '过低' },
      { max: 30, name: '偏低' },
      { max: 70, name: '适中' },
      { max: 90, name: '偏高' },
      { max: Infinity, name: '过高' },
    ],
  },
  quintile: {
    label: '五等分(20/40/60/80)',
    inclusive: false,
    bands: [
      { max: 20, name: '低估区间' },
      { max: 40, name: '偏低区间' },
      { max: 60, name: '合理区间' },
      { max: 80, name: '偏高区间' },
      { max: Infinity, name: '高估区间' },
    ],
  },
};

export function levelLabel(percentile, scheme = 'rocket') {
  const definition = LEVEL_SCHEMES[scheme];
  if (!definition) throw new Error(`未知的分档方案: ${scheme}`);
  if (!Number.isFinite(percentile)) return '未知';
  for (const band of definition.bands) {
    if (definition.inclusive ? percentile <= band.max : percentile < band.max) return band.name;
  }
  return definition.bands[definition.bands.length - 1].name;
}

export function describe(values, current, options = {}) {
  const { levelScheme = 'rocket' } = options;
  const nums = toFiniteNumbers(values).sort((a, b) => a - b);
  const percentile = percentileRank(nums, current);
  return {
    samples: nums.length,
    current: Number.isFinite(current) ? current : null,
    percentile,
    level: levelLabel(percentile, levelScheme),
    levelScheme,
    min: nums.length ? nums[0] : null,
    p20: quantile(nums, 0.2),
    median: quantile(nums, 0.5),
    p80: quantile(nums, 0.8),
    max: nums.length ? nums[nums.length - 1] : null,
    avg: mean(nums),
  };
}

export function sliceByYears(records, asOf, years) {
  if (!years || !Number.isFinite(years)) return records;
  const end = new Date(`${asOf}T00:00:00Z`).getTime();
  const start = end - years * 365.25 * 24 * 3600 * 1000;
  return records.filter((r) => {
    const t = new Date(`${r.date}T00:00:00Z`).getTime();
    return t >= start && t <= end;
  });
}

export function sliceByRange(records, startDate, endDate) {
  return records.filter((r) => {
    if (startDate && r.date < startDate) return false;
    if (endDate && r.date > endDate) return false;
    return true;
  });
}
