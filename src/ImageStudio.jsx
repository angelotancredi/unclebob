import { useState, useRef, useCallback, useEffect } from "react";


// ─── Image Processing Engine ───────────────────────────────────────────
const ImageEngine = {
  // High-quality upscale using canvas
  upscale(canvas, scale) {
    const w = canvas.width * scale;
    const h = canvas.height * scale;
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const ctx = out.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(canvas, 0, 0, w, h);
    return out;
  },

  // Background removal using border color sampling + alpha matting
  removeBackground(canvas, sensitivity = 30, trim = 1) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    // Sample border pixels to find background color
    const borderColors = [];
    const sampleStep = Math.max(1, Math.floor(Math.min(w, h) / 100));
    for (let x = 0; x < w; x += sampleStep) {
      borderColors.push([data[(x) * 4], data[(x) * 4 + 1], data[(x) * 4 + 2]]);
      borderColors.push([data[((h - 1) * w + x) * 4], data[((h - 1) * w + x) * 4 + 1], data[((h - 1) * w + x) * 4 + 2]]);
    }
    for (let y = 0; y < h; y += sampleStep) {
      borderColors.push([data[(y * w) * 4], data[(y * w) * 4 + 1], data[(y * w) * 4 + 2]]);
      borderColors.push([data[(y * w + w - 1) * 4], data[(y * w + w - 1) * 4 + 1], data[(y * w + w - 1) * 4 + 2]]);
    }

    // Find dominant background color using median
    const sortCh = (arr, ch) => arr.map(c => c[ch]).sort((a, b) => a - b);
    const mid = Math.floor(borderColors.length / 2);
    const bgColor = [
      sortCh(borderColors, 0)[mid],
      sortCh(borderColors, 1)[mid],
      sortCh(borderColors, 2)[mid]
    ];

    const threshold = sensitivity;
    const softEdge = threshold * 0.6;

    // Pre-compute color distance for every pixel
    const dist = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const dr = data[i * 4] - bgColor[0];
      const dg = data[i * 4 + 1] - bgColor[1];
      const db = data[i * 4 + 2] - bgColor[2];
      dist[i] = Math.sqrt(dr * dr + dg * dg + db * db);
    }

    // Flood-fill from ALL edge pixels — only connected bg regions get removed
    // 0 = unvisited, 1 = confirmed background, 2 = confirmed foreground
    const visited = new Uint8Array(w * h);
    const queue = [];

    // Seed every edge pixel that looks like background
    for (let x = 0; x < w; x++) {
      if (dist[x] < threshold) queue.push(x);                       // top row
      if (dist[(h - 1) * w + x] < threshold) queue.push((h - 1) * w + x); // bottom row
    }
    for (let y = 1; y < h - 1; y++) {
      if (dist[y * w] < threshold) queue.push(y * w);               // left col
      if (dist[y * w + w - 1] < threshold) queue.push(y * w + w - 1); // right col
    }

    // Mark seeds
    for (const idx of queue) visited[idx] = 1;

    // BFS flood fill — only spread to neighboring pixels that match bg
    let head = 0;
    const dx4 = [-1, 1, 0, 0];
    const dy4 = [0, 0, -1, 1];
    while (head < queue.length) {
      const idx = queue[head++];
      const px = idx % w;
      const py = (idx - px) / w;
      for (let d = 0; d < 4; d++) {
        const nx = px + dx4[d];
        const ny = py + dy4[d];
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const ni = ny * w + nx;
        if (visited[ni] !== 0) continue;
        if (dist[ni] < threshold) {
          visited[ni] = 1;
          queue.push(ni);
        }
      }
    }

    // Build alpha mask: flood-filled bg = 0, everything else = 1, with soft edges
    const mask = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      if (visited[i] === 1) {
        // Soft edge: partially transparent for pixels near threshold
        if (dist[i] > softEdge) {
          mask[i] = (dist[i] - softEdge) / (threshold - softEdge) * 0.3;
        } else {
          mask[i] = 0.0;
        }
      } else {
        mask[i] = 1.0;
      }
    }

    // Erode mask to trim edge residue (trim px)
    const trimmed = trim > 0 ? this._morphOp(mask, w, h, "erode", trim) : mask;

    // Smooth edges for clean anti-aliasing
    const smoothed = this._blurMask(trimmed, w, h, 2);

    // Apply mask
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const outCtx = out.getContext("2d");
    const outData = outCtx.createImageData(w, h);

    for (let i = 0; i < w * h; i++) {
      outData.data[i * 4] = data[i * 4];
      outData.data[i * 4 + 1] = data[i * 4 + 1];
      outData.data[i * 4 + 2] = data[i * 4 + 2];
      outData.data[i * 4 + 3] = Math.round(smoothed[i] * 255);
    }

    outCtx.putImageData(outData, 0, 0);
    return out;
  },

  _morphOp(mask, w, h, op, radius) {
    const out = new Float32Array(mask.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let val = op === "erode" ? 1 : 0;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = Math.min(w - 1, Math.max(0, x + dx));
            const ny = Math.min(h - 1, Math.max(0, y + dy));
            const v = mask[ny * w + nx];
            val = op === "erode" ? Math.min(val, v) : Math.max(val, v);
          }
        }
        out[y * w + x] = val;
      }
    }
    return out;
  },

  _blurMask(mask, w, h, radius) {
    const out = new Float32Array(mask.length);
    const size = (radius * 2 + 1);
    const area = size * size;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let count = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              sum += mask[ny * w + nx];
              count++;
            }
          }
        }
        out[y * w + x] = sum / count;
      }
    }
    return out;
  },

  // Auto-crop to content (non-transparent pixels)
  autoCrop(canvas, padding = 20) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    const data = ctx.getImageData(0, 0, w, h).data;

    let top = h, bottom = 0, left = w, right = 0;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const alpha = data[(y * w + x) * 4 + 3];
        if (alpha > 10) {
          if (y < top) top = y;
          if (y > bottom) bottom = y;
          if (x < left) left = x;
          if (x > right) right = x;
        }
      }
    }

    if (top >= bottom || left >= right) return canvas;

    const cropX = Math.max(0, left - padding);
    const cropY = Math.max(0, top - padding);
    const cropW = Math.min(w - cropX, right - left + padding * 2);
    const cropH = Math.min(h - cropY, bottom - top + padding * 2);

    const out = document.createElement("canvas");
    out.width = cropW;
    out.height = cropH;
    const outCtx = out.getContext("2d");
    outCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    return out;
  }
};

// ─── Checkerboard Pattern for transparency ─────────────────────────────
const checkerCSS = `repeating-conic-gradient(#e8e8f0 0% 25%, #f4f4fa 0% 50%) 0 0 / 20px 20px`;

// ─── Main App ──────────────────────────────────────────────────────────
export default function ImageStudio() {
  const [original, setOriginal] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState("");
  const [settings, setSettings] = useState({
    scale: 2,
    sensitivity: 30,
    padding: 20,
    trim: 1,
  });
  const [dragOver, setDragOver] = useState(false);
  const [viewMode, setViewMode] = useState("result"); // "original" | "result"
  const [bgMode, setBgMode] = useState("fast"); // "fast" | "ai"
  const [aiStatus, setAiStatus] = useState(""); // "", "loading", "ready", "error"
  const [spoitMode, setSpoitMode] = useState(false);
  const [spoitSensitivity, setSpoitSensitivity] = useState(25);
  const [resultCanvas, setResultCanvas] = useState(null);
  const [undoCount, setUndoCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });
  const undoStackRef = useRef([]);
  const fileInputRef = useRef(null);
  const imgRef = useRef(null);
  const containerRef = useRef(null);

  const loadImage = useCallback((file) => {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        c.getContext("2d").drawImage(img, 0, 0);
        setOriginal(c);
        setPreview(e.target.result);
        setResult(null);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    loadImage(file);
  }, [loadImage]);

  const processImage = useCallback(async () => {
    if (!original) return;
    setProcessing(true);
    setProgress(0);

    await new Promise(r => setTimeout(r, 50));

    try {
      // Step 1: Upscale
      setStep("확대 중...");
      setProgress(15);
      await new Promise(r => setTimeout(r, 100));
      const upscaled = ImageEngine.upscale(original, settings.scale);
      setProgress(35);

      let nobg;

      if (bgMode === "ai") {
        // AI Background Removal
        setStep("AI 모델 로딩 중...");
        setProgress(40);

        const { removeBackground } = await import("@imgly/background-removal");

        setStep("AI 배경 분석 중...");
        setProgress(50);

        // Convert canvas to blob for the AI library
        const blob = await new Promise(res => upscaled.toBlob(res, "image/png"));
        const result = await removeBackground(blob, {
          progress: (key, current, total) => {
            if (key === "compute:inference") {
              setProgress(50 + Math.round((current / total) * 25));
            }
          }
        });

        // Convert result blob back to canvas
        const img = new Image();
        const url = URL.createObjectURL(result);
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
        URL.revokeObjectURL(url);

        nobg = document.createElement("canvas");
        nobg.width = img.width;
        nobg.height = img.height;
        nobg.getContext("2d").drawImage(img, 0, 0);
        setProgress(75);
      } else {
        // Fast mode: color-based removal
        setStep("배경 제거 중...");
        await new Promise(r => setTimeout(r, 100));
        nobg = ImageEngine.removeBackground(upscaled, settings.sensitivity, settings.trim);
        setProgress(75);
      }

      // Step 3: Auto Crop
      setStep("자동 크롭 중...");
      await new Promise(r => setTimeout(r, 100));
      const cropped = ImageEngine.autoCrop(nobg, settings.padding);
      setProgress(100);

      setResult(cropped.toDataURL("image/png"));
      setResultCanvas(cropped);
      undoStackRef.current = [];
      setUndoCount(0);
      setSpoitMode(false);
      setStep("완료!");
      setProcessing(false);
    } catch (err) {
      console.error(err);
      setStep("오류 발생");
      setProcessing(false);
      if (bgMode === "ai") {
        setAiStatus("error");
      }
    }
  }, [original, settings, bgMode]);

  const download = useCallback(() => {
    if (!result) return;
    // Convert dataURL to Blob for reliable download in sandboxed env
    const byteString = atob(result.split(",")[1]);
    const mimeString = result.split(",")[0].split(":")[1].split(";")[0];
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    const blob = new Blob([ab], { type: mimeString });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `processed_${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [result]);

  const reset = useCallback(() => {
    setOriginal(null);
    setPreview(null);
    setResult(null);
    setResultCanvas(null);
    undoStackRef.current = [];
    setUndoCount(0);
    setSpoitMode(false);
    setProgress(0);
    setStep("");
  }, []);

  // Spoid: click on result image to flood-fill remove that color region
  const handleSpoidClick = useCallback((e) => {
    if (!spoitMode || !resultCanvas || !imgRef.current) return;

    const img = imgRef.current;
    const rect = img.getBoundingClientRect();
    // Map click coords to actual canvas pixel coords
    const scaleX = resultCanvas.width / img.naturalWidth;
    const scaleY = resultCanvas.height / img.naturalHeight;
    const displayScaleX = img.naturalWidth / rect.width;
    const displayScaleY = img.naturalHeight / rect.height;
    const px = Math.floor((e.clientX - rect.left) * displayScaleX * scaleX);
    const py = Math.floor((e.clientY - rect.top) * displayScaleY * scaleY);

    if (px < 0 || py < 0 || px >= resultCanvas.width || py >= resultCanvas.height) return;

    const w = resultCanvas.width;
    const h = resultCanvas.height;
    const ctx = resultCanvas.getContext("2d");
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    // Sample color at click point
    const idx = (py * w + px) * 4;
    const targetR = data[idx];
    const targetG = data[idx + 1];
    const targetB = data[idx + 2];
    const targetA = data[idx + 3];

    // If clicked on already transparent pixel, ignore
    if (targetA < 10) return;

    // Save undo state BEFORE modifying (use separate getImageData copy)
    undoStackRef.current = [...undoStackRef.current, ctx.getImageData(0, 0, w, h)];
    setUndoCount(undoStackRef.current.length);

    const threshold = spoitSensitivity;
    const softEdge = threshold * 0.5;

    // BFS flood fill from click point
    const visited = new Uint8Array(w * h);
    const queue = [py * w + px];
    visited[py * w + px] = 1;

    let head = 0;
    const dx4 = [-1, 1, 0, 0];
    const dy4 = [0, 0, -1, 1];

    while (head < queue.length) {
      const i = queue[head++];
      const cx = i % w;
      const cy = (i - cx) / w;

      for (let d = 0; d < 4; d++) {
        const nx = cx + dx4[d];
        const ny = cy + dy4[d];
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const ni = ny * w + nx;
        if (visited[ni]) continue;

        const pi = ni * 4;
        if (data[pi + 3] < 10) { visited[ni] = 1; continue; } // already transparent

        const dr = data[pi] - targetR;
        const dg = data[pi + 1] - targetG;
        const db = data[pi + 2] - targetB;
        const dist = Math.sqrt(dr * dr + dg * dg + db * db);

        if (dist < threshold) {
          visited[ni] = 1;
          queue.push(ni);
        }
      }
    }

    // Build a removal mask from flood-filled area
    const mask = new Float32Array(w * h).fill(1); // 1 = keep, 0 = remove
    for (const i of queue) {
      const pi = i * 4;
      const dr = data[pi] - targetR;
      const dg = data[pi + 1] - targetG;
      const db = data[pi + 2] - targetB;
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);

      if (dist < softEdge) {
        mask[i] = 0.0;
      } else {
        mask[i] = (dist - softEdge) / (threshold - softEdge);
      }
    }

    // Erode mask by 1px to push removal inward (cleans residue fringe)
    const eroded = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let minVal = mask[y * w + x];
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = Math.min(w - 1, Math.max(0, x + dx));
            const ny = Math.min(h - 1, Math.max(0, y + dy));
            minVal = Math.min(minVal, mask[ny * w + nx]);
          }
        }
        eroded[y * w + x] = minVal;
      }
    }

    // Blur mask for smooth anti-aliased edges
    const blurred = new Float32Array(w * h);
    const bR = 2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0, cnt = 0;
        for (let dy = -bR; dy <= bR; dy++) {
          for (let dx = -bR; dx <= bR; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              sum += eroded[ny * w + nx];
              cnt++;
            }
          }
        }
        blurred[y * w + x] = sum / cnt;
      }
    }

    // Apply smoothed mask to alpha channel
    for (let i = 0; i < w * h; i++) {
      if (blurred[i] < 1.0) {
        data[i * 4 + 3] = Math.round(Math.min(data[i * 4 + 3], blurred[i] * 255));
      }
    }

    ctx.putImageData(imageData, 0, 0);
    setResult(resultCanvas.toDataURL("image/png"));
  }, [spoitMode, resultCanvas, spoitSensitivity]);

  // Undo last spoid action
  const handleUndo = useCallback(() => {
    if (!resultCanvas || undoStackRef.current.length === 0) return;
    const stack = undoStackRef.current;
    const prev = stack[stack.length - 1];
    const ctx = resultCanvas.getContext("2d");
    ctx.putImageData(prev, 0, 0);
    setResult(resultCanvas.toDataURL("image/png"));
    undoStackRef.current = stack.slice(0, -1);
    setUndoCount(undoStackRef.current.length);
  }, [resultCanvas]);

  // Zoom with mouse wheel
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    setZoom(prev => {
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      return Math.min(10, Math.max(0.1, prev * delta));
    });
  }, []);

  // Pan with middle-click, Alt+click, or regular drag when not in spoid mode
  const handleMouseDown = useCallback((e) => {
    if (e.button === 1 || (e.altKey && e.button === 0) || (!spoitMode && e.button === 0)) {
      e.preventDefault();
      setIsPanning(true);
      panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    }
  }, [pan, spoitMode]);

  const handleMouseMove = useCallback((e) => {
    if (!isPanning) return;
    setPan({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y });
  }, [isPanning]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  // Reset zoom/pan when a new image is loaded
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [original]);

  const resetZoom = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // ─── Styles ────────────────────────────────────────────────────────
  const styles = {
    app: {
      height: "100vh",
      background: "#f7f7fb",
      color: "#1a1a2e",
      fontFamily: "'Pretendard', -apple-system, BlinkMacSystemFont, sans-serif",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    },
    header: {
      padding: "20px 28px",
      borderBottom: "1px solid #e0e0ec",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      background: "#fff",
    },
    logo: {
      display: "flex",
      alignItems: "center",
      gap: "12px",
    },
    logoIcon: {
      width: "38px",
      height: "38px",
      borderRadius: "10px",
      background: "linear-gradient(135deg, #6c5ce7, #a855f7)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "18px",
      fontWeight: "800",
      color: "#fff",
      boxShadow: "0 2px 12px rgba(108, 92, 231, 0.25)",
    },
    logoText: {
      fontSize: "17px",
      fontWeight: "700",
      letterSpacing: "1.5px",
      textTransform: "uppercase",
      background: "linear-gradient(135deg, #6c5ce7, #a855f7)",
      WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent",
    },
    body: {
      flex: 1,
      display: "flex",
      gap: "0",
      minHeight: 0,
      overflow: "hidden",
    },
    sidebar: {
      width: "300px",
      minWidth: "300px",
      borderRight: "1px solid #e0e0ec",
      display: "flex",
      flexDirection: "column",
      background: "#fff",
      overflow: "hidden",
    },
    sectionTitle: {
      fontSize: "12px",
      fontWeight: "700",
      letterSpacing: "2px",
      textTransform: "uppercase",
      color: "#6c5ce7",
      marginBottom: "14px",
    },
    sliderGroup: {
      display: "flex",
      flexDirection: "column",
      gap: "8px",
    },
    sliderLabel: {
      display: "flex",
      justifyContent: "space-between",
      fontSize: "14px",
      color: "#555570",
    },
    slider: {
      width: "100%",
      height: "5px",
      WebkitAppearance: "none",
      appearance: "none",
      background: "#e0e0ec",
      borderRadius: "4px",
      outline: "none",
      cursor: "pointer",
      accentColor: "#6c5ce7",
    },
    btn: {
      padding: "13px 22px",
      border: "none",
      borderRadius: "10px",
      fontSize: "14px",
      fontWeight: "700",
      fontFamily: "inherit",
      letterSpacing: "0.5px",
      cursor: "pointer",
      transition: "all 0.2s",
    },
    mainArea: {
      flex: 1,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px",
      position: "relative",
      overflow: "hidden",
      minHeight: 0,
    },
    dropzone: {
      width: "100%",
      maxWidth: "600px",
      aspectRatio: "4/3",
      border: "2px dashed",
      borderColor: dragOver ? "#6c5ce7" : "#c8c8d8",
      borderRadius: "16px",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "16px",
      cursor: "pointer",
      transition: "all 0.3s",
      background: dragOver ? "rgba(108, 92, 231, 0.04)" : "#fff",
    },
    imageContainer: {
      width: "100%",
      flex: 1,
      minHeight: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      position: "relative",
      borderRadius: "12px",
      overflow: "hidden",
      background: checkerCSS,
      border: "1px solid #e0e0ec",
    },
    img: {
      maxWidth: "100%",
      maxHeight: "100%",
      objectFit: "contain",
      borderRadius: "4px",
    },
    progressBar: {
      width: "100%",
      maxWidth: "400px",
      height: "5px",
      background: "#e0e0ec",
      borderRadius: "4px",
      overflow: "hidden",
      marginTop: "16px",
    },
    progressFill: {
      height: "100%",
      background: "linear-gradient(90deg, #6c5ce7, #a855f7)",
      borderRadius: "4px",
      transition: "width 0.3s ease",
    },
    pipeline: {
      display: "flex",
      gap: "8px",
      alignItems: "center",
    },
    pipelineStep: (active, done) => ({
      padding: "7px 16px",
      borderRadius: "8px",
      fontSize: "12px",
      fontWeight: "600",
      letterSpacing: "0.5px",
      background: done ? "rgba(108, 92, 231, 0.1)" : active ? "rgba(168, 85, 247, 0.08)" : "#f0f0f6",
      color: done ? "#6c5ce7" : active ? "#a855f7" : "#999aaf",
      border: `1px solid ${done ? "#6c5ce722" : active ? "#a855f722" : "#e0e0ec"}`,
      transition: "all 0.3s",
    }),
    arrow: {
      color: "#c0c0d0",
      fontSize: "12px",
    },
    viewToggle: {
      display: "flex",
      gap: "2px",
      background: "#f0f0f6",
      borderRadius: "8px",
      padding: "3px",
      border: "1px solid #e0e0ec",
    },
    viewBtn: (active) => ({
      padding: "7px 16px",
      border: "none",
      borderRadius: "6px",
      fontSize: "12px",
      fontWeight: "600",
      fontFamily: "inherit",
      letterSpacing: "0.3px",
      cursor: "pointer",
      background: active ? "#6c5ce7" : "transparent",
      color: active ? "#fff" : "#888899",
      transition: "all 0.2s",
    }),
    badge: {
      display: "inline-block",
      padding: "4px 10px",
      borderRadius: "6px",
      fontSize: "12px",
      fontWeight: "600",
      background: "rgba(108, 92, 231, 0.08)",
      color: "#6c5ce7",
      border: "1px solid rgba(108, 92, 231, 0.15)",
    },
    dimInfo: {
      fontSize: "13px",
      color: "#888899",
      marginTop: "10px",
    },
  };

  const pipelineSteps = ["확대", "배경 제거", "자동 크롭"];
  const activeIdx = step.includes("확대") ? 0 : step.includes("배경") ? 1 : step.includes("크롭") ? 2 : -1;

  return (
    <div style={styles.app}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.logo}>
          <div style={styles.logoIcon}>✦</div>
          <div style={styles.logoText}>uncle BOB</div>
        </div>
        <div style={styles.pipeline}>
          {pipelineSteps.map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={styles.pipelineStep(activeIdx === i, progress >= (i + 1) * 33)}>
                {s}
              </div>
              {i < 2 && <span style={styles.arrow}>→</span>}
            </div>
          ))}
        </div>
      </div>

      <div style={styles.body}>
        {/* Sidebar */}
        <div style={styles.sidebar}>
          <div style={{ flex: 1, overflowY: "auto", padding: "28px 22px", display: "flex", flexDirection: "column", gap: "28px" }}>
          <div>
            <div style={styles.sectionTitle}>확대 설정</div>
            <div style={styles.sliderGroup}>
              <div style={styles.sliderLabel}>
                <span>배율</span>
                <span style={{ color: "#6c5ce7", fontWeight: 600 }}>{settings.scale}×</span>
              </div>
              <input
                type="range"
                min="1"
                max="4"
                step="0.5"
                value={settings.scale}
                onChange={(e) => setSettings(s => ({ ...s, scale: parseFloat(e.target.value) }))}
                style={styles.slider}
              />
            </div>
          </div>

          <div>
            <div style={styles.sectionTitle}>배경 제거</div>
            <div style={{ display: "flex", gap: "4px", marginBottom: "14px", background: "#f0f0f6", borderRadius: "8px", padding: "3px", border: "1px solid #e0e0ec" }}>
              <button
                onClick={() => setBgMode("fast")}
                style={{
                  flex: 1, padding: "7px 0", border: "none", borderRadius: "6px", fontSize: "12px",
                  fontWeight: "600", fontFamily: "inherit", cursor: "pointer",
                  background: bgMode === "fast" ? "#6c5ce7" : "transparent",
                  color: bgMode === "fast" ? "#fff" : "#888899",
                  transition: "all 0.2s",
                }}
              >빠른 모드</button>
              <button
                onClick={() => setBgMode("ai")}
                style={{
                  flex: 1, padding: "7px 0", border: "none", borderRadius: "6px", fontSize: "12px",
                  fontWeight: "600", fontFamily: "inherit", cursor: "pointer",
                  background: bgMode === "ai" ? "#6c5ce7" : "transparent",
                  color: bgMode === "ai" ? "#fff" : "#888899",
                  transition: "all 0.2s",
                }}
              >AI 정밀</button>
            </div>
            {bgMode === "fast" ? (
              <div style={styles.sliderGroup}>
                <div style={styles.sliderLabel}>
                  <span>감도</span>
                  <span style={{ color: "#6c5ce7", fontWeight: 600 }}>{settings.sensitivity}</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="80"
                  step="1"
                  value={settings.sensitivity}
                  onChange={(e) => setSettings(s => ({ ...s, sensitivity: parseInt(e.target.value) }))}
                  style={styles.slider}
                />
                <div style={{ fontSize: "12px", color: "#999aaf", marginTop: "4px" }}>
                  단색 배경에 최적화 · 빠른 처리
                </div>
              </div>
            ) : (
              <div style={{ fontSize: "12px", color: "#555570", lineHeight: "1.6" }}>
                AI가 피사체 형태를 인식하여 배경 제거. 복잡한 배경도 처리 가능.
                {aiStatus === "error" && (
                  <div style={{ color: "#dc2626", marginTop: "6px" }}>
                    AI 모델 로드 실패. 배포 환경에서 사용해 주세요.
                  </div>
                )}
                <div style={{ color: "#999aaf", marginTop: "6px", fontSize: "11px" }}>
                  첫 실행 시 모델 다운로드 (~40MB)
                </div>
              </div>
            )}
          </div>

          {bgMode === "fast" && (
          <div>
            <div style={styles.sectionTitle}>테두리 정리</div>
            <div style={styles.sliderGroup}>
              <div style={styles.sliderLabel}>
                <span>깎기 (px)</span>
                <span style={{ color: "#6c5ce7", fontWeight: 600 }}>{settings.trim}px</span>
              </div>
              <input
                type="range"
                min="0"
                max="5"
                step="1"
                value={settings.trim}
                onChange={(e) => setSettings(s => ({ ...s, trim: parseInt(e.target.value) }))}
                style={styles.slider}
              />
              <div style={{ fontSize: "12px", color: "#999aaf", marginTop: "4px" }}>
                누끼 후 가장자리 찌꺼기 제거
              </div>
            </div>
          </div>
          )}

          <div>
            <div style={styles.sectionTitle}>자동 크롭</div>
            <div style={styles.sliderGroup}>
              <div style={styles.sliderLabel}>
                <span>여백 (px)</span>
                <span style={{ color: "#6c5ce7", fontWeight: 600 }}>{settings.padding}px</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={settings.padding}
                onChange={(e) => setSettings(s => ({ ...s, padding: parseInt(e.target.value) }))}
                style={styles.slider}
              />
            </div>
          </div>

          {result && (
            <div>
              <div style={styles.sectionTitle}>스포이드 도구</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <button
                  onClick={() => setSpoitMode(m => !m)}
                  style={{
                    ...styles.btn,
                    padding: "10px 16px",
                    background: spoitMode ? "#6c5ce7" : "rgba(108, 92, 231, 0.06)",
                    color: spoitMode ? "#fff" : "#6c5ce7",
                    border: `1px solid ${spoitMode ? "#6c5ce7" : "rgba(108, 92, 231, 0.2)"}`,
                    fontSize: "13px",
                  }}
                >
                  {spoitMode ? "💧 스포이드 ON" : "💧 스포이드 OFF"}
                </button>
                {spoitMode && (
                  <div style={styles.sliderGroup}>
                    <div style={styles.sliderLabel}>
                      <span>제거 범위</span>
                      <span style={{ color: "#6c5ce7", fontWeight: 600 }}>{spoitSensitivity}</span>
                    </div>
                    <input
                      type="range"
                      min="5"
                      max="60"
                      step="1"
                      value={spoitSensitivity}
                      onChange={(e) => setSpoitSensitivity(parseInt(e.target.value))}
                      style={styles.slider}
                    />
                    <div style={{ fontSize: "12px", color: "#999aaf", marginTop: "2px" }}>
                      이미지 클릭 시 해당 색상 영역 제거
                    </div>
                  </div>
                )}
                {undoCount > 0 && (
                  <button
                    onClick={handleUndo}
                    style={{
                      ...styles.btn,
                      padding: "8px 16px",
                      background: "rgba(245, 158, 11, 0.06)",
                      color: "#d97706",
                      border: "1px solid rgba(245, 158, 11, 0.2)",
                      fontSize: "12px",
                    }}
                  >
                    ↩ 되돌리기 ({undoCount})
                  </button>
                )}
              </div>
            </div>
          )}

          </div>

          <div style={{ padding: "16px 22px", borderTop: "1px solid #e0e0ec", display: "flex", flexDirection: "column", gap: "8px", flexShrink: 0 }}>
            {original && (
              <button
                onClick={processImage}
                disabled={processing}
                style={{
                  ...styles.btn,
                  background: processing
                    ? "#d0d0dd"
                    : "linear-gradient(135deg, #6c5ce7, #a855f7)",
                  color: processing ? "#888" : "#fff",
                  boxShadow: processing ? "none" : "0 4px 20px rgba(108, 92, 231, 0.3)",
                  opacity: processing ? 0.6 : 1,
                }}
              >
                {processing ? `${step}` : "▶  처리 시작"}
              </button>
            )}
            {result && (
              <>
                <button
                  onClick={download}
                  style={{
                    ...styles.btn,
                    background: "rgba(16, 185, 129, 0.08)",
                    color: "#059669",
                    border: "1px solid rgba(16, 185, 129, 0.25)",
                  }}
                >
                  ↓  PNG 다운로드
                </button>
                <button
                  onClick={reset}
                  style={{
                    ...styles.btn,
                    background: "rgba(239, 68, 68, 0.06)",
                    color: "#dc2626",
                    border: "1px solid rgba(239, 68, 68, 0.2)",
                  }}
                >
                  ✕  초기화
                </button>
              </>
            )}
          </div>
        </div>

        {/* Main Area */}
        <div style={styles.mainArea}>
          {!original ? (
            <div
              style={styles.dropzone}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => loadImage(e.target.files[0])}
              />
              <div style={{ fontSize: "52px", opacity: 0.25 }}>✦</div>
              <div style={{ fontSize: "16px", fontWeight: "600", color: "#555570" }}>
                이미지를 드래그하거나 클릭하여 업로드
              </div>
              <div style={{ fontSize: "13px", color: "#999aaf" }}>
                PNG · JPG · WEBP
              </div>
            </div>
          ) : (
            <>
              {/* Top bar with view toggle and info */}
              <div style={{
                width: "100%",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "12px",
                flexShrink: 0,
              }}>
                {result && (
                  <div style={styles.viewToggle}>
                    <button
                      style={styles.viewBtn(viewMode === "original")}
                      onClick={() => setViewMode("original")}
                    >
                      원본
                    </button>
                    <button
                      style={styles.viewBtn(viewMode === "result")}
                      onClick={() => setViewMode("result")}
                    >
                      결과
                    </button>
                  </div>
                )}
                {!result && <div />}
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  {original && (
                    <span style={styles.badge}>
                      {original.width} × {original.height}
                    </span>
                  )}
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    background: "#f0f0f6",
                    borderRadius: "8px",
                    padding: "3px",
                    border: "1px solid #e0e0ec",
                  }}>
                    <button
                      onClick={() => setZoom(z => Math.max(0.1, z * 0.8))}
                      style={{
                        ...styles.btn, padding: "4px 10px", fontSize: "14px", fontWeight: "700",
                        background: "transparent", color: "#555570", border: "none", borderRadius: "6px",
                      }}
                    >−</button>
                    <button
                      onClick={resetZoom}
                      style={{
                        ...styles.btn, padding: "4px 8px", fontSize: "11px", fontWeight: "600",
                        background: "transparent", color: "#6c5ce7", border: "none", borderRadius: "6px",
                        minWidth: "48px", textAlign: "center",
                      }}
                    >{Math.round(zoom * 100)}%</button>
                    <button
                      onClick={() => setZoom(z => Math.min(10, z * 1.25))}
                      style={{
                        ...styles.btn, padding: "4px 10px", fontSize: "14px", fontWeight: "700",
                        background: "transparent", color: "#555570", border: "none", borderRadius: "6px",
                      }}
                    >+</button>
                  </div>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      ...styles.btn,
                      padding: "6px 14px",
                      background: "rgba(108, 92, 231, 0.08)",
                      color: "#666680",
                      border: "1px solid #e0e0ec",
                      fontSize: "12px",
                    }}
                  >
                    교체
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={(e) => loadImage(e.target.files[0])}
                  />
                </div>
              </div>

              {result && (
                <div style={{ ...styles.dimInfo, marginTop: 0, marginBottom: "8px", flexShrink: 0 }}>
                  {spoitMode
                    ? "스포이드 모드 · 제거할 색상 영역을 클릭하세요"
                    : "스크롤로 확대/축소 · Alt+드래그로 이동 · 가운데 클릭으로 이동"}
                </div>
              )}

              {/* Image Display */}
              <div
                ref={containerRef}
                style={{
                  ...styles.imageContainer,
                  cursor: spoitMode && result && viewMode === "result"
                    ? "crosshair"
                    : isPanning ? "grabbing" : "grab",
                  overflow: "hidden",
                }}
                onClick={spoitMode && viewMode === "result" ? handleSpoidClick : undefined}
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              >
                <img
                  ref={imgRef}
                  src={result && viewMode === "result" ? result : preview}
                  alt="preview"
                  style={{
                    ...styles.img,
                    userSelect: "none",
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transformOrigin: "center center",
                    transition: isPanning ? "none" : "transform 0.1s ease-out",
                    willChange: "transform",
                  }}
                  draggable={false}
                />
              </div>

              {/* Progress */}
              {processing && (
                <div style={styles.progressBar}>
                  <div style={{ ...styles.progressFill, width: `${progress}%` }} />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
