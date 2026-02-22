// src/stats.js
export function computeStats(draws, opts = {}) {
  const {
    maxNumber = 37,
    windowSize = 200,      // חלון "אחרונות" לחמים/קרים עדכניים
    topPairs = 15,         // כמה זוגות להציג
    includePairs = true
  } = opts;

  // draws: מערך של { main: [..6 numbers..], strong: number, date?: string, drawNo?: string }
  const N = draws.length;
  if (!N) throw new Error("No draws provided");

  const clampWindow = Math.max(1, Math.min(windowSize, N));
  const recent = draws.slice(0, clampWindow); // בהנחה שהדאטה מסודר מהחדש לישן

  // --- תדירויות ---
  const freqAll = Array(maxNumber + 1).fill(0);
  const freqRecent = Array(maxNumber + 1).fill(0);

  // --- Overdue (כמה הגרלות מאז הופעה אחרונה) ---
  // 0 = הופיע בהגרלה האחרונה, 1 = לפני 1 הגרלות, ... Infinity = לא הופיע כלל
  const lastSeenIndex = Array(maxNumber + 1).fill(null); // אינדקס ב-draws (0=חדש)
  
  // --- זוגות ---
  const pairCounts = new Map(); // key "a-b" -> count

  const addPairsFromMain = (nums) => {
    const sorted = [...nums].sort((a,b)=>a-b);
    for (let i=0; i<sorted.length; i++) {
      for (let j=i+1; j<sorted.length; j++) {
        const a = sorted[i], b = sorted[j];
        const key = `${a}-${b}`;
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
      }
    }
  };

  // עובר על כל ההגרלות
  for (let i = 0; i < N; i++) {
    const d = draws[i];
    const main = d.main || [];
    for (const num of main) {
      if (num >= 1 && num <= maxNumber) {
        freqAll[num]++;
        if (lastSeenIndex[num] === null) lastSeenIndex[num] = i; // פעם ראשונה מהחדש => הופעה אחרונה
      }
    }
    if (includePairs && main.length) addPairsFromMain(main);
  }

  // תדירויות בחלון האחרון
  for (let i = 0; i < clampWindow; i++) {
    const d = recent[i];
    const main = d.main || [];
    for (const num of main) {
      if (num >= 1 && num <= maxNumber) freqRecent[num]++;
    }
  }

  // --- סטטיסטיקה תאורטית: expected ו-zscore ---
  // בכל הגרלה יש 6 מספרים "מיין" מתוך 37 => p = 6/37 לכל מספר בכל הגרלה
  const p = 6 / maxNumber;
  const expected = N * p;
  const variance = N * p * (1 - p);
  const sd = Math.sqrt(variance);

  const zScores = Array(maxNumber + 1).fill(0);
  for (let num = 1; num <= maxNumber; num++) {
    zScores[num] = sd > 0 ? (freqAll[num] - expected) / sd : 0;
  }

  // --- Chi-square כולל ---
  // sum((obs-exp)^2/exp) על 1..37
  let chiSquare = 0;
  for (let num = 1; num <= maxNumber; num++) {
    const obs = freqAll[num];
    chiSquare += ((obs - expected) ** 2) / (expected || 1);
  }
  const df = maxNumber - 1;

  // --- Hot / Cold ---
  // HOT = הכי הרבה הופעות, COLD = הכי מעט הופעות
  const listAll = [];
  const listRecent = [];
  for (let num = 1; num <= maxNumber; num++) {
    const overdue = (lastSeenIndex[num] === null) ? Infinity : lastSeenIndex[num];
    listAll.push({
      num,
      count: freqAll[num],
      pct: (freqAll[num] / (N * 6)) * 100,
      z: zScores[num],
      overdue
    });
    listRecent.push({
      num,
      count: freqRecent[num],
      pct: (freqRecent[num] / (clampWindow * 6)) * 100
    });
  }

  const sortDescCount = (a,b) => b.count - a.count || a.num - b.num;
  const sortAscCount  = (a,b) => a.count - b.count || a.num - b.num;

  const hotAll = [...listAll].sort(sortDescCount).slice(0, 10);
  const coldAll = [...listAll].sort(sortAscCount).slice(0, 10);

  const hotRecent = [...listRecent].sort(sortDescCount).slice(0, 10);
  const coldRecent = [...listRecent].sort(sortAscCount).slice(0, 10);

  const overdueTop = [...listAll]
    .filter(x => Number.isFinite(x.overdue))
    .sort((a,b) => b.overdue - a.overdue)
    .slice(0, 10);

  // זוגות נפוצים
  let topPairList = [];
  if (includePairs) {
    topPairList = [...pairCounts.entries()]
      .map(([key, count]) => {
        const [a,b] = key.split("-").map(Number);
        return { a, b, count };
      })
      .sort((x,y) => y.count - x.count || x.a - y.a || x.b - y.b)
      .slice(0, topPairs);
  }

  return {
    meta: {
      totalDraws: N,
      windowSize: clampWindow,
      maxNumber,
      expectedPerNumber: expected,
      sdPerNumber: sd,
      chiSquare,
      df
    },
    tables: {
      all: listAll.sort((a,b)=> b.count - a.count),
      recent: listRecent.sort((a,b)=> b.count - a.count)
    },
    highlights: {
      hotAll,
      coldAll,
      hotRecent,
      coldRecent,
      overdueTop,
      topPairs: topPairList
    }
  };
}

export function formatStatsMessage(stats) {
  const { meta, highlights } = stats;

  const fmtList = (arr, fields) =>
    arr.map(x => {
      const parts = [];
      for (const f of fields) {
        if (f === "num") parts.push(`${x.num}`);
        if (f === "count") parts.push(`(${x.count})`);
        if (f === "pct") parts.push(`${x.pct.toFixed(2)}%`);
        if (f === "z") parts.push(`z=${x.z.toFixed(2)}`);
        if (f === "overdue") parts.push(`overdue=${x.overdue}`);
      }
      return parts.join(" ");
    }).join(", ");

  const fmtPairs = (pairs) =>
    pairs.map(p => `${p.a}-${p.b} (${p.count})`).join(", ");

  let msg = "";
  msg += `📊 *Lotto Stats (Main numbers)*\n`;
  msg += `• Draws analyzed: *${meta.totalDraws}*\n`;
  msg += `• Recent window: *${meta.windowSize}*\n`;
  msg += `• Expected count/number: *${meta.expectedPerNumber.toFixed(2)}* (sd=${meta.sdPerNumber.toFixed(2)})\n`;
  msg += `• Chi-square: *${meta.chiSquare.toFixed(2)}* (df=${meta.df})\n\n`;

  msg += `🔥 *Hot (All ${meta.totalDraws})*: ${fmtList(highlights.hotAll, ["num","count","z"])}\n`;
  msg += `🧊 *Cold (All ${meta.totalDraws})*: ${fmtList(highlights.coldAll, ["num","count","z"])}\n\n`;

  msg += `⚡ *Hot (Last ${meta.windowSize})*: ${fmtList(highlights.hotRecent, ["num","count"])}\n`;
  msg += `❄️ *Cold (Last ${meta.windowSize})*: ${fmtList(highlights.coldRecent, ["num","count"])}\n\n`;

  msg += `⏳ *Most Overdue*: ${fmtList(highlights.overdueTop, ["num","overdue","count"])}\n\n`;

  if (highlights.topPairs?.length) {
    msg += `👥 *Top Pairs*: ${fmtPairs(highlights.topPairs)}\n`;
  }

  return msg;
}
