// =======================
// puzzle.js (固定タイル版)
// - 「ブロック」セレクトで 16/32/64/128 px 正方ピース
// - 「鍵」(パスフレーズ) で再現可能シャッフル (SHA-256→xorshift32)
// - 回転(90°刻み) + 反転(左右/上下) を混ぜる
// - 出力PNGは常に元画像の解像度
// - 正方形クロップのON/OFF切替
// =======================

const $ = (id) => document.getElementById(id);

// UI要素
const fileInput  = $('file');
const keyInput   = $('key');          // パスフレーズ
const withFlip   = $('withFlip');     // 反転も混ぜる
const squareCrop = $('squareCrop');   // 正方形に揃える
const btnShuffle = $('btnShuffle');
const btnReset   = $('btnReset');
const btnExport  = $('btnExport');
const canvas     = $('board');
const ctx        = canvas.getContext('2d');
const tileSel    = $('tilePx');       // ブロックサイズセレクト

// 状態
let tilePx = 32;       // ピクセル単位のピースサイズ
let tilesW = 0, tilesH = 0; // 横・縦のタイル数
let imgBitmap = null;  // 読み込んだ画像
let pieces = [];       // [{idx, rot, flipH, flipV}]
let initialPieces = []; 
let selectedIndex = null;
let srcRect = { x:0, y:0, w:0, h:0 };
let pieceW = 0, pieceH = 0;

// =============== RNG ===============
async function makeRng(seedText) {
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
    return state / 0x100000000;
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

  setupCanvas();
  resetBoard();
  draw();

  [btnShuffle, btnReset, btnExport].forEach(b => b && (b.disabled = false));
});

// =============== キャンバス設定 ===============
function setupCanvas() {
  if (!imgBitmap) return;

  // クロップ or そのまま
  const useSquare = !!(squareCrop && squareCrop.checked);
  if (useSquare) {
    const s = Math.min(imgBitmap.width, imgBitmap.height);
    srcRect = { x: (imgBitmap.width - s) / 2, y: (imgBitmap.height - s) / 2, w: s, h: s };
    canvas.width = s; canvas.height = s;
  } else {
    srcRect = { x: 0, y: 0, w: imgBitmap.width, h: imgBitmap.height };
    canvas.width = imgBitmap.width; canvas.height = imgBitmap.height;
  }

  // ブロックサイズ
  tilePx = tileSel ? Number(tileSel.value) : 32;

  // 1ピースサイズ（正方）
  pieceW = tilePx;
  pieceH = tilePx;

  // 作れるタイル数（端の余りはそのまま）
  tilesW = Math.floor(canvas.width  / pieceW);
  tilesH = Math.floor(canvas.height / pieceH);
}

// =============== 盤面初期化 ===============
function resetBoard() {
  pieces = [];
  for (let i = 0; i < tilesW * tilesH; i++) {
    pieces.push({ idx: i, rot: 0, flipH: false, flipV: false });
  }
  initialPieces = pieces.map(p => ({ ...p }));
  selectedIndex = null;
}

// =============== シャッフル ===============
btnShuffle?.addEventListener('click', async () => {
  if (!imgBitmap) return;
  const seed = keyInput?.value ?? '';
  const rng = await makeRng(seed);

  // Fisher–Yates
  for (let i = pieces.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pieces[i], pieces[j]] = [pieces[j], pieces[i]];
  }

  // 回転/反転
  for (const p of pieces) {
    const r = Math.floor(rng() * 4); // 0,90,180,270
    p.rot = r * 90;
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
    a.download = `puzzle_${tilePx}px_${tilesW}x${tilesH}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, 'image/png');
});

// =============== UIイベント ===============
squareCrop?.addEventListener('change', () => {
  if (imgBitmap) { setupCanvas(); resetBoard(); draw(); }
});
tileSel?.addEventListener('change', () => {
  if (imgBitmap) { setupCanvas(); resetBoard(); draw(); }
});

// =============== 描画 ===============
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!imgBitmap) { drawGrid(); return; }

  const tileW = pieceW;
  const tileH = pieceH;

  for (let gy = 0; gy < tilesH; gy++) {
    for (let gx = 0; gx < tilesW; gx++) {
      const pos = gy * tilesW + gx;
      const p = pieces[pos];
      const sxTile = p.idx % tilesW;
      const syTile = Math.floor(p.idx / tilesW);

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
  for (let i = 1; i < tilesW; i++) {
    const x = i * pieceW + 0.5;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, tilesH * pieceH); ctx.stroke();
  }
  for (let j = 1; j < tilesH; j++) {
    const y = j * pieceH + 0.5;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(tilesW * pieceW, y); ctx.stroke();
  }
  ctx.restore();
}

// =============== 入れ替え＆回転操作 ===============
function posFromClient(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = (clientX - rect.left) * (canvas.width / rect.width);
  const y = (clientY - rect.top)  * (canvas.height / rect.height);
  const gx = Math.floor(x / pieceW);
  const gy = Math.floor(y / pieceH);
  if (gx < 0 || gy < 0 || gx >= tilesW || gy >= tilesH) return -1;
  return gy * tilesW + gx;
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

// 初期表示
setupCanvas();
resetBoard();
draw();
