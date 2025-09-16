// =======================
// puzzle.js (PWA/教育用スクランブル版)
// - 「安全性」スライダー: 3x3/4x4/6x6/10x10 に自動マップ
// - 「鍵」(パスフレーズ) で再現可能シャッフル
// - 回転(90°刻み) + 反転(左右/上下) を任意で混ぜる
// - 出力PNGは常に元画像の解像度
// - 正方形クロップのON/OFF切替
// - 既存UI(grid/withRot)の簡易互換あり
// すべて端末内で完結（外部送信なし）
// =======================

const $ = (id) => document.getElementById(id);

// 推奨UI要素（新UI）
const fileInput  = $('file');
const safety     = $('safety');       // <input type="range" min="0" max="3">
const safetyLbl  = $('safetyLabel');  // テキスト表示
const keyInput   = $('key');          // パスフレーズ
const withFlip   = $('withFlip');     // 反転も混ぜる
const squareCrop = $('squareCrop');   // 正方形に揃える
const btnShuffle = $('btnShuffle');
const btnReset   = $('btnReset');
const btnExport  = $('btnExport');
const canvas     = $('board');
const ctx        = canvas.getContext('2d');

// 互換UI（旧UIが残っている場合のみ参照）
const gridSel    = $('grid');    // 3/4/5/6...
const withRot    = $('withRot'); // 回転を混ぜる

// 状態
let N = 4;                    // 分割数
let imgBitmap = null;         // 読み込んだ画像
let pieces = [];              // [{idx, rot, flipH, flipV}]
let initialPieces = [];       // Reset用
let selectedIndex = null;
let srcRect = { x:0, y:0, w:0, h:0 }; // 描画元の領域
let pieceW = 0, pieceH = 0;   // 1ピース描画サイズ

// 安全性 → N マップ
const SAFETY_MAP = [
  { label: '弱め',  N: 3 },
  { label: 'ふつう', N: 4 },
  { label: '強め',  N: 6 },
  { label: '最大',  N: 10 },
];

// =============== ユーティリティ ===============
// 16×16タイル用: タイル配列を構築（端の半端は除外）
function buildTileRegions(w, h, tileSize=16) {
  const W = Math.floor(w / tileSize) * tileSize;
  const H = Math.floor(h / tileSize) * tileSize;
  const tiles = [];
  for (let y = 0; y < H; y += tileSize) {
    for (let x = 0; x < W; x += tileSize) {
      tiles.push({ x, y, w: tileSize, h: tileSize });
    }
  }
  return { tiles, coverW: W, coverH: H };
}

// 1ピースを回転＋反転して描画
function drawTransformedTile(ctx, srcCanvas, srcRect, dstRect, rot, flipH, flipV) {
  const { x: sx, y: sy, w, h } = srcRect;
  const { x: dx, y: dy } = dstRect;
  const off = new OffscreenCanvas(w, h);
  const octx = off.getContext('2d');
  octx.drawImage(srcCanvas, sx, sy, w, h, 0, 0, w, h);

  ctx.save();
  ctx.translate(dx + w/2, dy + h/2);
  if (rot) ctx.rotate(rot * Math.PI/180);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.drawImage(off, -w/2, -h/2, w, h);
  ctx.restore();
}

function applySafetyUI() {
  if (safety) {
    const s = SAFETY_MAP[parseInt(safety.value, 10)];
    N = s.N; if (safetyLbl) safetyLbl.textContent = s.label;
  }
}

function applyGridFallback() {
  // 旧UI(grid)がある場合はそれを優先（safety未設置のとき）
  if (!safety && gridSel) {
    N = parseInt(gridSel.value || '4', 10);
  }
}

async function makeRng(seedText) {
  // 鍵→SHA-256→xorshift32のseedに
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(seedText || ''));
  const b = new Uint8Array(digest);
  let s = (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3];
  if (s === 0) s = 0x6d2b79f5;
  let state = s >>> 0;
  return function rng() {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17; state >>>= 0;
    state ^= state << 5;  state >>>= 0;
    return state / 0x100000000; // [0,1)
  };
}

// =============== 画像読み込み ===============
fileInput?.addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  const url = URL.createObjectURL(f);
  const blob = await (await fetch(url)).blob();
  URL.revokeObjectURL(url);
  imgBitmap = await createImageBitmap(blob);

  // UI設定を反映
  if (safety) applySafetyUI(); else applyGridFallback();
  setupCanvas();
  resetBoard();
  draw();

  [btnShuffle, btnReset, btnExport].forEach(b => b && (b.disabled = false));
});

// =============== キャンバス設定 ===============
function setupCanvas() {
  if (!imgBitmap) return;
  // 正方形クロップ or そのまま
  const useSquare = !!(squareCrop && squareCrop.checked);
  if (useSquare) {
    const s = Math.min(imgBitmap.width, imgBitmap.height);
    srcRect = { x: (imgBitmap.width - s) / 2, y: (imgBitmap.height - s) / 2, w: s, h: s };
    canvas.width = s; canvas.height = s;
  } else {
    srcRect = { x: 0, y: 0, w: imgBitmap.width, h: imgBitmap.height };
    canvas.width = imgBitmap.width; canvas.height = imgBitmap.height;
  }
  pieceW = canvas.width / N;
  pieceH = canvas.height / N;
}

// 表示はCSSで縮小（解像度は保持）
function resizePieces() {
  pieceW = canvas.width / N;
  pieceH = canvas.height / N;
}

// =============== 盤面初期化 ===============
function resetBoard() {
  pieces = [];
  for (let i = 0; i < N * N; i++) pieces.push({ idx: i, rot: 0, flipH: false, flipV: false });
  initialPieces = pieces.map(p => ({ ...p }));
  selectedIndex = null;
}

// =============== シャッフル（鍵付き） ===============
btnShuffle?.addEventListener('click', async () => {
  if (!imgBitmap) return;
  // 「鍵」優先。なければ空文字（毎回同じ並び）にする
  const seed = keyInput?.value ?? '';
  const rng = await makeRng(seed);

  if (document.getElementById("strongMode").checked) {
    // === 最強モード ===
    const { tiles } = buildTileRegions(image.width, image.height, 16);
    const order = shuffle([...tiles.keys()], rng);
    tiles.forEach((src, i) => {
      const dst = tiles[order[i]];
      const rot = [0, 90, 180, 270][Math.floor(rng()*4)];
      const flipH = rng() < 0.5, flipV = rng() < 0.5;
      drawTransformedTile(ctx, image, src, dst, rot, flipH, flipV);
    });
  } else {
    // Fisher–Yates
    for (let i = pieces.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pieces[i], pieces[j]] = [pieces[j], pieces[i]];
    }
  }

  // 回転を混ぜる（旧UIに互換 / 新UIは常に回転あり）
  const allowRotation = withRot ? withRot.checked : true;

  for (const p of pieces) {
    if (allowRotation) {
      const r = Math.floor(rng() * 4); // 0,90,180,270
      p.rot = r * 90;
    } else {
      p.rot = 0;
    }
    // 反転（新UI）
    if (withFlip && withFlip.checked) {
      p.flipH = rng() < 0.5;
      p.flipV = rng() < 0.5;
    } else {
      p.flipH = p.flipV = false;
    }
  }
  draw();
});

// =============== Reset / Export ===============
btnReset?.addEventListener('click', () => {
  if (!imgBitmap) return;
  pieces = initialPieces.map(p => ({ ...p }));
  draw();
});

btnExport?.addEventListener('click', () => {
  if (!imgBitmap) return;
  canvas.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `puzzle_${N}x${N}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, 'image/png');
});

const keyInput = document.getElementById('keyInput');
const applyKeyBtn = document.getElementById('applyKeyBtn');

applyKeyBtn.addEventListener('click', ()=>{
  const keyStr = (keyInput.value || '').trim();
  if (!loadedOriginalCanvas) return; // 画像読み込み済みを前提
  // “最強”モードを実行
  scrambleStrong(mainCanvas, loadedOriginalCanvas, keyStr);
});

// =============== UIイベント ===============
safety?.addEventListener('input', () => {
  applySafetyUI();
  if (imgBitmap) { setupCanvas(); resetBoard(); draw(); }
});
squareCrop?.addEventListener('change', () => {
  if (imgBitmap) { setupCanvas(); resetBoard(); draw(); }
});
gridSel?.addEventListener('change', () => {
  // 旧UI: 分割セレクト変更時
  if (!safety) applyGridFallback();
  if (imgBitmap) { setupCanvas(); resetBoard(); draw(); }
});

// =============== 描画 ===============
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!imgBitmap) { drawGrid(); return; }

  const tileW = srcRect.w / N;
  const tileH = srcRect.h / N;

  for (let gy = 0; gy < N; gy++) {
    for (let gx = 0; gx < N; gx++) {
      const pos = gy * N + gx;
      const p = pieces[pos];
      const sxTile = p.idx % N;
      const syTile = Math.floor(p.idx / N);

      const dx = gx * pieceW;
      const dy = gy * pieceH;

      ctx.save();
      ctx.translate(dx + pieceW / 2, dy + pieceH / 2);
      ctx.scale(p.flipH ? -1 : 1, p.flipV ? -1 : 1);
      ctx.rotate((p.rot * Math.PI) / 180);

      ctx.drawImage(
        imgBitmap,
        srcRect.x + sxTile * tileW,
        srcRect.y + syTile * tileH,
        tileW, tileH,
        -pieceW / 2, -pieceH / 2,
        pieceW, pieceH
      );
      ctx.restore();

      if (selectedIndex === pos) {
        ctx.save();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#3b82f6';
        ctx.strokeRect(dx + 1.5, dy + 1.5, pieceW - 3, pieceH - 3);
        ctx.restore();
      }
    }
  }
  drawGrid();
}

function drawGrid() {
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,.15)';
  ctx.lineWidth = 1;
  for (let i = 1; i < N; i++) {
    const x = i * pieceW + 0.5;
    const y = i * pieceH + 0.5;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }
  ctx.restore();
}

// =============== 入れ替え＆回転操作（同じ） ===============
function posFromClient(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = (clientX - rect.left) * (canvas.width / rect.width);
  const y = (clientY - rect.top)  * (canvas.height / rect.height);
  const gx = Math.floor(x / pieceW);
  const gy = Math.floor(y / pieceH);
  if (gx < 0 || gy < 0 || gx >= N || gy >= N) return -1;
  return gy * N + gx;
}

canvas?.addEventListener('contextmenu', (e) => e.preventDefault());

let longPressTimer = null;
canvas?.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (!imgBitmap) return;
  const pos = posFromClient(e.clientX, e.clientY);
  if (pos < 0) return;

  clearTimeout(longPressTimer);
  longPressTimer = setTimeout(() => { rotatePos(pos); draw(); }, 450);

  const up = () => {
    clearTimeout(longPressTimer);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', up);

    // 右クリック or Ctrl/⌘ で回転
    if (e.button === 2 || e.ctrlKey || e.metaKey) {
      rotatePos(pos); draw(); return;
    }

    if (selectedIndex === null) {
      selectedIndex = pos; draw();
    } else if (selectedIndex === pos) {
      selectedIndex = null; draw();
    } else {
      [pieces[selectedIndex], pieces[pos]] = [pieces[pos], pieces[selectedIndex]];
      selectedIndex = null; draw();
    }
  };
  canvas.addEventListener('pointerup', up, { once: true });
  canvas.addEventListener('pointercancel', up, { once: true });
});

function rotatePos(pos) {
  pieces[pos].rot = (pieces[pos].rot + 90) % 360;
}

window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'r' && selectedIndex !== null) {
    rotatePos(selectedIndex); draw();
  }
});

// 画像なしでもグリッドが出るように一応初期描画
applySafetyUI(); // 新UIがあれば反映
applyGridFallback();
resizePieces();
draw();
