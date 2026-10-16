#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import {
  getValuationPercentile,
  getValuationSeries,
  getValuationWindows,
} from '../src/index.js';

let lastLogged = 0;

const USAGE = `创业板指数(399006) 估值历史百分位

用法:
  chinext-valuation [选项]

选项:
  --index <code>        指数代码，默认 399006（创业板指）
  --metric <m>          pe | pb | both，默认 both
  --pe-basis <b>        all | positive，默认 all
                        all      = 整体法含亏损股（Σ总市值/Σ净利润，亏损股拉低盈利）
                        positive = 整体法剔除亏损股
  --level-scheme <s>    rocket | quintile，默认 rocket
                        rocket   = 过低≤10% 偏低≤30% 适中≤70% 偏高≤90% 过高>90%
                        quintile = 低估<20% 偏低<40% 合理<60% 偏高<80% 高估≥80%
  --years <n>           历史窗口年数，默认 5；传 all 表示全部历史
  --windows             一次输出 近1/3/5/10年 + 全部历史 的百分位对比
  --dump <file>         导出每日 PE/PB 原始序列为 CSV，用于和其它来源逐日对账
  --from <YYYY-MM-DD>   起始日期
  --to <YYYY-MM-DD>     结束日期
  --source <s>          auto | eastmoney | tushare | lixinger，默认 auto
  --concurrency <n>     成分股并发抓取数，默认 6
  --no-cache            禁用本地缓存
  --progress            抓取时打印进度
  --json                输出 JSON
  -h, --help            显示帮助

百分位定义: 历史样本中小于当前值的比例 (0%~100%)，
20% 以下视为低估区间，80% 以上视为高估区间。`;

function parseArgs(argv) {
  const args = {
    metric: 'both',
    source: 'auto',
    useCache: true,
    peBasis: 'all',
    levelScheme: 'rocket',
    years: 5,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case '--index': args.index = next(); break;
      case '--metric': args.metric = next(); break;
      case '--pe-basis': args.peBasis = next(); break;
      case '--level-scheme': args.levelScheme = next(); break;
      case '--years': {
        const value = next();
        args.years = value === 'all' ? null : Number(value);
        break;
      }
      case '--windows': args.windows = true; break;
      case '--dump': args.dump = next(); break;
      case '--from': args.startDate = next(); break;
      case '--to': args.endDate = next(); break;
      case '--source': args.source = next(); break;
      case '--concurrency': args.concurrency = Number(next()); break;
      case '--cache-dir': args.cacheDir = next(); break;
      case '--no-cache': args.useCache = false; break;
      case '--progress': args.progress = true; break;
      case '--json': args.json = true; break;
      case '-h':
      case '--help': args.help = true; break;
      default:
        if (arg.startsWith('-')) throw new Error(`未知参数: ${arg}`);
    }
  }
  return args;
}

function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  return n.toFixed(digits);
}

function fmtPct(n) {
  if (!Number.isFinite(n)) return '-';
  return `${n.toFixed(1)}%`;
}

const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/;

function width(str) {
  let w = 0;
  for (const ch of String(str)) w += WIDE.test(ch) ? 2 : 1;
  return w;
}

function pad(str, size, align = 'left') {
  const gap = Math.max(0, size - width(str));
  if (align === 'right') return ' '.repeat(gap) + str;
  if (align === 'center') {
    const left = Math.floor(gap / 2);
    return ' '.repeat(left) + str + ' '.repeat(gap - left);
  }
  return str + ' '.repeat(gap);
}

function render(result) {
  const lines = [];
  const { index, asOf, window, metrics, source } = result;
  lines.push(`${index.name} (${index.code})  估值历史百分位`);
  lines.push(
    `数据源 ${source} | 口径 PE=${result.peBasis} | 样本 ${window.start} ~ ${window.end} (${window.samples} 个交易日)` +
      (window.years ? ` | 窗口 近${window.years}年` : ' | 窗口 全部历史'),
  );
  lines.push(
    `最新交易日 ${asOf}` + (index.constituents ? ` | 成分股 ${index.constituents} 只` : ''),
  );
  lines.push('');

  const rows = [];
  if (metrics.peTtm) {
    rows.push([metrics.peBasis === 'positive' ? 'PE-TTM(剔亏损)' : 'PE-TTM(含亏损)', metrics.peTtm]);
  }
  if (metrics.peTtmAlternative) {
    rows.push([
      metrics.peTtmAlternative.peBasis === 'positive' ? 'PE-TTM(剔亏损)' : 'PE-TTM(含亏损)',
      metrics.peTtmAlternative,
    ]);
  }
  if (metrics.pb) rows.push(['PB', metrics.pb]);

  const widths = [16, 9, 12, 12, 8, 9, 9, 9, 8];
  const head = ['指标', '当前值', '历史百分位', '区间判定', '最小', '20%分位', '中位数', '80%分位', '最大'];
  lines.push(head.map((h, i) => pad(h, widths[i], i === 0 ? 'left' : 'right')).join(''));
  for (const [label, m] of rows) {
    lines.push(
      [
        pad(label, widths[0]),
        pad(fmt(m.current), widths[1], 'right'),
        pad(fmtPct(m.percentile), widths[2], 'right'),
        pad(m.level, widths[3], 'right'),
        pad(fmt(m.min), widths[4], 'right'),
        pad(fmt(m.p20), widths[5], 'right'),
        pad(fmt(m.median), widths[6], 'right'),
        pad(fmt(m.p80), widths[7], 'right'),
        pad(fmt(m.max), widths[8], 'right'),
      ].join(''),
    );
  }
  if (result.note) {
    lines.push('');
    lines.push(`备注: ${result.note}`);
  }
  return lines.join('\n');
}

function renderWindows(results) {
  const lines = [];
  const first = results[0];
  lines.push(`${first.index.name} (${first.index.code})  估值百分位多窗口对比`);
  lines.push(`数据源 ${first.source} | 口径 PE=${first.peBasis} | 最新交易日 ${first.asOf}`);
  lines.push('');
  const head = ['窗口', '样本数', 'PE-TTM', 'PE分位', 'PE判定', 'PB', 'PB分位', 'PB判定'];
  const widths = [14, 8, 10, 10, 12, 10, 10, 12];
  lines.push(head.map((h, i) => pad(h, widths[i], i === 0 ? 'left' : 'right')).join(''));
  for (const r of results) {
    const label = r.window.years ? `近${r.window.years}年` : '全部历史';
    const cells = [
      pad(label, widths[0]),
      pad(String(r.window.samples), widths[1], 'right'),
      pad(fmt(r.latest.peTtm), widths[2], 'right'),
      pad(fmtPct(r.metrics.peTtm?.percentile), widths[3], 'right'),
      pad(r.metrics.peTtm?.level ?? '-', widths[4], 'right'),
      pad(fmt(r.latest.pb), widths[5], 'right'),
      pad(fmtPct(r.metrics.pb?.percentile), widths[6], 'right'),
      pad(r.metrics.pb?.level ?? '-', widths[7], 'right'),
    ];
    lines.push(cells.join(''));
  }
  return lines.join('\n');
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const onProgress = args.progress
    ? ({ index, total }) => {
        const now = Date.now();
        if (now - lastLogged > 500 || index === total - 1) {
          lastLogged = now;
          process.stderr.write(`\r抓取成分股估值 ${index + 1}/${total}   `);
        }
      }
    : null;

  const base = { ...args, onProgress };
  if (args.json) delete base.windows;

  try {
    if (args.dump) {
      const { series, index, source, peBasis } = await getValuationSeries(base);
      const header = 'date,peTtmIncludingLoss,peTtmExcludingLoss,pb,constituents,peSample,pbSample';
      const body = series
        .map((r) =>
          [
            r.date,
            r.peTtmAll?.toFixed(4) ?? '',
            r.peTtm?.toFixed(4) ?? '',
            r.pb?.toFixed(4) ?? '',
            r.constituents ?? '',
            r.peSample ?? '',
            r.pbSample ?? '',
          ].join(','),
        )
        .join('\n');
      await writeFile(args.dump, `${header}\n${body}\n`, 'utf8');
      console.log(
        `已导出 ${series.length} 个交易日到 ${args.dump} (${index.name}/${source}/${peBasis})`,
      );
      return;
    }
    const result = args.windows
      ? await getValuationWindows([1, 3, 5, 10, null], base)
      : await getValuationPercentile(base);
    if (args.progress) process.stderr.write('\r\x1b[K');
    console.log(
      args.json ? JSON.stringify(result, null, 2) : args.windows ? renderWindows(result) : render(result),
    );
  } catch (err) {
    process.stderr.write('\r\x1b[K');
    console.error(`错误: ${err.message}`);
    process.exitCode = 1;
  }
}

main();
