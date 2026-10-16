import test from 'node:test';
import assert from 'node:assert/strict';

import {
  describe as describeSeries,
  levelLabel,
  percentileRank,
  quantile,
  sliceByRange,
  sliceByYears,
} from '../src/percentile.js';
import { aggregateValuation } from '../src/sources/eastmoney.js';
import { getValuationPercentile } from '../src/index.js';

test('getValuationPercentile 校验 peBasis', async () => {
  await assert.rejects(
    () => getValuationPercentile({ peBasis: 'median' }),
    /peBasis/,
  );
});

test('percentileRank 按“小于当前值的样本占比”计算', () => {
  const values = [1, 2, 3, 4, 5];
  assert.equal(percentileRank(values, 1), 0);
  assert.equal(percentileRank(values, 3), 40);
  assert.equal(percentileRank(values, 5), 80);
  assert.equal(percentileRank(values, 6), 100);
  assert.equal(percentileRank(values, 0), 0);
  assert.ok(Number.isNaN(percentileRank([], 3)));
});

test('percentileRank 忽略非法值', () => {
  const values = [1, null, 3, 'x', 5];
  assert.equal(percentileRank(values, 3), 50);
});

test('quantile 线性插值', () => {
  const sorted = [1, 2, 3, 4];
  assert.equal(quantile(sorted, 0), 1);
  assert.equal(quantile(sorted, 0.5), 2.5);
  assert.equal(quantile(sorted, 1), 4);
  assert.equal(quantile([7], 0.3), 7);
  assert.ok(Number.isNaN(quantile([], 0.5)));
});

test('levelLabel 红色火箭口径五档分界', () => {
  assert.equal(levelLabel(0), '过低');
  assert.equal(levelLabel(10), '过低');
  assert.equal(levelLabel(10.01), '偏低');
  assert.equal(levelLabel(30), '偏低');
  assert.equal(levelLabel(30.01), '适中');
  assert.equal(levelLabel(70), '适中');
  assert.equal(levelLabel(70.01), '偏高');
  assert.equal(levelLabel(90), '偏高');
  assert.equal(levelLabel(90.01), '过高');
  assert.equal(levelLabel(100), '过高');
  assert.equal(levelLabel(NaN), '未知');
});

test('levelLabel 五等分口径 20/40/60/80', () => {
  assert.equal(levelLabel(19.99, 'quintile'), '低估区间');
  assert.equal(levelLabel(20, 'quintile'), '偏低区间');
  assert.equal(levelLabel(39.99, 'quintile'), '偏低区间');
  assert.equal(levelLabel(40, 'quintile'), '合理区间');
  assert.equal(levelLabel(59.99, 'quintile'), '合理区间');
  assert.equal(levelLabel(60, 'quintile'), '偏高区间');
  assert.equal(levelLabel(79.99, 'quintile'), '偏高区间');
  assert.equal(levelLabel(80, 'quintile'), '高估区间');
});

test('levelLabel 拒绝未知方案', () => {
  assert.throws(() => levelLabel(50, 'gauss'), /未知的分档方案/);
});

test('describe 输出完整统计量', () => {
  const stats = describeSeries([10, 20, 30, 40, 50], 30);
  assert.equal(stats.samples, 5);
  assert.equal(stats.current, 30);
  assert.equal(stats.percentile, 40);
  assert.equal(stats.level, '适中');
  assert.equal(stats.levelScheme, 'rocket');
  assert.equal(stats.min, 10);
  assert.equal(stats.max, 50);
  assert.equal(stats.median, 30);
  assert.equal(stats.p20, 18);
  assert.equal(stats.p80, 42);
  assert.equal(stats.avg, 30);
});

test('describe 遵循 levelScheme', () => {
  const values = [10, 20, 30, 40, 50];
  assert.equal(describeSeries(values, 30, { levelScheme: 'rocket' }).level, '适中');
  assert.equal(describeSeries(values, 30, { levelScheme: 'quintile' }).level, '合理区间');
});

test('sliceByYears 以 asOf 为基准向前取窗口', () => {
  const records = [
    { date: '2019-01-02' },
    { date: '2021-01-04' },
    { date: '2024-01-02' },
  ];
  assert.deepEqual(sliceByYears(records, '2024-01-02', 4), records.slice(1));
  assert.deepEqual(sliceByYears(records, '2024-01-02', 2), records.slice(2));
  assert.deepEqual(sliceByYears(records, '2024-01-02', null), records);
});

test('sliceByRange 支持自定义区间', () => {
  const records = [{ date: '2020-01-01' }, { date: '2021-01-01' }, { date: '2022-01-01' }];
  assert.deepEqual(sliceByRange(records, '2020-06-01', '2021-12-31'), [records[1]]);
});

function row(date, peTtm, pb, marketCap) {
  return { date, peTtm, pb, marketCap };
}

test('aggregateValuation 用整体法聚合指数 PE/PB', () => {
  const histories = [
    [row('2024-01-02', 10, 2, 1000), row('2024-01-03', 5, 2, 1000)],
    [row('2024-01-02', 20, 4, 2000), row('2024-01-03', 5, 2, 1000)],
  ];
  const series = aggregateValuation(histories, { minCoverageRatio: 1, minConstituents: 1 });
  assert.equal(series.length, 2);
  const first = series[0];
  const earningsPositive = 1000 / 10 + 2000 / 20;
  assert.equal(first.peTtm, 3000 / earningsPositive);
  const book = 1000 / 2 + 2000 / 4;
  assert.equal(first.pb, 3000 / book);
  assert.equal(first.constituents, 2);
  assert.equal(first.date, '2024-01-02');
});

test('aggregateValuation 剔除亏损股的负盈利', () => {
  const histories = [
    [row('2024-01-02', 4, 1, 1000)],
    [row('2024-01-02', -5, 1, 1000)],
  ];
  const [positive] = aggregateValuation(histories, { minCoverageRatio: 1, minConstituents: 1 });
  assert.equal(positive.peTtm, 4);
  assert.equal(positive.peSample, 1);
  assert.equal(positive.peTtmAll, null);

  const [withLoss] = aggregateValuation(histories, {
    minCoverageRatio: 1,
    minConstituents: 1,
    lossMakersInDenominator: true,
  });
  const earningsAll = 1000 / 4 + 1000 / -5;
  assert.equal(withLoss.peTtmAll, 2000 / earningsAll);
});

test('aggregateValuation 整体法下整体亏损时 PE 置空', () => {
  const histories = [
    [row('2024-01-02', 10, 1, 1000)],
    [row('2024-01-02', -2, 1, 1000)],
  ];
  const [row_] = aggregateValuation(histories, {
    minCoverageRatio: 1,
    minConstituents: 1,
    lossMakersInDenominator: true,
  });
  assert.equal(row_.peTtmAll, null);
  assert.equal(row_.peTtm, 10);
});

test('aggregateValuation 按覆盖度丢弃样本不足的交易日', () => {
  const histories = [
    [row('2024-01-02', 10, 1, 1000), row('2024-01-03', 10, 1, 1000)],
    [row('2024-01-02', 10, 1, 1000)],
    [row('2024-01-02', 10, 1, 1000)],
  ];
  const series = aggregateValuation(histories, { minCoverageRatio: 0.9, minConstituents: 1 });
  assert.deepEqual(series.map((s) => s.date), ['2024-01-02']);
});

test('aggregateValuation 结果按日期升序', () => {
  const histories = [
    [row('2024-01-03', 10, 1, 1000), row('2024-01-02', 10, 1, 1000)],
  ];
  const series = aggregateValuation(histories, { minCoverageRatio: 0.5, minConstituents: 1 });
  assert.deepEqual(series.map((s) => s.date), ['2024-01-02', '2024-01-03']);
});
