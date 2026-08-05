/*
 * Lấy chỉ số trận đấu trực tiếp từ client LMHT đang chạy — không cần chụp ảnh.
 *
 * Cách dùng:
 *   1. Mở client LMHT và đăng nhập (không cần vào trận).
 *   2. Mở PowerShell tại thư mục chứa file này, chạy:  node lay-chi-so.js
 *   3. Gửi lại file chi-so.json được tạo ra.
 *
 * Script chỉ ĐỌC lịch sử đấu của chính tài khoản đang đăng nhập.
 * Không gửi gì ra ngoài internet, không sửa gì trong máy.
 */
const fs = require('fs');
const https = require('https');
const { execFileSync } = require('child_process');

function creds() {
  // execFileSync truyen tham so truc tiep, khong qua shell -> khong loi dau nhay.
  const ps = "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'LeagueClientUx.exe' } | " +
    'Select-Object -ExpandProperty CommandLine';
  let cl;
  try {
    cl = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
  } catch (e) {
    throw new Error('Khong chay duoc PowerShell de tim client.');
  }
  const port = (cl.match(/--app-port=(\d+)/) || [])[1];
  const token = (cl.match(/--remoting-auth-token=([\w-]+)/) || [])[1];
  if (!port || !token) {
    throw new Error('Khong tim thay client LMHT dang chay. Hay mo client va dang nhap truoc.');
  }
  return { port: Number(port), token };
}

function get(c, path) {
  return new Promise((resolve, reject) => {
    https.get({
      host: '127.0.0.1', port: c.port, path,
      headers: { Authorization: 'Basic ' + Buffer.from('riot:' + c.token).toString('base64') },
      rejectUnauthorized: false,
    }, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(path + ' -> HTTP ' + res.statusCode));
        try { resolve(JSON.parse(b)); } catch (e) { reject(new Error('Du lieu tra ve khong hop le.')); }
      });
    }).on('error', reject);
  });
}

(async () => {
  const c = creds();
  const me = await get(c, '/lol-summoner/v1/current-summoner');
  console.log('Tai khoan: ' + me.gameName + '#' + me.tagLine + '\n');

  const champs = await get(c, '/lol-game-data/assets/v1/champion-summary.json');
  const NAME = {};
  champs.forEach((x) => { NAME[x.id] = x.name; });

  const hist = await get(c, '/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=40');
  const customs = ((hist.games || {}).games || []).filter((g) => g.gameType === 'CUSTOM_GAME');
  if (!customs.length) {
    console.log('Khong thay tran tuy chon nao trong 40 tran gan nhat.');
    return;
  }

  const out = [];
  for (const summary of customs) {
    const g = await get(c, '/lol-match-history/v1/games/' + summary.gameId);
    const n = {};
    (g.participantIdentities || []).forEach((pi) => {
      const p = pi.player || {};
      n[pi.participantId] = p.gameName || p.summonerName;
    });
    const dur = g.gameDuration;
    const match = {
      gameId: g.gameId,
      ngay: g.gameCreationDate,
      thoiLuong: Math.floor(dur / 60) + ':' + String(dur % 60).padStart(2, '0'),
      nguoiChoi: g.participants.map((p) => ({
        ten: n[p.participantId],
        doi: p.teamId,
        tuong: NAME[p.championId] || ('id' + p.championId),
        k: p.stats.kills, d: p.stats.deaths, a: p.stats.assists,
        satThuong: p.stats.totalDamageDealtToChampions,
        vang: p.stats.goldEarned,
        linh: p.stats.totalMinionsKilled,
        quai: p.stats.neutralMinionsKilled,
        tamNhin: p.stats.visionScore,
        thang: p.stats.win,
      })),
    };
    out.push(match);
    console.log('=== ' + match.gameId + '  ' + match.ngay.slice(0, 19) + '  ' + match.thoiLuong + ' ===');
    match.nguoiChoi.forEach((p) => {
      console.log([p.doi, p.ten, p.tuong, p.k + '/' + p.d + '/' + p.a,
        p.satThuong, p.vang, p.linh + p.quai, p.thang ? 'THANG' : 'thua'].join('\t'));
    });
    console.log('');
  }

  fs.writeFileSync('chi-so.json', JSON.stringify(out, null, 1), 'utf8');
  console.log('Da ghi ' + out.length + ' tran vao chi-so.json');
})().catch((e) => { console.error('\nLOI: ' + e.message); process.exit(1); });
