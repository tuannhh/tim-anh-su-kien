// Nhan dien khuon mat = face-api (tim mat + 68 diem moc) + ArcFace/InsightFace (vector danh tinh 512 chieu).
// ArcFace phan biet DUNG DANH TINH (khong nham theo hinh dang mat) -> chinh xac cao. Chay qua ONNX trong Node.
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { DATA_DIR } = require('./config');
const faceapi = require('@vladmandic/face-api/dist/face-api.node-wasm.js');
const { setWasmPaths } = require('@tensorflow/tfjs-backend-wasm');
const ort = require('onnxruntime-node');
const tf = faceapi.tf;

// Diem moc chuan cua ArcFace tren anh 112x112 (mat trai, mat phai, mui, mep trai, mep phai)
const ARC_TEMPLATE = [
  [38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041],
];
const ARC_SIZE = 112;
const WORK_SIZE = 1280; // anh lam viec (tim mat + cat mat) - du lon de mat trong anh nhom van ro

// Mo hinh ArcFace nang 174MB (vuot gioi han GitHub) -> tu tai khi chay lan dau, khong luu trong git.
const ARC_URL = 'https://huggingface.co/immich-app/buffalo_l/resolve/main/recognition/model.onnx?download=true';
async function ensureArcModel(file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 1e8) return; // da co (>100MB)
  console.log('… Dang tai mo hinh ArcFace (~174MB) lan dau, vui long doi...');
  const res = await fetch(ARC_URL);
  if (!res.ok) throw new Error('Tai mo hinh ArcFace that bai: ' + res.status);
  const tmp = file + '.part';
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, file);
  console.log('✔ Da tai xong mo hinh ArcFace');
}

let loaded = null, arcSession = null;
function loadModels() {
  if (loaded) return loaded;
  loaded = (async () => {
    setWasmPaths(path.join(path.dirname(require.resolve('@tensorflow/tfjs-backend-wasm')), path.sep));
    await tf.setBackend('wasm');
    await tf.ready();
    const dir = path.join(__dirname, 'models');
    await faceapi.nets.ssdMobilenetv1.loadFromDisk(dir);
    await faceapi.nets.faceLandmark68Net.loadFromDisk(dir);
    // Uu tien file co san trong models/ (may local); neu khong co (cloud) thi tai ve DATA_DIR (volume - giu lau dai)
    const localArc = path.join(dir, 'arcface_w600k_r50.onnx');
    const arcFile = fs.existsSync(localArc) ? localArc : path.join(DATA_DIR, 'arcface_w600k_r50.onnx');
    await ensureArcModel(arcFile);
    arcSession = await ort.InferenceSession.create(arcFile);
    console.log('✔ Da nap engine nhan dien khuon mat (ArcFace)');
  })();
  return loaded;
}

const options = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 });

// 5 diem tu 68 diem moc dlib/face-api
function five(pos) {
  const mean = (a, b) => { let x = 0, y = 0; for (let i = a; i <= b; i++) { x += pos[i].x; y += pos[i].y; } const n = b - a + 1; return [x / n, y / n]; };
  return [mean(36, 41), mean(42, 47), [pos[30].x, pos[30].y], [pos[48].x, pos[48].y], [pos[54].x, pos[54].y]];
}

// Bien doi tuong tu (scale+xoay+tinh tien) bang binh phuong toi thieu: from -> to.
// Tra ve [a,b,tx,ty] voi: x' = a*x - b*y + tx ; y' = b*x + a*y + ty
function solveSimilarity(from, to) {
  const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  const B = [0, 0, 0, 0];
  const add = (row, rhs) => { for (let i = 0; i < 4; i++) { for (let j = 0; j < 4; j++) A[i][j] += row[i] * row[j]; B[i] += row[i] * rhs; } };
  for (let i = 0; i < from.length; i++) {
    const [x, y] = from[i], [xp, yp] = to[i];
    add([x, -y, 1, 0], xp);
    add([y, x, 0, 1], yp);
  }
  return solve4(A, B);
}
function solve4(A, b) {
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 4; c++) {
    let p = c; for (let r = c + 1; r < 4; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < 4; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= 4; k++) M[r][k] -= f * M[c][k]; }
  }
  return [M[0][4] / M[0][0], M[1][4] / M[1][1], M[2][4] / M[2][2], M[3][4] / M[3][3]];
}

// Cat & can chinh khuon mat ve 112x112 roi tien xu ly cho ArcFace (RGB, (v-127.5)/127.5, NCHW)
function alignToInput(rgb, W, H, pts5) {
  // transform template -> diem mat that (de lay nguoc cho moi pixel dau ra)
  const [a, b, tx, ty] = solveSimilarity(ARC_TEMPLATE, pts5);
  const out = new Float32Array(3 * ARC_SIZE * ARC_SIZE);
  const plane = ARC_SIZE * ARC_SIZE;
  for (let oy = 0; oy < ARC_SIZE; oy++) {
    for (let ox = 0; ox < ARC_SIZE; ox++) {
      const sx = a * ox - b * oy + tx;
      const sy = b * ox + a * oy + ty;
      // bilinear
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const x1 = x0 + 1, y1 = y0 + 1;
      const fx = sx - x0, fy = sy - y0;
      const cx0 = Math.min(Math.max(x0, 0), W - 1), cx1 = Math.min(Math.max(x1, 0), W - 1);
      const cy0 = Math.min(Math.max(y0, 0), H - 1), cy1 = Math.min(Math.max(y1, 0), H - 1);
      const o = oy * ARC_SIZE + ox;
      for (let ch = 0; ch < 3; ch++) {
        const p00 = rgb[(cy0 * W + cx0) * 3 + ch], p10 = rgb[(cy0 * W + cx1) * 3 + ch];
        const p01 = rgb[(cy1 * W + cx0) * 3 + ch], p11 = rgb[(cy1 * W + cx1) * 3 + ch];
        const v = p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy;
        out[ch * plane + o] = (v - 127.5) / 127.5;
      }
    }
  }
  return out;
}

async function arcEmbed(inputData) {
  const t = new ort.Tensor('float32', inputData, [1, 3, ARC_SIZE, ARC_SIZE]);
  const feeds = {}; feeds[arcSession.inputNames[0]] = t;
  const res = await arcSession.run(feeds);
  const v = res[arcSession.outputNames[0]].data; // Float32Array(512)
  // L2 normalize -> dung cosine similarity
  let n = 0; for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(v.length); for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

// Doc anh -> {rgb, W, H} o kich thuoc lam viec, ton trong huong EXIF
async function workImage(buf) {
  const { data, info } = await sharp(buf).rotate().removeAlpha()
    .resize({ width: WORK_SIZE, height: WORK_SIZE, fit: 'inside', withoutEnlargement: true })
    .raw().toBuffer({ resolveWithObject: true });
  return { rgb: data, W: info.width, H: info.height };
}

const MIN_FACE = 26; // bo qua mat qua nho (vector khong dang tin)

// Tat ca khuon mat trong 1 anh -> mang Float32Array(512) da chuan hoa
async function getDescriptors(buf) {
  await loadModels();
  const { rgb, W, H } = await workImage(buf);
  const t = tf.tensor3d(new Uint8Array(rgb), [H, W, 3]);
  let dets;
  try { dets = await faceapi.detectAllFaces(t, options).withFaceLandmarks(); }
  finally { t.dispose(); }
  const out = [];
  for (const d of dets) {
    if (d.detection.box.width < MIN_FACE || d.detection.box.height < MIN_FACE) continue;
    out.push(await arcEmbed(alignToInput(rgb, W, H, five(d.landmarks.positions))));
  }
  return out;
}

// Mot khuon mat ro nhat (anh chan dung khach upload) -> Float32Array(512) hoac null
async function getSingleDescriptor(buf) {
  await loadModels();
  const { rgb, W, H } = await workImage(buf);
  const t = tf.tensor3d(new Uint8Array(rgb), [H, W, 3]);
  let d;
  try { d = await faceapi.detectSingleFace(t, options).withFaceLandmarks(); }
  finally { t.dispose(); }
  if (!d) return null;
  return arcEmbed(alignToInput(rgb, W, H, five(d.landmarks.positions)));
}

// Do giong nhau cosine giua 2 vector da chuan hoa (cang LON cang giong, toi da 1.0)
function similarity(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

// BLOB <-> Float32Array
const descToBlob = (d) => Buffer.from(new Float32Array(d).buffer);
const blobToDesc = (b) => new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);

module.exports = { loadModels, getDescriptors, getSingleDescriptor, similarity, descToBlob, blobToDesc };
