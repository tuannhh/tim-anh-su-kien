// Nhan dien khuon mat HOAN TOAN bang ONNX native (nhanh, da luong that):
//   - SCRFD: do tim khuon mat + 5 diem moc
//   - ArcFace (MobileFaceNet): vector danh tinh 512 chieu
// Khong con phu thuoc face-api/tfjs (WASM cham).
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const ort = require('onnxruntime-node');
const { DATA_DIR } = require('./config');

// ===== Model tu tai khi chay lan dau (khong luu trong git) =====
const MODELS = {
  'scrfd_10g.onnx': { url: 'https://huggingface.co/immich-app/buffalo_l/resolve/main/detection/model.onnx?download=true', minSize: 1e7 },
  'arcface_mbf.onnx': { url: 'https://huggingface.co/immich-app/buffalo_s/resolve/main/recognition/model.onnx?download=true', minSize: 1e7 },
  'arcface_w600k_r50.onnx': { url: 'https://huggingface.co/immich-app/buffalo_l/resolve/main/recognition/model.onnx?download=true', minSize: 1e8 },
};
async function ensureModel(name) {
  const local = path.join(__dirname, 'models', name);
  const target = fs.existsSync(local) ? local : path.join(DATA_DIR, name);
  const cfg = MODELS[name];
  const minSize = cfg ? cfg.minSize : 1e6;
  if (fs.existsSync(target) && fs.statSync(target).size > minSize) return target;
  if (!cfg) throw new Error('Khong biet nguon tai mo hinh: ' + name);
  console.log(`… Dang tai mo hinh ${name} lan dau, vui long doi...`);
  const res = await fetch(cfg.url);
  if (!res.ok) throw new Error('Tai mo hinh that bai: ' + res.status);
  const tmp = target + '.part';
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(tmp, target);
  console.log('✔ Da tai xong mo hinh ' + name);
  return target;
}

const SESS_OPT = { intraOpNumThreads: 0, graphOptimizationLevel: 'all', executionMode: 'sequential' };
let loaded = null, detSession = null, recSession = null;
function loadModels() {
  if (loaded) return loaded;
  loaded = (async () => {
    const recName = process.env.ARC_MODEL || 'arcface_mbf.onnx';
    detSession = await ort.InferenceSession.create(await ensureModel('scrfd_10g.onnx'), SESS_OPT);
    recSession = await ort.InferenceSession.create(await ensureModel(recName), SESS_OPT);
    console.log('✔ Da nap engine nhan dien khuon mat (SCRFD + ArcFace)');
  })();
  return loaded;
}

// ===== SCRFD: do tim khuon mat =====
const DET_SIZE = 640, DET_THRESH = 0.5, NMS_IOU = 0.4, STRIDES = [8, 16, 32], NUM_ANCHORS = 2;

// Doc anh -> RGB raw o kich thuoc lam viec (ton trong EXIF)
async function workImage(buf, maxSize = 1280) {
  const { data, info } = await sharp(buf).rotate().removeAlpha()
    .resize({ width: maxSize, height: maxSize, fit: 'inside', withoutEnlargement: true })
    .raw().toBuffer({ resolveWithObject: true });
  return { rgb: data, W: info.width, H: info.height };
}

function iou(a, b) {
  const ax2 = a[0] + a[2], ay2 = a[1] + a[3], bx2 = b[0] + b[2], by2 = b[1] + b[3];
  const ix1 = Math.max(a[0], b[0]), iy1 = Math.max(a[1], b[1]), ix2 = Math.min(ax2, bx2), iy2 = Math.min(ay2, by2);
  const iw = Math.max(0, ix2 - ix1), ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih, uni = a[2] * a[3] + b[2] * b[3] - inter;
  return uni <= 0 ? 0 : inter / uni;
}
function nms(faces) {
  faces.sort((a, b) => b.score - a.score);
  const keep = [], sup = new Array(faces.length).fill(false);
  for (let i = 0; i < faces.length; i++) {
    if (sup[i]) continue;
    keep.push(faces[i]);
    for (let j = i + 1; j < faces.length; j++) if (!sup[j] && iou(faces[i].box, faces[j].box) > NMS_IOU) sup[j] = true;
  }
  return keep;
}

// Tra ve mang khuon mat: {score, box:[x,y,w,h], kps:[[x,y]x5]} theo toa do anh lam viec (W,H)
async function detect(rgb, W, H) {
  const scale = Math.min(DET_SIZE / W, DET_SIZE / H);
  // letterbox ve 640x640, can goc trai-tren (pad phai/duoi)
  const det = await sharp(Buffer.from(rgb), { raw: { width: W, height: H, channels: 3 } })
    .resize(DET_SIZE, DET_SIZE, { fit: 'contain', position: 'left top', background: { r: 0, g: 0, b: 0 } })
    .raw().toBuffer();
  const plane = DET_SIZE * DET_SIZE;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    input[i] = (det[i * 3] - 127.5) / 128;
    input[plane + i] = (det[i * 3 + 1] - 127.5) / 128;
    input[2 * plane + i] = (det[i * 3 + 2] - 127.5) / 128;
  }
  const t = new ort.Tensor('float32', input, [1, 3, DET_SIZE, DET_SIZE]);
  const out = await detSession.run({ [detSession.inputNames[0]]: t });
  const names = detSession.outputNames; // 0-2 score, 3-5 bbox, 6-8 kps (theo stride 8,16,32)

  const faces = [];
  for (let s = 0; s < 3; s++) {
    const stride = STRIDES[s];
    const scores = out[names[s]].data, bbox = out[names[s + 3]].data, kps = out[names[s + 6]].data;
    const gw = Math.ceil(DET_SIZE / stride), gh = Math.ceil(DET_SIZE / stride);
    let idx = 0;
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) for (let a = 0; a < NUM_ANCHORS; a++) {
      if (scores[idx] >= DET_THRESH) {
        const cx = x * stride, cy = y * stride, b4 = idx * 4, k10 = idx * 10;
        const x1 = (cx - bbox[b4] * stride) / scale, y1 = (cy - bbox[b4 + 1] * stride) / scale;
        const x2 = (cx + bbox[b4 + 2] * stride) / scale, y2 = (cy + bbox[b4 + 3] * stride) / scale;
        const pts = [];
        for (let j = 0; j < 5; j++) pts.push([(cx + kps[k10 + 2 * j] * stride) / scale, (cy + kps[k10 + 2 * j + 1] * stride) / scale]);
        faces.push({ score: scores[idx], box: [x1, y1, x2 - x1, y2 - y1], kps: pts });
      }
      idx++;
    }
  }
  return nms(faces);
}

// ===== ArcFace: can chinh 5 diem -> 112x112 -> vector 512 =====
const ARC_TEMPLATE = [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]];
const ARC_SIZE = 112;

function solveSimilarity(from, to) {
  const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], B = [0, 0, 0, 0];
  const add = (row, rhs) => { for (let i = 0; i < 4; i++) { for (let j = 0; j < 4; j++) A[i][j] += row[i] * row[j]; B[i] += row[i] * rhs; } };
  for (let i = 0; i < from.length; i++) { const [x, y] = from[i], [xp, yp] = to[i]; add([x, -y, 1, 0], xp); add([y, x, 0, 1], yp); }
  const M = A.map((r, i) => [...r, B[i]]);
  for (let c = 0; c < 4; c++) {
    let p = c; for (let r = c + 1; r < 4; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < 4; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= 4; k++) M[r][k] -= f * M[c][k]; }
  }
  return [M[0][4] / M[0][0], M[1][4] / M[1][1], M[2][4] / M[2][2], M[3][4] / M[3][3]];
}

function alignToInput(rgb, W, H, pts5) {
  const [a, b, tx, ty] = solveSimilarity(ARC_TEMPLATE, pts5);
  const out = new Float32Array(3 * ARC_SIZE * ARC_SIZE), plane = ARC_SIZE * ARC_SIZE;
  for (let oy = 0; oy < ARC_SIZE; oy++) for (let ox = 0; ox < ARC_SIZE; ox++) {
    const sx = a * ox - b * oy + tx, sy = b * ox + a * oy + ty;
    const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
    const cx0 = Math.min(Math.max(x0, 0), W - 1), cx1 = Math.min(Math.max(x0 + 1, 0), W - 1);
    const cy0 = Math.min(Math.max(y0, 0), H - 1), cy1 = Math.min(Math.max(y0 + 1, 0), H - 1);
    const o = oy * ARC_SIZE + ox;
    for (let ch = 0; ch < 3; ch++) {
      const p00 = rgb[(cy0 * W + cx0) * 3 + ch], p10 = rgb[(cy0 * W + cx1) * 3 + ch];
      const p01 = rgb[(cy1 * W + cx0) * 3 + ch], p11 = rgb[(cy1 * W + cx1) * 3 + ch];
      const v = p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy;
      out[ch * plane + o] = (v - 127.5) / 127.5;
    }
  }
  return out;
}

async function arcEmbed(inputData) {
  const t = new ort.Tensor('float32', inputData, [1, 3, ARC_SIZE, ARC_SIZE]);
  const res = await recSession.run({ [recSession.inputNames[0]]: t });
  const v = res[recSession.outputNames[0]].data;
  let n = 0; for (let i = 0; i < v.length; i++) n += v[i] * v[i]; n = Math.sqrt(n) || 1;
  const out = new Float32Array(v.length); for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

const MIN_FACE = 26; // bo qua mat qua nho (vector khong dang tin)

// Tat ca khuon mat trong 1 anh -> mang Float32Array(512) da chuan hoa
async function getDescriptors(buf) {
  await loadModels();
  const { rgb, W, H } = await workImage(buf);
  const faces = await detect(rgb, W, H);
  const out = [];
  for (const f of faces) {
    if (f.box[2] < MIN_FACE || f.box[3] < MIN_FACE) continue;
    out.push(await arcEmbed(alignToInput(rgb, W, H, f.kps)));
  }
  return out;
}

// Mot khuon mat LON nhat (anh chan dung khach upload) -> Float32Array(512) hoac null
async function getSingleDescriptor(buf) {
  await loadModels();
  const { rgb, W, H } = await workImage(buf);
  const faces = await detect(rgb, W, H);
  if (!faces.length) return null;
  faces.sort((a, b) => b.box[2] * b.box[3] - a.box[2] * a.box[3]); // lon nhat = chu the chinh
  return arcEmbed(alignToInput(rgb, W, H, faces[0].kps));
}

// Do giong cosine giua 2 vector da chuan hoa (cang LON cang giong)
function similarity(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
const descToBlob = (d) => Buffer.from(new Float32Array(d).buffer);
const blobToDesc = (b) => new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);

module.exports = { loadModels, getDescriptors, getSingleDescriptor, similarity, descToBlob, blobToDesc };
