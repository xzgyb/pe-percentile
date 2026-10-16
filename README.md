# 创业板指数(399006) 估值历史百分位

返回创业板指当前 PE-TTM / PB 在历史样本中的百分位，并给出 20% / 50% / 80% 分位等参照值。
零依赖，只用 Node 内置 `fetch`（需要 Node >= 18）。

## 快速开始

```bash
node bin/cli.js                    # 创业板指 PE/PB 百分位（默认近 5 年窗口）
node bin/cli.js --windows          # 近1/3/5/10年 + 全部历史 一次对比
node bin/cli.js --pe-basis positive --metric pe
node bin/cli.js --years all
node bin/cli.js --json
node bin/cli.js --help
```

输出示例：

```
创业板指 (399006)  估值历史百分位
数据源 eastmoney | 口径 PE=整体法含亏损股 | 样本 2021-10-15 ~ 2026-10-15 (1212 个交易日) | 窗口 近5年
最新交易日 2026-10-15 | 成分股 100 只

指标               当前值  历史百分位    区间判定    最小  20%分位   中位数  80%分位    最大
PE-TTM(含亏损)      32.06       26.9%    偏低区间   23.71    30.50    38.72    50.01   71.03
PE-TTM(剔亏损)      28.23       21.6%    偏低区间   22.61    27.95    35.54    41.91   61.23
PB                   4.67       41.7%    合理区间    3.15     3.98     5.05     6.02    9.49
```

## 当作库使用

```js
import { getValuationPercentile, getValuationWindows } from './src/index.js';

const r = await getValuationPercentile({ years: 5 });

r.metrics.peTtm.percentile;          // 26.9
r.metrics.peTtm.current;             // 32.06
r.metrics.peTtm.level;               // '偏低区间'
r.metrics.peTtmAlternative.current;  // 28.23（另一口径）
r.metrics.pb.percentile;             // 41.7
r.window;                            // { start, end, years, samples }
r.asOf;                              // '2026-10-15'

const 对比 = await getValuationWindows([1, 3, 5, 10, null]); // 多窗口
```

常用参数：

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `index` | `'399006'` | 指数代码 |
| `metric` | `'both'` | `pe` / `pb` / `both` |
| `peBasis` | `'all'` | `all` 整体法含亏损股 / `positive` 整体法剔除亏损股 |
| `levelScheme` | `'rocket'` | `rocket` 10/30/70/90 五档 / `quintile` 20/40/60/80 五等分 |
| `years` | `null` | 历史窗口年数，`null` 表示全部 |
| `startDate` / `endDate` | `null` | 自定义区间 |
| `source` | `'auto'` | `auto` / `eastmoney` / `tushare` / `lixinger` |
| `concurrency` | `6` | 成分股并发抓取数 |
| `useCache` | `true` | 本地 JSON 缓存（默认 `.cache/`，12 小时过期） |
| `minCoverageRatio` | `0.6` | 某交易日至少要有这个比例的成分股有数据才纳入样本 |

CLI 额外参数：`--windows`（多窗口对比表）、`--progress`、`--no-cache`。


## 数据源

`--source auto` 会按 `tushare` → `lixinger` → `eastmoney` 的顺序选择可用的源。

| 源 | 是否需要 token | 说明 |
| --- | --- | --- |
| `eastmoney` | 否 | 东方财富数据中心。先取当前 100 只成分股，再取每只股票的日频 PE-TTM / PB(MRQ) / 总市值，整体法聚合成指数估值。免费、覆盖约 8 年，但用的是**当前成分股回溯**，存在幸存者偏差 |
| `tushare` | `TUSHARE_TOKEN` | `index_dailybasic`，官方指数 PE/PE-TTM/PB，2004 年起。需要 2000 积分 |
| `lixinger` | `LIXINGER_TOKEN` | 理杏仁 `index/fundamental`，市值加权 PE-TTM / PB。免费 token |

```bash
TUSHARE_TOKEN=xxx node bin/cli.js --source tushare
LIXINGER_TOKEN=xxx node bin/cli.js --source lixinger
```

## 计算口径

**百分位** = 历史样本中严格小于当前值的比例（0%~100%）。100% 说明当前估值高于历史上任何一个交易日。

分档方案 `levelScheme`，默认 `rocket`（与红色火箭小程序一致）：

| 分位 | rocket（默认） | quintile |
| --- | --- | --- |
| ≤ 10% | 过低 | 低估区间（<20%） |
| 10% ~ 30% | 偏低 | 偏低区间（20%~40%） |
| 30% ~ 70% | 适中 | 合理区间（40%~60%） |
| 70% ~ 90% | 偏高 | 偏高区间（60%~80%） |
| > 90% | 过高 | 高估区间（≥80%） |

```bash
node bin/cli.js --level-scheme quintile   # 切回 20/40/60/80 的五等分口径
```

```js
import { levelLabel, LEVEL_SCHEMES } from './src/index.js';

levelLabel(26.9);                    // '偏低'
levelLabel(26.9, 'quintile');        // '合理区间'
LEVEL_SCHEMES.rocket.bands;          // 分档定义，可自定义扩展
```


**指数 PE 整体法**

```
PE(含亏损) = Σ全部成分股市值 / Σ全部成分股 TTM 净利润     # 默认口径，亏损股净利润为负，拉大分母
PE(剔亏损) = Σ盈利成分股市值 / Σ盈利成分股 TTM 净利润
```

`peBasis: 'all'`（默认）用含亏损口径，这与交易所/中证/国证发布的指数 PE 以及各类小程序（如红色火箭）一致；
`peBasis: 'positive'` 剔除亏损股，数值会低 10% 左右。两者会同时输出在 `metrics.peTtm` 和 `metrics.peTtmAlternative`。

**指数 PB**

```
PB = Σ成分股市值 / Σ成分股市值 / PB_MRQ_i
```

**样本过滤**：某个交易日只有当有数据的成分股数量 ≥ `max(30, 60% × 成分股总数)` 时才计入历史样本，避免早期成分股数量过少造成的失真。

## 与其他数据源对不上的原因

对同一交易日（2026-10-15）实测：

| 口径 | 本程序 | 红色火箭小程序 |
| --- | --- | --- |
| PE-TTM（近 5 年） | 32.06 | 32.05 |
| 历史百分位（近 5 年） | 26.90% | 31.35% |

**估值数值已完全对齐**，前提是用**整体法含亏损**口径（`--pe-basis positive` 是 28.23，对不上）。

**百分位差 4.5pp**，已逐项排除的可能：

| 假设 | 实测 | 结论 |
| --- | --- | --- |
| 窗口长度不同 | 5 年 = 1212 个交易日；31.35% = 380/1212，样本数一致 | 排除 |
| `<` vs `<=` | 26.90% / 27.00% | 排除 |
| 月度采样 | 14.15% | 排除 |
| 当前值日期不同 | 同为 2026-10-15 | 排除 |
| PE 口径不同 | 当前值已对上 | 排除 |

剩余差异 = 1212 个交易日里有 54 天的位置不同，等价于「对方历史 PE 序列整体比本程序低约 4%」
（实测：把历史序列乘 0.96，分位正好变成 31.35%）。候选原因：

1. **成分股回溯偏差（最可能）**。免费接口只给**当前** 100 只成分股，今天的名单已明显漂向高 PE 的成长股；
   回填到 2023-2025 年时缺失了当时低 PE / 亏损的成分股 → 历史 PE 偏高 → 历史百分位被压低。
   已验证东财免费接口不提供历史成分股（按日期过滤返回「返回数据为空」），
   要消除这个偏差只能用 `tushare`（`index_weight` 历史成分股）或 `lixinger`（官方口径 PE）。
2. **复合口径**。`0.7 × PE分位 + 0.3 × PB分位 = 0.7×26.90 + 0.3×41.75 = 31.35%`，数字精确命中，
   但这个 7:3 权重是反推出来的，没有证据支持，不作为结论。
3. **TTM 净利润的更新时点 / 停牌日处理**差异。

**怎么定案**：`--dump` 导出逐日序列，和对方曲线逐日对齐：

```bash
node bin/cli.js --dump cn399006.csv
# date,peTtmIncludingLoss,peTtmExcludingLoss,pb,constituents,peSample,pbSample
```


## 已知局限

- `eastmoney` 源使用**当前**成分股名单回溯历史，存在幸存者偏差，会低估历史百分位。
- 聚合值与交易所/中证官方发布的指数 PE 可能存在小幅差异（成分股权重、加权方式、是否剔除亏损股的口径不同）。
- 首次运行需要抓取 100 只成分股的历史数据（约 20 秒），结果缓存在 `.cache/`，之后秒级返回。

## 测试

```bash
npm test
```
