/* ------------------------------------------------------------------
   SHARE CARD — 1080x1350 canvas, rendered client-side, no backend.

   Everything except the background plate is drawn in code, so the card
   always shows the player's real numbers and can never go stale against
   a baked-in graphic. Two plates: the normal one, and a cracked variant
   that only appears when the run earned it (Impossible tier, or the
   player actually beat one of the questions AXIOM thinks is unbeatable).

   Fonts are the same two the game already loads. We await document.fonts
   before drawing — canvas silently falls back to a system font if the
   webfont hasn't landed yet, which looks broken next to the live page.
------------------------------------------------------------------- */

const W = 1080;
const H = 1350;

const CREAM = "#EDE1CF";
const AMBER = "#D98E2B";
const NAVY = "#16294A";

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`share card: could not load ${src}`));
    img.src = src;
  });

/* Canvas letterSpacing is still uneven across the browsers our players
   actually use, so tracking is done by hand. Slower, but identical
   everywhere — and this image is the thing that leaves the building. */
function trackedText(ctx, text, cx, y, track, align = "center") {
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + track * Math.max(0, chars.length - 1);
  let x = align === "center" ? cx - total / 2 : align === "right" ? cx - total : cx;
  ctx.textAlign = "left";
  chars.forEach((c, i) => {
    ctx.fillText(c, x, y);
    x += widths[i] + track;
  });
  return total;
}

function wrapLines(ctx, text, maxWidth, maxLines = 2) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else {
      line = next;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  // If it still overflows the last line, trim it rather than let it run off frame.
  if (lines.length === maxLines) {
    let last = lines[maxLines - 1];
    while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    if (last !== lines[maxLines - 1]) lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Draw the share card.
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderShareCard(data) {
  const {
    hei, band, profile, tierLabel, badge,
    sections = [], cracked = 0, assetVersion = "", origin = "",
  } = data;

  // A cracked run gets the fractured plate — the visual reward for the
  // only thing AXIOM said no human could do.
  const useCrackedPlate = cracked > 0 || /IMPOSSIBLE/i.test(tierLabel || "");
  const plateFile = useCrackedPlate ? "share-bg-cracked-v1.jpg" : "share-bg-v1.jpg";
  const v = assetVersion ? `?v=${assetVersion}` : "";

  try { await document.fonts.ready; } catch { /* system font is an acceptable floor */ }

  const [plate, badgeImg, crackImg, qrImg, logoImg] = await Promise.all([
    loadImage(`/assets/human-instincts/share/${plateFile}${v}`),
    loadImage(`/assets/human-instincts/badges/${badge}.webp${v}`),
    cracked > 0 ? loadImage(`/assets/human-instincts/badges/hei-cracked.webp${v}`) : Promise.resolve(null),
    loadImage(`/assets/human-instincts/share/qr-play.png${v}`).catch(() => null),
    loadImage(`/assets/human-instincts/share/atlas-logo-light-mark.png${v}`).catch(() => null),
  ]);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  ctx.drawImage(plate, 0, 0, W, H);

  // The plate's amber bloom sits right where the eyebrow goes, so a soft
  // scrim buys back the contrast without flattening the artwork.
  const scrim = ctx.createLinearGradient(0, 0, 0, 330);
  scrim.addColorStop(0, "rgba(10, 20, 40, 0.55)");
  scrim.addColorStop(1, "rgba(10, 20, 40, 0)");
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, W, 330);

  // Same at the foot — on the cracked plate the fracture runs straight
  // through the URL, which is the one line that has to stay readable.
  const footScrim = ctx.createLinearGradient(0, H - 300, 0, H);
  footScrim.addColorStop(0, "rgba(10, 20, 40, 0)");
  footScrim.addColorStop(1, "rgba(10, 20, 40, 0.72)");
  ctx.fillStyle = footScrim;
  ctx.fillRect(0, H - 300, W, 300);

  ctx.textBaseline = "alphabetic";

  // ---- masthead: Atlas lockup, then the game name as its own wordmark ----
  if (logoImg) {
    const lw = 168;
    const lh = lw * (logoImg.height / logoImg.width);
    ctx.globalAlpha = 0.92;
    ctx.drawImage(logoImg, (W - lw) / 2, 58, lw, lh);
    ctx.globalAlpha = 1;
  }

  // Hairline rule under the university mark so the game name reads as its own
  // title rather than a subtitle of the logo.
  ctx.strokeStyle = "rgba(237, 225, 207, 0.22)";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(W / 2 - 150, 152); ctx.lineTo(W / 2 + 150, 152); ctx.stroke();

  ctx.fillStyle = CREAM;
  ctx.font = '800 46px "Manrope", sans-serif';
  trackedText(ctx, "HUMAN EDGE INDEX", W / 2, 210, 6);

  // ---- badge ---------------------------------------------------------
  const badgeSize = 330;
  const badgeX = (W - badgeSize) / 2;
  const badgeY = 250;
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.38)";
  ctx.shadowBlur = 46;
  ctx.shadowOffsetY = 16;
  ctx.drawImage(badgeImg, badgeX, badgeY, badgeSize, badgeSize);
  ctx.restore();

  // HEI sits in the badge's well, navy on the light token — same as in-game.
  const badgeCx = W / 2;
  const badgeCy = badgeY + badgeSize / 2;
  ctx.textAlign = "center";
  ctx.fillStyle = NAVY;
  ctx.font = '800 118px "Manrope", sans-serif';
  ctx.fillText(String(hei), badgeCx, badgeCy + 26);
  ctx.font = '800 19px "Manrope", sans-serif';
  ctx.fillStyle = "rgba(22, 41, 74, 0.62)";
  trackedText(ctx, "H.E.I.", badgeCx, badgeCy + 66, 5);

  let y = badgeY + badgeSize + 62;

  // ---- band + profile ------------------------------------------------
  ctx.fillStyle = AMBER;
  ctx.font = '800 25px "Manrope", sans-serif';
  trackedText(ctx, `${band} · OUT OF 100`, W / 2, y, 6);
  y += 66;

  ctx.fillStyle = CREAM;
  ctx.font = '800 54px "Manrope", sans-serif';
  ctx.textAlign = "center";
  const nameLines = wrapLines(ctx, profile || "", W - 190, 2);
  nameLines.forEach((line) => {
    ctx.fillText(line, W / 2, y);
    y += 62;
  });

  y += 6;
  ctx.fillStyle = "rgba(237, 225, 207, 0.55)";
  ctx.font = '700 22px "Manrope", sans-serif';
  trackedText(ctx, `${tierLabel || ""} · AXIOM CHALLENGE COMPLETE`, W / 2, y, 5);

  // ---- section bars --------------------------------------------------
  // Anchored to the footer rather than the text above it, so a two-line
  // profile name can't push the bars into the URL.
  const barCount = sections.length;
  const rowH = 62;
  const barsTop = H - 258 - barCount * rowH;
  const labelX = 108;
  const trackX = 470;
  const trackW = 400;

  sections.forEach((s, i) => {
    const rowY = barsTop + i * rowH;
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(237, 225, 207, 0.82)";
    ctx.font = '700 23px "Manrope", sans-serif';
    trackedText(ctx, s.title.toUpperCase(), labelX, rowY, 3, "left");

    const pct = s.max ? Math.max(0, Math.min(1, s.points / s.max)) : 0;
    ctx.fillStyle = "rgba(237, 225, 207, 0.16)";
    roundRect(ctx, trackX, rowY - 16, trackW, 14, 7);
    ctx.fill();
    if (pct > 0) {
      ctx.fillStyle = AMBER;
      roundRect(ctx, trackX, rowY - 16, Math.max(14, trackW * pct), 14, 7);
      ctx.fill();
    }

    ctx.textAlign = "right";
    ctx.fillStyle = CREAM;
    ctx.font = '800 26px "Manrope", sans-serif';
    ctx.fillText(`${s.points}`, W - 108, rowY);
  });

  // ---- cracked award pill --------------------------------------------
  if (cracked > 0 && crackImg) {
    const pillW = 486;
    const pillH = 86;
    const pillX = (W - pillW) / 2;
    const pillY = H - 244;
    ctx.fillStyle = "rgba(217, 142, 43, 0.14)";
    roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(217, 142, 43, 0.5)";
    ctx.lineWidth = 2;
    roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
    ctx.stroke();

    // The cracked token is dark navy and the pill is dark too, so it needs a
    // warm halo behind it or it reads as a smudge at share-card scale.
    // Sits fully inside the pill, centred on its own left cap — it used to
    // overhang the border and read as a sticker stuck on the edge.
    const icon = 62;
    const iconX = pillX + 12;
    const iconY = pillY + (pillH - icon) / 2;
    ctx.save();
    ctx.shadowColor = "rgba(217, 142, 43, 0.75)";
    ctx.shadowBlur = 26;
    ctx.drawImage(crackImg, iconX, iconY, icon, icon);
    ctx.restore();

    ctx.textAlign = "left";
    ctx.fillStyle = AMBER;
    ctx.font = '800 23px "Manrope", sans-serif';
    trackedText(ctx, `×${cracked}  CRACKED THE MACHINE`, iconX + icon + 18, pillY + 52, 3, "left");
  }

  // ---- footer --------------------------------------------------------
  // The typed URL is gone; a QR carries it instead, so the image stays
  // self-contained when someone forwards it with no link attached.
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(237, 225, 207, 0.55)";
  ctx.font = '700 20px "Manrope", sans-serif';
  trackedText(ctx, "THINK YOU CAN BEAT THIS?", 108, H - 104, 5, "left");
  ctx.fillStyle = CREAM;
  ctx.font = '800 25px "Manrope", sans-serif';
  trackedText(ctx, "SCAN TO PLAY", 108, H - 66, 4, "left");

  if (qrImg) {
    // vertically centred on the two footer lines rather than floating above them
    const qs = 138;
    const textMid = (H - 104 + H - 66) / 2 - 8;
    ctx.drawImage(qrImg, W - 108 - qs, textMid - qs / 2, qs, qs);
  }

  return canvas;
}

/* JPEG, not PNG. The card is a photographic plate with no transparency, and
   the PNG came out at 1.8MB — a real cost on mobile data for the exact people
   we want forwarding it. Quality 0.92 is visually identical at a tenth the size. */
export const canvasToBlob = (canvas) =>
  new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92));

/**
 * Hand the card off. Native share sheet first (that's the one that can
 * actually attach the image), then WhatsApp with a link, then download.
 * @returns {Promise<"shared"|"whatsapp"|"download"|"cancelled"|"failed">}
 */
export async function shareCard(canvas, { text, url }) {
  const blob = await canvasToBlob(canvas);
  if (!blob) return "failed";
  const file = new File([blob], "human-instincts-result.jpg", { type: "image/jpeg" });

  if (navigator.canShare?.({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ files: [file], text, title: "ATLAS · HUMAN EDGE INDEX" });
      return "shared";
      } catch (err) {
      // AbortError = the player closed the sheet. Not a failure, and silently
      // downloading after they backed out is hostile.
      if (err?.name === "AbortError") return "cancelled";
      // NotAllowedError = we lost transient user activation (iOS is strict about
      // this). Report it honestly instead of letting it fall through and be
      // logged as a successful download.
      if (err?.name === "NotAllowedError") return "share-blocked";
      return "share-failed";
    }
  }

  // No file sharing: save the image so they still have it, and open a
  // prefilled WhatsApp message they can attach it to. Most of our traffic
  // is Android, and WhatsApp is where these actually get sent.
  downloadCanvas(blob);
  const wa = `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;
  const opened = window.open(wa, "_blank", "noopener");
  return opened ? "whatsapp" : "download";
}

export function downloadCanvas(blob) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = "human-instincts-result.jpg";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 2000);
}


/* ------------------------------------------------------------------
   PRE-BUILD

   navigator.share() needs transient user activation, which every `await`
   between the tap and the call throws away. Building the card takes a font
   wait plus three image loads, so on iOS the sheet was already unreachable by
   the time we asked for it. The results screen calls this on paint; the tap
   handler then has a File in hand and can call share() with no awaits at all.
------------------------------------------------------------------- */
let prepared = null;

export async function prepareShare(data) {
  prepared = null;
  try {
    const canvas = await renderShareCard(data);
    const blob = await canvasToBlob(canvas);
    if (!blob) return null;
    prepared = {
      file: new File([blob], "human-instincts-result.jpg", { type: "image/jpeg" }),
      hei: data.hei,
    };
    return prepared;
  } catch {
    return null;
  }
}

export function takePrepared(hei) {
  // Guard against a stale card from a previous run being shared after replay.
  if (prepared && prepared.hei === hei) return prepared.file;
  return null;
}

export function clearPrepared() { prepared = null; }
