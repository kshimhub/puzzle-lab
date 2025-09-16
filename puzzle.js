// puzzle.js (ESM)
const fileInput = document.getElementById('file');
const gridSel   = document.getElementById('grid');
const withRot   = document.getElementById('withRot');
const btnShuffle= document.getElementById('btnShuffle');
const btnReset  = document.getElementById('btnReset');
const btnExport = document.getElementById('btnExport');
const canvas    = document.getElementById('board');
const ctx       = canvas.getContext('2d');

const CANVAS_SIZE = canvas.width; // 600
let N = parseInt(gridSel.value, 10);
let pieceSize = CANVAS_SIZE / N;
let imageBitmap = null;

// ピース状態
// { idx: 0..N*N-1 (元の位置), rot: 0,90,180,270 }
let pieces = [];
let initialPieces = [];
let selectedIndex = null;

// HiDPI対応
const dpr = window.devicePixelRatio || 1;
canvas.width  = CANVAS_SIZE * dpr;
canvas.height = CANVAS_SIZE * dpr;
canvas.style.width = CANVAS_SIZE + 'px';
canvas.style.height = CANVAS_SIZE + 'px';
ctx.scale(dpr, dpr);

// ---- 画像読み込み ----
fileInput.addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  const url = URL.createObjectURL(f);
  const blob = await (await fetch(url)).blob();
  URL.revokeObjectURL(url);
  imageBitmap = await createImageBitmap(blob);
  resetBoard();
  draw();
  btnShuffle.disabled = false;
  btnReset.disabled = false;
  btnExport.disabled = false;
});

gridSel.addEventListener('change', () => {
  N = parseInt(gridSel.value, 10);
  pieceSize = CANVAS_SIZE / N;
  if (imageBitmap) { resetBoard(); draw(); }
});

withRot.addEventListener('change', () => { /* no-op until shuffle */ });

btnShuffle.addEventListener('click', () => {
  if (!imageBitmap) return;
  shufflePieces(withRot.checked);
  draw();
});

btnReset.addEventListener('click', () => {
  if (!imageBitmap) return;
  pieces = initialPieces.map(p => ({...p})); // deep copy
  draw();
});

btnExport.addEventListener('click', () => {
  if (!imageBitmap) return;
  exportPng();
});

// ---- 盤面初期化 ----
function resetBoard() {
  pieces = [];
  for (let i = 0; i < N*N; i++) pieces.push({ idx: i, rot: 0 });
  initialPieces = pieces.map(p => ({...p}));
  selectedIndex = null;
}

// ---- シャッフル（Fisher-Yates）＋任意回転 ----
function shufflePieces(allowRotation) {
  for (let i = pieces.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pieces[i], pieces[j]] = [pieces[j], pieces[i]];
  }
  if (allowRotation) {
    for (const p of pieces) {
      const k = Math.floor(Math.random() * 4); // 0..3
      p.rot = k * 90;
    }
  } else {
    for (const p of pieces) p.rot = 0;
  }
}

// ---- 描画 ----
function draw() {
  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  if (!imageBitmap) {
    // 背景グリッドだけ
    drawGrid();
    return;
  }
  // 元画像の正方形トリミングを算出
  const s = Math.min(imageBitmap.width, imageBitmap.height);
  const sx0 = (imageBitmap.width - s) / 2;
  const sy0 = (imageBitmap.height - s) / 2;
  const srcTile = s / N;

  for (let gy = 0; gy < N; gy++) {
    for (let gx = 0; gx < N; gx++) {
      const pos = gy * N + gx;       // 盤面位置
      const piece = pieces[pos];      // 置かれているピース
      const idx = piece.idx;          // 元位置
      const srcX = idx % N;
      const srcY = Math.floor(idx / N);
      const dx = gx * pieceSize;
      const dy = gy * pieceSize;

      ctx.save();
      // ピースの中心に回転軸
      ctx.translate(dx + pieceSize/2, dy + pieceSize/2);
      ctx.rotate((piece.rot * Math.PI) / 180);
      // 回転後もピース左上に合わせて描画
      ctx.drawImage(
        imageBitmap,
        sx0 + srcX * srcTile, sy0 + srcY * srcTile, srcTile, srcTile,
        -pieceSize/2, -pieceSize/2, pieceSize, pieceSize
      );
      ctx.restore();

      // 選択枠
      if (selectedIndex === pos) {
        ctx.save();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#3b82f6';
        ctx.strokeRect(dx+1.5, dy+1.5, pieceSize-3, pieceSize-3);
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
    const p = i * pieceSize + 0.5;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, CANVAS_SIZE); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(CANVAS_SIZE, p); ctx.stroke();
  }
  ctx.restore();
}

// ---- 入れ替え＆回転操作 ----
function posFromClient(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = (clientX - rect.left) * (CANVAS_SIZE / rect.width);
  const y = (clientY - rect.top)  * (CANVAS_SIZE / rect.height);
  const gx = Math.floor(x / pieceSize);
  const gy = Math.floor(y / pieceSize);
  if (gx < 0 || gy < 0 || gx >= N || gy >= N) return -1;
  return gy * N + gx;
}

canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'r') rotateSelected();
});

let longPressTimer = null;
function onPointerDown(e) {
  e.preventDefault();
  const pos = posFromClient(e.clientX, e.clientY);
  if (pos < 0) return;
  // 長押しで回転（モバイル向け）
  clearTimeout(longPressTimer);
  longPressTimer = setTimeout(() => {
    rotatePos(pos);
    draw();
  }, 450);

  const up = (ev) => {
    clearTimeout(longPressTimer);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', up);

    // 右クリック（button===2）またはCtrlクリックで回転
    if (e.button === 2 || e.ctrlKey || e.metaKey) {
      rotatePos(pos);
      draw();
      return;
    }

    if (selectedIndex === null) {
      selectedIndex = pos;
      draw();
    } else if (selectedIndex === pos) {
      // 同じピースをもう一度→選択解除
      selectedIndex = null;
      draw();
    } else {
      // 入れ替え
      [pieces[selectedIndex], pieces[pos]] = [pieces[pos], pieces[selectedIndex]];
      selectedIndex = null;
      draw();
    }
  };
  canvas.addEventListener('pointerup', up, { once: true });
  canvas.addEventListener('pointercancel', up, { once: true });
}

function rotateSelected() {
  if (selectedIndex === null) return;
  rotatePos(selectedIndex);
  draw();
}

function rotatePos(pos) {
  const p = pieces[pos];
  p.rot = (p.rot + 90) % 360;
}

// ---- エクスポート ----
function exportPng() {
  // 現在のキャンバスをPNG保存
  canvas.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `puzzle_${N}x${N}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, 'image/png');
}

