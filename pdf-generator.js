// ============================================================
// HelixIQ — Premium PDF Generator (Node.js / PDFKit)
// Matches the Python/ReportLab design exactly.
// Usage: generatePDF(reportJSON, packageName, email, packageKey)
// Returns: Promise<Buffer>
// ============================================================
// Place the fonts/ folder in the same directory as this file.
// fonts/ must contain:
//   Gloock-Regular.ttf, CrimsonPro-Regular.ttf, CrimsonPro-Bold.ttf,
//   CrimsonPro-Italic.ttf, InstrumentSans-Regular.ttf, InstrumentSans-Bold.ttf,
//   IBMPlexMono-Regular.ttf, IBMPlexMono-Bold.ttf,
//   Lora-Regular.ttf, Lora-Bold.ttf, Lora-Italic.ttf
// ============================================================

import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR  = path.join(__dirname, "fonts");

// ── PALETTE ──────────────────────────────────────────────────
const C = {
  ink:      "#0a0a0f",
  navy:     "#0e1520",
  accent:   "#1a2744",
  gold:     "#c9a84c",
  gold2:    "#e8c97a",
  paper:    "#f5f2eb",
  muted:    "#8a8070",
  green:    "#2a9d72",
  greenBg:  "#081a0f",
  greenT:   "#4ecca3",
  amber:    "#c9823a",
  amberBg:  "#1a0e06",
  amberT:   "#e8a84c",
  red:      "#c94a4a",
  redBg:    "#1a0808",
  redT:     "#e87a7a",
  purple:   "#7755cc",
  purpleBg: "#130d1f",
  purpleT:  "#aa88ee",
  blue:     "#3a6aaa",
  blueBg:   "#081428",
  blueT:    "#6699dd",
};

const W  = 612;   // LETTER width  (pt)
const H  = 792;   // LETTER height (pt)
const ML = 54;    // margin left
const MR = 54;    // margin right
const CW = W - ML - MR;

// ── RARITY / SEVERITY MAPS ───────────────────────────────────
const RARITY_STYLE = {
  "Very Common": { bg: "#141414", fg: C.muted,    label: "COMMON"    },
  "Common":      { bg: "#141414", fg: C.muted,    label: "COMMON"    },
  "Uncommon":    { bg: C.blueBg,  fg: C.blueT,    label: "UNCOMMON"  },
  "Rare":        { bg: C.purpleBg,fg: C.purpleT,  label: "RARE"      },
  "Very Rare":   { bg: C.purpleBg,fg: C.purpleT,  label: "VERY RARE" },
};
const SEVERITY_STYLE = {
  "High Priority":  { bg: C.redBg,   fg: C.redT,   label: "HIGH PRIORITY"  },
  "Moderate":       { bg: C.amberBg, fg: C.amberT, label: "MODERATE"       },
  "Worth Watching": { bg: C.accent,  fg: C.gold,   label: "WORTH WATCHING" },
};
const STATUS_COLORS = {
  "Protective": { bg: "#081a0f", fg: C.greenT },
  "Monitor":    { bg: C.amberBg, fg: C.amberT },
  "Typical":    { bg: "#0d0d14", fg: "#6a6a8a" },
};

// ─────────────────────────────────────────────────────────────
// DRAWING HELPERS
// ─────────────────────────────────────────────────────────────

function fullBleed(doc, color) {
  doc.rect(0, 0, W, H).fill(color);
}

function goldRule(doc, y, { alpha = 0.2, x1 = ML, x2 = W - MR } = {}) {
  doc.save()
    .moveTo(x1, y).lineTo(x2, y)
    .strokeColor(C.gold).lineWidth(0.4).opacity(alpha).stroke()
    .restore();
}

function cornerMarks(doc, { alpha = 0.22, sz = 32, mg = 22 } = {}) {
  const corners = [
    [mg,     H - mg, 1,  -1],
    [W - mg, H - mg, -1, -1],
    [mg,     mg,     1,   1],
    [W - mg, mg,     -1,  1],
  ];
  doc.save().strokeColor(C.gold).lineWidth(0.7).opacity(alpha);
  for (const [ox, oy, dx, dy] of corners) {
    doc.moveTo(ox, oy).lineTo(ox + dx * sz, oy).stroke();
    doc.moveTo(ox, oy).lineTo(ox, oy + dy * sz).stroke();
  }
  doc.restore();
}

// Draw text at exact x,y (baseline). Returns nothing — PDFKit cursor unchanged.
function text(doc, str, x, y, font, size, color, { alpha = 1, maxW = null } = {}) {
  str = (str || "").replace(/ — /g, ", ").replace(/—/g, ",");
  doc.save()
    .font(font).fontSize(size)
    .fillColor(color).opacity(alpha);
  if (maxW) {
    doc.text(str, x, y - size, { width: maxW, lineBreak: true, lineGap: size * 0.45 });
  } else {
    doc.text(str, x, y - size, { lineBreak: false });
  }
  doc.restore();
}

// Measure string width
function strW(doc, str, font, size) {
  return doc.widthOfString(str, { font: path.join(FONT_DIR, font + ".ttf"), fontSize: size });
}

// Label caps with manual tracking
function labelCaps(doc, str, x, y, color = C.gold, alpha = 0.75) {
  str = (str || "").toUpperCase().replace(/—/g, "");
  doc.save().font(path.join(FONT_DIR, "InstrumentSans-Bold.ttf")).fontSize(7)
    .fillColor(color).opacity(alpha);
  let cx = x;
  for (const ch of str) {
    doc.text(ch, cx, y - 7, { lineBreak: false });
    cx += doc.widthOfString(ch) + 1.6;
  }
  doc.restore();
}

// Draw a rounded pill badge. Returns pill width.
function pill(doc, x, y, label, bg, fg, { font = "InstrumentSans-Bold", size = 7 } = {}) {
  const fontPath = path.join(FONT_DIR, font + ".ttf");
  const tw = doc.widthOfString(label, { font: fontPath, fontSize: size }) + 14;
  const ph = 16;
  doc.save()
    .roundedRect(x, y - 1, tw, ph, 3).fill(bg)
    .font(fontPath).fontSize(size).fillColor(fg).opacity(1)
    .text(label, x + 7, y + 2, { lineBreak: false })
    .restore();
  return tw + 6;
}

// Wrap text into lines that fit maxW
function wrapText(doc, str, font, size, maxW) {
  str = (str || "").replace(/ — /g, ", ").replace(/—/g, ",");
  const fontPath = path.join(FONT_DIR, font + ".ttf");
  const words = str.split(" ");
  const lines = [];
  let cur = [];
  for (const w of words) {
    const test = [...cur, w].join(" ");
    if (doc.widthOfString(test, { font: fontPath, fontSize: size }) <= maxW) {
      cur.push(w);
    } else {
      if (cur.length) lines.push(cur.join(" "));
      cur = [w];
    }
  }
  if (cur.length) lines.push(cur.join(" "));
  return lines;
}

function pageFooter(doc, name = "Stephen", date = "March 24, 2026") {
  goldRule(doc, 52, { alpha: 0.1 });
  labelCaps(doc, `Prepared for ${name}   ${date}   myhelixiq.com`, ML, 38, C.paper, 0.18);
}

// ── INSIGHT CARD (wins / risks) ──────────────────────────────
function insightCard(doc, y, item, type, accentColor, bgColor) {
  const cardH = 116;
  const stripeColor = type === "win" ? C.green : C.amber;

  doc.roundedRect(ML, y - cardH, CW, cardH, 5).fill(bgColor);
  doc.rect(ML, y - cardH, 3, cardH).fill(stripeColor);

  // Ghost number
  doc.save().font(path.join(FONT_DIR, "Gloock-Regular.ttf")).fontSize(26)
    .fillColor(accentColor).opacity(0.09)
    .text(String(item._index + 1), W - MR - 26, y - cardH + 12, { lineBreak: false })
    .restore();

  // Tag row: gene + rarity/severity pills
  const tagY = y - 18;
  let tagX = ML + 14;

  // Gene pill
  const genePillBg = type === "win" ? "#0d2a1a" : C.amberBg;
  const genePillFg = type === "win" ? C.greenT : C.amberT;
  tagX += pill(doc, tagX, tagY - 12, item.gene || "", genePillBg, genePillFg,
    { font: "IBMPlexMono-Regular", size: 8 });

  if (type === "win") {
    const rs = RARITY_STYLE[item.rarity] || RARITY_STYLE["Common"];
    tagX += pill(doc, tagX, tagY - 12, rs.label, rs.bg, rs.fg);
    if (item.rarity_pct) {
      doc.save().font(path.join(FONT_DIR, "InstrumentSans-Regular.ttf")).fontSize(7.5)
        .fillColor(C.muted).opacity(1)
        .text(item.rarity_pct, tagX, tagY - 9, { lineBreak: false })
        .restore();
    }
  } else {
    const sv = SEVERITY_STYLE[item.severity] || SEVERITY_STYLE["Moderate"];
    const rs = RARITY_STYLE[item.rarity] || RARITY_STYLE["Common"];
    const sevW = pill(doc, tagX, tagY - 12, sv.label, sv.bg, sv.fg);
    tagX += sevW;
    const rarW = pill(doc, tagX, tagY - 12, rs.label, rs.bg, rs.fg);
    tagX += rarW;
    if (item.rarity_pct) {
      const noteW = doc.widthOfString(item.rarity_pct,
        { font: path.join(FONT_DIR, "InstrumentSans-Regular.ttf"), fontSize: 7.5 });
      if (tagX + noteW < W - MR - 20) {
        doc.save().font(path.join(FONT_DIR, "InstrumentSans-Regular.ttf")).fontSize(7.5)
          .fillColor(C.muted).opacity(1)
          .text(item.rarity_pct, tagX, tagY - 9, { lineBreak: false })
          .restore();
      }
    }
  }

  // Title
  doc.save().font(path.join(FONT_DIR, "Lora-Bold.ttf")).fontSize(12.5)
    .fillColor(C.paper).opacity(1)
    .text(item.title || "", ML + 14, y - 42, { lineBreak: false })
    .restore();

  // Insight lines
  const insightLines = wrapText(doc, item.insight || "", "InstrumentSans-Regular", 9, CW - 36);
  doc.save().font(path.join(FONT_DIR, "InstrumentSans-Regular.ttf")).fontSize(9)
    .fillColor(C.paper).opacity(0.56);
  insightLines.slice(0, 2).forEach((ln, j) => {
    doc.text(ln, ML + 14, y - 60 - j * 13, { lineBreak: false });
  });
  doc.restore();

  // Action
  const actionLines = wrapText(doc, item.action || "", "InstrumentSans-Bold", 9, CW - 36);
  doc.save().font(path.join(FONT_DIR, "InstrumentSans-Bold.ttf")).fontSize(9)
    .fillColor(accentColor).opacity(1)
    .text("> " + (actionLines[0] || ""), ML + 14, y - cardH + 14, { lineBreak: false })
    .restore();

  return cardH;
}


// ─────────────────────────────────────────────────────────────
// PAGE BUILDERS
// ─────────────────────────────────────────────────────────────

function pageCover(doc, data, packageName, email) {
  fullBleed(doc, C.ink);

  // Decorative rings — lower right
  const cxr = W * 0.72, cyr = H * 0.44;
  const rings = [[210, 0.036], [162, 0.050], [114, 0.066], [68, 0.086], [28, 0.12]];
  for (const [r, a] of rings) {
    doc.save().circle(cxr, cyr, r).strokeColor(C.gold).lineWidth(0.4).opacity(a).stroke().restore();
  }
  // Cross hairs
  doc.save().moveTo(W * 0.40, cyr).lineTo(W - 18, cyr)
    .strokeColor(C.gold).lineWidth(0.4).opacity(0.055).stroke().restore();
  doc.save().moveTo(cxr, 36).lineTo(cxr, H - 36)
    .strokeColor(C.gold).lineWidth(0.4).opacity(0.055).stroke().restore();

  // SNP dots
  const rand = seededRand(42);
  for (const ringR of [68, 114, 162, 210]) {
    const n = Math.floor(ringR / 17);
    for (let i = 0; i < n; i++) {
      const angle = rand() * Math.PI * 2;
      const dx = cxr + ringR * Math.cos(angle);
      const dy = cyr + ringR * Math.sin(angle);
      if (dx > 10 && dx < W - 10 && dy > 30 && dy < H - 30) {
        doc.save().circle(dx, dy, 2).fill(C.gold).opacity(rand() * 0.25 + 0.15).restore();
      }
    }
  }

  cornerMarks(doc);

  // Gold top bar
  doc.rect(0, H - 1.5, W, 1.5).fill(C.gold);

  // Logo
  doc.save().font(path.join(FONT_DIR, "Gloock-Regular.ttf")).fontSize(12)
    .fillColor(C.gold).opacity(0.75)
    .text("HelixIQ", ML, H - 44, { lineBreak: false }).restore();
  labelCaps(doc, packageName, ML, H - 62, C.gold, 0.45);
  goldRule(doc, H - 70, { alpha: 0.14, x2: ML + 260 });

  // Headline
  const hs = H - 108, lg = 54;
  doc.save().font(path.join(FONT_DIR, "Gloock-Regular.ttf")).fontSize(46).fillColor(C.paper).opacity(1)
    .text("Your genome has", ML, hs - 46, { lineBreak: false })
    .text("a few things to", ML, hs - 46 - lg, { lineBreak: false });
  doc.font(path.join(FONT_DIR, "Lora-Italic.ttf")).fontSize(46).fillColor(C.gold)
    .text("say about you.", ML, hs - 46 - lg * 2, { lineBreak: false });
  doc.restore();
  goldRule(doc, hs - lg * 2 - 18, { alpha: 0.16, x2: ML + 310 });

  // Stats
  const statY = hs - lg * 2 - 46;
  const stats = [
    ["10",    "pages of personalized", "genetic intelligence"],
    ["700k+", "SNP variants",          "analyzed"],
    ["6",     "genome-specific",       "supplement recommendations"],
  ];
  const colW = CW / 3;
  stats.forEach(([num, l1, l2], i) => {
    const sx = ML + i * colW;
    if (i > 0) {
      doc.save().rect(sx - 10, statY - 36, 1, 50).fill(C.gold).opacity(0.12).restore();
    }
    doc.save().font(path.join(FONT_DIR, "Gloock-Regular.ttf")).fontSize(30)
      .fillColor(C.gold).opacity(0.9).text(num, sx, statY - 30, { lineBreak: false }).restore();
    doc.save().font(path.join(FONT_DIR, "InstrumentSans-Regular.ttf")).fontSize(8.5)
      .fillColor(C.paper).opacity(0.40)
      .text(l1, sx, statY - 18, { lineBreak: false })
      .text(l2, sx, statY - 31, { lineBreak: false }).restore();
  });

  goldRule(doc, statY - 50, { alpha: 0.14 });

  // Intro paragraph
  const introY = statY - 68;
  const intro = "Your genome contains over 700,000 data points. Most DNA services show you fewer than 50. This report translates the raw variants that actually shape how you absorb nutrients, process supplements, and respond to food.";
  const introLines = wrapText(doc, intro, "CrimsonPro-Italic", 12, CW * 0.65);
  doc.save().font(path.join(FONT_DIR, "CrimsonPro-Italic.ttf")).fontSize(12)
    .fillColor(C.paper).opacity(0.50);
  introLines.forEach((ln, i) => {
    doc.text(ln, ML, introY - 12 - i * 17, { lineBreak: false });
  });
  doc.restore();

  goldRule(doc, introY - introLines.length * 17 - 16, { alpha: 0.10 });

  // 4 icon items
  const cardsTop = introY - introLines.length * 17 - 36;
  const cardW = (CW - 12) / 4;
  const itemH = 72;

  const items = [
    { fg: C.greenT, icon: "five",   title: "Genetic Advantages", sub1: "Top 5 strengths",  sub2: "with rarity ratings" },
    { fg: C.amberT, icon: "five",   title: "Areas to Address",   sub1: "Top 5 risks",      sub2: "with severity tags"  },
    { fg: C.blueT,  icon: "pill",   title: "Supplement Stack",   sub1: "Genome protocol",  sub2: "with shopping guide" },
    { fg: C.gold,   icon: "target", title: "Dietary Blueprint",  sub1: "Optimal pattern",  sub2: "with food targets"   },
  ];

  items.forEach(({ fg, icon, title, sub1, sub2 }, i) => {
    const ix = ML + i * (cardW + 4);
    const iy = cardsTop;

    // Left rule only — no box
    doc.save().rect(ix, iy - itemH + 6, 2, itemH - 6).fill(fg).opacity(0.55).restore();

    const iconX = ix + 12;
    const iconY = iy - 16;

    if (icon === "five") {
      // Ghost large 5
      doc.save().font(path.join(FONT_DIR, "Gloock-Regular.ttf")).fontSize(32)
        .fillColor(fg).opacity(0.22).text("5", iconX, iconY - 28, { lineBreak: false }).restore();
      // Solid small 5
      doc.save().font(path.join(FONT_DIR, "Gloock-Regular.ttf")).fontSize(18)
        .fillColor(fg).opacity(1).text("5", iconX + 1, iconY - 14, { lineBreak: false }).restore();
    } else if (icon === "pill") {
      const pw = 26, ph = 13;
      const px = iconX, py = iconY - 2;
      doc.save().roundedRect(px, py, pw, ph, ph / 2).fill(fg).opacity(0.18).restore();
      doc.save().roundedRect(px, py, pw, ph, ph / 2).strokeColor(fg).lineWidth(1.2).opacity(0.72).stroke().restore();
      doc.save().moveTo(px + pw / 2, py + 2).lineTo(px + pw / 2, py + ph - 2)
        .strokeColor(fg).lineWidth(0.7).opacity(0.35).stroke().restore();
    } else if (icon === "target") {
      const tcx = iconX + 12, tcy = iconY - 2;
      for (const [r, a] of [[12, 0.13], [8, 0.20], [4, 0.52]]) {
        doc.save().circle(tcx, tcy, r).fill(fg).opacity(a).restore();
      }
      doc.save()
        .moveTo(tcx - 14, tcy).lineTo(tcx + 14, tcy)
        .strokeColor(fg).lineWidth(0.5).opacity(0.22).stroke().restore();
      doc.save()
        .moveTo(tcx, tcy - 14).lineTo(tcx, tcy + 14)
        .strokeColor(fg).lineWidth(0.5).opacity(0.22).stroke().restore();
    }

    // Title
    doc.save().font(path.join(FONT_DIR, "InstrumentSans-Bold.ttf")).fontSize(9)
      .fillColor(C.paper).opacity(0.88)
      .text(title, ix + 10, iy - itemH + 36, { lineBreak: false }).restore();

    // Sub lines in accent color
    doc.save().font(path.join(FONT_DIR, "InstrumentSans-Regular.ttf")).fontSize(7.5)
      .fillColor(fg).opacity(0.62)
      .text(sub1, ix + 10, iy - itemH + 22, { lineBreak: false })
      .text(sub2, ix + 10, iy - itemH + 11, { lineBreak: false }).restore();
  });

  goldRule(doc, cardsTop - itemH - 10, { alpha: 0.10 });
  doc.save().font(path.join(FONT_DIR, "InstrumentSans-Regular.ttf")).fontSize(8)
    .fillColor(C.paper).opacity(0.20)
    .text(`Prepared for ${email}   .   myhelixiq.com`, ML, cardsTop - itemH - 26, { lineBreak: false })
    .restore();
}


function pageWins(doc, wins) {
  fullBleed(doc, C.ink);
  cornerMarks(doc);

  doc.rect(0, H - 80, W, 80).fill(C.greenBg);
  doc.rect(0, H - 81, W, 2).fill(C.green);

  labelCaps(doc, "01   Your Genetic Advantages", ML, H - 28, C.greenT);
  doc.save().font(path.join(FONT_DIR, "Gloock-Regular.ttf")).fontSize(28)
    .fillColor(C.paper).opacity(1)
    .text("Top 5 Things Working in Your Favor", ML, H - 62, { lineBreak: false }).restore();

  goldRule(doc, H - 90, { alpha: 0.1 });

  let y = H - 96;
  wins.forEach((win, i) => {
    win._index = i;
    insightCard(doc, y, win, "win", C.greenT, "#0c0c14");
    y -= 116 + 6;
  });

  pageFooter(doc);
}


function pageRisks(doc, risks) {
  fullBleed(doc, C.ink);
  cornerMarks(doc);

  doc.rect(0, H - 80, W, 80).fill(C.amberBg);
  doc.rect(0, H - 81, W, 2).fill(C.amber);

  labelCaps(doc, "02   Areas Worth Your Focus", ML, H - 28, C.amberT);
  doc.save().font(path.join(FONT_DIR, "Gloock-Regular.ttf")).fontSize(28)
    .fillColor(C.paper).opacity(1)
    .text("Top 5 Things to Address", ML, H - 62, { lineBreak: false }).restore();

  doc.save().font(path.join(FONT_DIR, "CrimsonPro-Italic.ttf")).fontSize(11)
    .fillColor(C.amberT).opacity(0.6)
    .text("Not predictions. Places where small, deliberate changes produce outsized results.",
      ML, H - 88, { lineBreak: false }).restore();

  goldRule(doc, H - 96, { alpha: 0.1 });

  let y = H - 108;
  risks.forEach((risk, i) => {
    risk._index = i;
    insightCard(doc, y, risk, "risk", C.amberT, "#120c0a");
    y -= 114 + 6;
  });

  pageFooter(doc);
}


function pageSupplements(doc, supplements) {
  fullBleed(doc, C.ink);
  cornerMarks(doc);

  doc.rect(0, H - 78, W, 78).fill(C.accent);
  goldRule(doc, H - 78, { alpha: 0.3 });

  labelCaps(doc, "03   Your Protocol", ML, H - 26);
  doc.save().font(path.join(FONT_DIR, "Gloock-Regular.ttf")).fontSize(26)
    .fillColor(C.paper).opacity(1)
    .text("Genome-Based Supplement Stack", ML, H - 58, { lineBreak: false }).restore();

  // Priority dots legend
  doc.save().font(path.join(FONT_DIR, "InstrumentSans-Regular.ttf")).fontSize(8)
    .fillColor(C.paper).opacity(0.35)
    .text("Priority:  \u25cf\u25cf\u25cf  Essential   \u25cf\u25cf\u25cb  Recommended",
      W - MR - 200, H - 30, { lineBreak: false }).restore();

  goldRule(doc, H - 86, { alpha: 0.1 });

  let y = H - 100;
  const rowH = 98;

  supplements.forEach((s, i) => {
    const bg = i % 2 === 0 ? "#0d0d16" : "#0a0a12";
    doc.roundedRect(ML, y - rowH, CW, rowH, 4).fill(bg);

    // Priority dots
    for (let d = 0; d < 3; d++) {
      doc.circle(ML + 14 + d * 11, y - 18, 3.8)
        .fill(d < s.priority ? C.gold : "#2a2a2a");
    }

    // Name
    doc.save().font(path.join(FONT_DIR, "Lora-Bold.ttf")).fontSize(13)
      .fillColor(C.paper).opacity(1)
      .text(s.name, ML + 54, y - 16, { lineBreak: false }).restore();

    // Dose
    doc.save().font(path.join(FONT_DIR, "IBMPlexMono-Regular.ttf")).fontSize(8)
      .fillColor(C.gold).opacity(0.85)
      .text(s.dose, ML + 54, y - 30, { lineBreak: false }).restore();

    // Why text (grey)
    const whyLines = wrapText(doc, s.why, "InstrumentSans-Regular", 8, CW - 72);
    doc.save().font(path.join(FONT_DIR, "InstrumentSans-Regular.ttf")).fontSize(8)
      .fillColor(C.paper).opacity(0.42);
    whyLines.slice(0, 2).forEach((ln, j) => {
      doc.text(ln, ML + 54, y - 44 - j * 12, { lineBreak: false });
    });
    doc.restore();
    const whyBottom = y - 44 - (Math.min(whyLines.length, 2) - 1) * 12;

    // Green form badge
    const formText = s.form;
    const formW = Math.min(doc.widthOfString(formText,
      { font: path.join(FONT_DIR, "InstrumentSans-Regular.ttf"), fontSize: 8.5 }) + 16, CW - 68);
    const greenY = whyBottom - 18;
    doc.roundedRect(ML + 54, greenY, formW, 15, 3).fill(C.greenBg);
    doc.save().roundedRect(ML + 54, greenY, formW, 15, 3)
      .strokeColor(C.green).lineWidth(0.5).opacity(0.35).stroke().restore();
    doc.save().font(path.join(FONT_DIR, "InstrumentSans-Regular.ttf")).fontSize(8.5)
      .fillColor(C.greenT).opacity(1)
      .text(formText.slice(0, 60), ML + 62, greenY + 4, { lineBreak: false }).restore();

    // Red warning badge
    const warnLines = wrapText(doc, s.warning, "InstrumentSans-Regular", 8, CW - 72);
    const warnText = warnLines[0] || "";
    const warnW = Math.min(doc.widthOfString(warnText,
      { font: path.join(FONT_DIR, "InstrumentSans-Regular.ttf"), fontSize: 8 }) + 28, CW - 68);
    const redY = greenY - 22;
    doc.roundedRect(ML + 54, redY, warnW, 15, 3).fill(C.redBg);
    doc.save().roundedRect(ML + 54, redY, warnW, 15, 3)
      .strokeColor(C.red).lineWidth(0.5).opacity(0.3).stroke().restore();
    doc.save().font(path.join(FONT_DIR, "InstrumentSans-Bold.ttf")).fontSize(8)
      .fillColor(C.redT).opacity(1)
      .text("!", ML + 62, redY + 4, { lineBreak: false }).restore();
    doc.save().font(path.join(FONT_DIR, "InstrumentSans-Regular.ttf")).fontSize(8)
      .fillColor(C.redT).opacity(1)
      .text(warnText.slice(0, 70), ML + 74, redY + 4, { lineBreak: false }).restore();

    goldRule(doc, y - rowH, { alpha: 0.06 });
    y -= rowH;
  });

  pageFooter(doc);
}


function pageShopping(doc, shoppingTips) {
  fullBleed(doc, C.ink);
  cornerMarks(doc);

  doc.rect(0, H - 78, W, 78).fill("#0a1010");
  doc.rect(0, H - 79, W, 1.5).fill(C.green);

  labelCaps(doc, "04   Buyer's Guide", ML, H - 26, C.greenT);
  doc.save().font(path.join(FONT_DIR, "Gloock-Regular.ttf")).fontSize(26)
    .fillColor(C.paper).opacity(1)
    .text("How to Shop Without Getting Scammed", ML, H - 58, { lineBreak: false }).restore();

  doc.save().font(path.join(FONT_DIR, "CrimsonPro-Italic.ttf")).fontSize(11.5)
    .fillColor(C.paper).opacity(0.45)
    .text("The supplement industry is largely unregulated. What the label says and what is in the bottle are often different things.",
      ML, H - 88, { lineBreak: false }).restore();

  goldRule(doc, H - 96, { alpha: 0.1 });

  let y = H - 114;
  const cardH = 120;
  const tipColors = [C.greenT, C.gold, C.redT, C.blueT];
  const tipBgs   = [C.greenBg, C.accent, C.redBg, C.blueBg];

  shoppingTips.forEach((tip, i) => {
    const ic = tipColors[i % tipColors.length];
    const ib = tipBgs[i % tipBgs.length];

    doc.roundedRect(ML, y - cardH, CW, cardH, 5).fill("#0c0c14");

    // Circle with number
    const circY = y - cardH / 2;
    doc.circle(ML + 34, circY, 26).fill(ib);
    doc.save().circle(ML + 34, circY, 26)
      .strokeColor(ic).lineWidth(1).opacity(0.4).stroke().restore();

    // Centered number
    const numStr = String(i + 1);
    const nw = doc.widthOfString(numStr,
      { font: path.join(FONT_DIR, "Gloock-Regular.ttf"), fontSize: 20 });
    doc.save().font(path.join(FONT_DIR, "Gloock-Regular.ttf")).fontSize(20)
      .fillColor(ic).opacity(1)
      .text(numStr, ML + 34 - nw / 2, circY - 7, { lineBreak: false }).restore();

    // Accent stripe
    doc.save().rect(ML, y - cardH, 3, cardH).fill(ic).opacity(0.6).restore();

    // Title
    doc.save().font(path.join(FONT_DIR, "Lora-Bold.ttf")).fontSize(13)
      .fillColor(C.paper).opacity(1)
      .text(tip.flag, ML + 72, y - 28, { lineBreak: false }).restore();

    // Body
    const bodyLines = wrapText(doc, tip.body, "CrimsonPro-Regular", 11.5, CW - 86);
    doc.save().font(path.join(FONT_DIR, "CrimsonPro-Regular.ttf")).fontSize(11.5)
      .fillColor(C.paper).opacity(0.68);
    bodyLines.slice(0, 4).forEach((ln, j) => {
      doc.text(ln, ML + 72, y - 46 - j * 15, { lineBreak: false });
    });
    doc.restore();

    y -= cardH + 8;
  });

  // Certification seals
  goldRule(doc, y - 10, { alpha: 0.1 });
  doc.save().font(path.join(FONT_DIR, "InstrumentSans-Bold.ttf")).fontSize(8)
    .fillColor(C.gold).opacity(0.6)
    .text("Certification seals to look for:", ML, y - 24, { lineBreak: false }).restore();

  const seals = ["NSF Certified", "USP Verified", "Informed Sport", "ConsumerLab"];
  let sx = ML;
  seals.forEach(seal => {
    const sw = doc.widthOfString(seal,
      { font: path.join(FONT_DIR, "InstrumentSans-Bold.ttf"), fontSize: 8 }) + 20;
    doc.roundedRect(sx, y - 48, sw, 18, 3).fill(C.accent);
    doc.save().font(path.join(FONT_DIR, "InstrumentSans-Bold.ttf")).fontSize(8)
      .fillColor(C.gold).opacity(1)
      .text(seal, sx + 10, y - 40, { lineBreak: false }).restore();
    sx += sw + 8;
  });

  pageFooter(doc);
}


function pageDiet(doc, diet, doLess) {
  fullBleed(doc, C.ink);
  cornerMarks(doc);

  doc.rect(0, H - 78, W, 78).fill("#0c160c");
  doc.rect(0, H - 79, W, 1.5).fill(C.green);

  labelCaps(doc, "05   Dietary Blueprint", ML, H - 26, C.greenT);
  doc.save().font(path.join(FONT_DIR, "Gloock-Regular.ttf")).fontSize(26)
    .fillColor(C.paper).opacity(1)
    .text("Your Optimal Eating Pattern", ML, H - 58, { lineBreak: false }).restore();

  goldRule(doc, H - 70, { alpha: 0.15 });

  // Mediterranean badge — below rule
  const badgeTop = H - 100;
  doc.roundedRect(ML, badgeTop, 220, 24, 4).fill(C.accent);
  doc.rect(ML, badgeTop, 3, 24).fill(C.gold);
  doc.save().font(path.join(FONT_DIR, "InstrumentSans-Regular.ttf")).fontSize(8.5)
    .fillColor(C.paper).opacity(0.48)
    .text("Recommended pattern", ML + 12, badgeTop + 8, { lineBreak: false }).restore();
  const rpW = doc.widthOfString("Recommended pattern",
    { font: path.join(FONT_DIR, "InstrumentSans-Regular.ttf"), fontSize: 8.5 });
  doc.save().font(path.join(FONT_DIR, "Gloock-Regular.ttf")).fontSize(14)
    .fillColor(C.gold).opacity(1)
    .text(diet.pattern || "Mediterranean", ML + 12 + rpW + 8, badgeTop + 7, { lineBreak: false }).restore();

  // Food cards 3+2
  const cw3 = (CW - 16) / 3;
  const cw2 = (CW - 8) / 2;
  const row1Y = H - 138;
  const card1H = 150;
  const row2Y = row1Y - card1H - 8;
  const card2H = 148;

  const ICONS = ["LEAF", "FISH", "DROP", "CIRCLE", "BEAN"];
  const ICON_COLORS = [C.greenT, C.blueT, C.amberT, C.gold, C.greenT];
  const ICON_BGS    = [C.greenBg, C.blueBg, C.amberBg, "#1a1508", C.greenBg];

  // Row 1: 3 cards
  diet.eat_more.slice(0, 3).forEach((item, i) => {
    const cx = ML + i * (cw3 + 8);
    const top = row1Y;
    doc.roundedRect(cx, top - card1H, cw3, card1H, 5).fill(ICON_BGS[i]);
    doc.save().roundedRect(cx, top - card1H, cw3, card1H, 5)
      .strokeColor(ICON_COLORS[i]).lineWidth(0.6).opacity(0.25).stroke().restore();

    // Icon circle
    const icx = cx + cw3 / 2;
    const icy = top - 30;
    doc.save().circle(icx, icy, 20).fill(ICON_BGS[i]).restore();
    drawFoodIcon(doc, ICONS[i], icx, icy, 11, ICON_COLORS[i]);

    // Title centered
    const titleW = doc.widthOfString(item.title,
      { font: path.join(FONT_DIR, "Lora-Bold.ttf"), fontSize: 11 });
    doc.save().font(path.join(FONT_DIR, "Lora-Bold.ttf")).fontSize(11)
      .fillColor(C.paper).opacity(1)
      .text(item.title, cx + (cw3 - titleW) / 2, top - 58, { lineBreak: false }).restore();

    const subW = doc.widthOfString(item.sub,
      { font: path.join(FONT_DIR, "InstrumentSans-Bold.ttf"), fontSize: 8 });
    doc.save().font(path.join(FONT_DIR, "InstrumentSans-Bold.ttf")).fontSize(8)
      .fillColor(ICON_COLORS[i]).opacity(1)
      .text(item.sub, cx + (cw3 - subW) / 2, top - 72, { lineBreak: false }).restore();

    const bodyLines = wrapText(doc, item.body, "InstrumentSans-Regular", 8, cw3 - 18);
    doc.save().font(path.join(FONT_DIR, "InstrumentSans-Regular.ttf")).fontSize(8)
      .fillColor(C.paper).opacity(0.6);
    bodyLines.slice(0, 5).forEach((ln, j) => {
      doc.text(ln, cx + 9, top - 88 - j * 12, { lineBreak: false });
    });
    doc.restore();
  });

  // Row 2: 2 cards
  diet.eat_more.slice(3, 5).forEach((item, i) => {
    const cx = ML + i * (cw2 + 8);
    const top = row2Y;
    doc.roundedRect(cx, top - card2H, cw2, card2H, 5).fill(ICON_BGS[3 + i]);
    doc.save().roundedRect(cx, top - card2H, cw2, card2H, 5)
      .strokeColor(ICON_COLORS[3 + i]).lineWidth(0.6).opacity(0.22).stroke().restore();

    const icx = cx + 28, icy = top - 32;
    doc.save().circle(icx, icy, 20).fill(ICON_BGS[3 + i]).restore();
    drawFoodIcon(doc, ICONS[3 + i], icx, icy, 11, ICON_COLORS[3 + i]);

    doc.save().font(path.join(FONT_DIR, "Lora-Bold.ttf")).fontSize(12)
      .fillColor(C.paper).opacity(1)
      .text(item.title, cx + 58, top - 24, { lineBreak: false }).restore();
    doc.save().font(path.join(FONT_DIR, "InstrumentSans-Bold.ttf")).fontSize(8)
      .fillColor(ICON_COLORS[3 + i]).opacity(1)
      .text(item.sub, cx + 58, top - 38, { lineBreak: false }).restore();

    const bodyLines = wrapText(doc, item.body, "InstrumentSans-Regular", 8.5, cw2 - 24);
    doc.save().font(path.join(FONT_DIR, "InstrumentSans-Regular.ttf")).fontSize(8.5)
      .fillColor(C.paper).opacity(0.6);
    bodyLines.slice(0, 5).forEach((ln, j) => {
      doc.text(ln, cx + 14, top - 56 - j * 13, { lineBreak: false });
    });
    doc.restore();
  });

  // Do Less strip
  const stripY = row2Y - card2H - 12;
  const stripH = 72;
  doc.roundedRect(ML, stripY - stripH, CW, stripH, 4).fill(C.amberBg);
  doc.rect(ML, stripY - stripH, 3, stripH).fill(C.amber);
  labelCaps(doc, "Reduce These", ML + 14, stripY - 16, C.amberT);
  const colW2 = (CW - 28) / 3;
  doLess.forEach(([title, body], i) => {
    const cx2 = ML + 14 + i * (colW2 + 4);
    doc.save().font(path.join(FONT_DIR, "InstrumentSans-Bold.ttf")).fontSize(9)
      .fillColor(C.amberT).opacity(1)
      .text(title, cx2, stripY - 30, { lineBreak: false }).restore();
    const bl = wrapText(doc, body, "InstrumentSans-Regular", 7.5, colW2 - 4);
    doc.save().font(path.join(FONT_DIR, "InstrumentSans-Regular.ttf")).fontSize(7.5)
      .fillColor(C.paper).opacity(0.5);
    bl.slice(0, 2).forEach((ln, j) => {
      doc.text(ln, cx2, stripY - 42 - j * 11, { lineBreak: false });
    });
    doc.restore();
  });

  pageFooter(doc);
}

function drawFoodIcon(doc, type, cx, cy, size, color) {
  if (type === "LEAF") {
    doc.save()
      .moveTo(cx, cy + size)
      .bezierCurveTo(cx + size * 0.8, cy + size * 0.6, cx + size * 0.9, cy - size * 0.2, cx, cy - size)
      .bezierCurveTo(cx - size * 0.9, cy - size * 0.2, cx - size * 0.8, cy + size * 0.6, cx, cy + size)
      .fill(color).restore();
  } else if (type === "FISH") {
    doc.save()
      .moveTo(cx - size, cy)
      .bezierCurveTo(cx - size * 0.3, cy + size * 0.6, cx + size * 0.3, cy + size * 0.6, cx + size, cy)
      .bezierCurveTo(cx + size * 0.3, cy - size * 0.6, cx - size * 0.3, cy - size * 0.6, cx - size, cy)
      .fill(color).restore();
    doc.save()
      .moveTo(cx + size, cy).lineTo(cx + size * 1.5, cy + size * 0.5)
      .lineTo(cx + size * 1.5, cy - size * 0.5).closePath().fill(color).restore();
  } else if (type === "DROP") {
    doc.save()
      .moveTo(cx, cy + size)
      .bezierCurveTo(cx + size * 0.8, cy + size * 0.2, cx + size * 0.8, cy - size * 0.5, cx, cy - size)
      .bezierCurveTo(cx - size * 0.8, cy - size * 0.5, cx - size * 0.8, cy + size * 0.2, cx, cy + size)
      .fill(color).restore();
  } else if (type === "CIRCLE") {
    doc.circle(cx, cy, size).fill(color);
    doc.circle(cx, cy, size * 0.55).fill(C.ink);
  } else if (type === "BEAN") {
    doc.save()
      .moveTo(cx, cy + size)
      .bezierCurveTo(cx + size * 0.9, cy + size * 0.5, cx + size * 0.6, cy - size * 0.3, cx + size * 0.1, cy - size * 0.8)
      .bezierCurveTo(cx - size * 0.5, cy - size, cx - size * 0.9, cy - size * 0.3, cx - size * 0.5, cy + size * 0.4)
      .bezierCurveTo(cx - size * 0.2, cy + size * 0.9, cx, cy + size, cx, cy + size)
      .fill(color).restore();
  }
}


function pageFamily(doc, family) {
  fullBleed(doc, C.ink);
  cornerMarks(doc);

  doc.rect(0, H - 78, W, 78).fill(C.accent);
  goldRule(doc, H - 78, { alpha: 0.3 });

  labelCaps(doc, "06   The People in Your Life", ML, H - 26);
  doc.save().font(path.join(FONT_DIR, "Gloock-Regular.ttf")).fontSize(26)
    .fillColor(C.paper).opacity(1)
    .text("What Your Loved Ones Should Know", ML, H - 58, { lineBreak: false }).restore();
  goldRule(doc, H - 86, { alpha: 0.1 });

  // Partner card — auto-sized
  const partnerLines = wrapText(doc, family.partner, "CrimsonPro-Regular", 12, CW - 32);
  const partnerH = partnerLines.length * 18 + 80;
  const py = H - 106;

  doc.roundedRect(ML, py - partnerH, CW, partnerH, 6).fill(C.accent);
  doc.rect(ML, py - partnerH, 3, partnerH).fill(C.gold);

  doc.save().font(path.join(FONT_DIR, "Gloock-Regular.ttf")).fontSize(22)
    .fillColor(C.gold).opacity(1)
    .text("For Your Partner", ML + 14, py - 26, { lineBreak: false }).restore();
  goldRule(doc, py - 34, { alpha: 0.2, x1: ML + 14, x2: ML + 222 });

  doc.save().font(path.join(FONT_DIR, "CrimsonPro-Regular.ttf")).fontSize(12)
    .fillColor(C.paper).opacity(0.82);
  partnerLines.forEach((ln, j) => {
    doc.text(ln, ML + 14, py - 52 - j * 18, { lineBreak: false });
  });
  doc.restore();

  // Children card — auto-sized
  const childLines = wrapText(doc, family.children, "CrimsonPro-Regular", 12, CW - 32);
  const childH = childLines.length * 18 + 80;
  const cy2 = py - partnerH - 16;

  doc.roundedRect(ML, cy2 - childH, CW, childH, 6).fill("#10101c");
  doc.rect(ML, cy2 - childH, 3, childH).fill(C.purple);

  doc.save().font(path.join(FONT_DIR, "Gloock-Regular.ttf")).fontSize(22)
    .fillColor(C.purpleT).opacity(1)
    .text("For Your Children", ML + 14, cy2 - 26, { lineBreak: false }).restore();
  goldRule(doc, cy2 - 34, { alpha: 0.18, x1: ML + 14, x2: ML + 230 });

  doc.save().font(path.join(FONT_DIR, "CrimsonPro-Regular.ttf")).fontSize(12)
    .fillColor(C.paper).opacity(0.78);
  childLines.forEach((ln, j) => {
    doc.text(ln, ML + 14, cy2 - 52 - j * 18, { lineBreak: false });
  });
  doc.restore();

  pageFooter(doc);
}


function pageActions(doc, actions) {
  fullBleed(doc, C.ink);
  cornerMarks(doc);

  doc.rect(0, H - 78, W, 78).fill(C.accent);
  doc.rect(0, H - 79, W, 1.5).fill(C.gold);

  labelCaps(doc, "07   Your Roadmap", ML, H - 26);
  doc.save().font(path.join(FONT_DIR, "Gloock-Regular.ttf")).fontSize(26)
    .fillColor(C.paper).opacity(1)
    .text("5 Actions. Start With Number One.", ML, H - 58, { lineBreak: false }).restore();

  doc.save().font(path.join(FONT_DIR, "CrimsonPro-Italic.ttf")).fontSize(11.5)
    .fillColor(C.gold).opacity(0.5)
    .text("One step at a time. These are yours to keep.", ML, H - 94, { lineBreak: false }).restore();

  goldRule(doc, H - 106, { alpha: 0.1 });

  let y = H - 122;
  actions.forEach((action, i) => {
    const lines = wrapText(doc, action, "Lora-Regular", 12.5, CW - 56);
    const hNeeded = Math.max(64, 22 + lines.length * 17 + 16);

    doc.roundedRect(ML, y - hNeeded, CW, hNeeded, 4).fill("#0c0c14");

    // Ghost number
    doc.save().font(path.join(FONT_DIR, "Gloock-Regular.ttf")).fontSize(56)
      .fillColor(C.gold).opacity(0.06)
      .text(String(i + 1), W - MR - 42, y - hNeeded + 4, { lineBreak: false }).restore();

    // Bold number
    doc.save().font(path.join(FONT_DIR, "Gloock-Regular.ttf")).fontSize(22)
      .fillColor(C.gold).opacity(1)
      .text(String(i + 1), ML + 12, y - 28, { lineBreak: false }).restore();

    // Vertical rule
    doc.save().rect(ML + 36, y - hNeeded + 10, 1, hNeeded - 20).fill(C.gold).opacity(0.18).restore();

    // Action text
    doc.save().font(path.join(FONT_DIR, "Lora-Regular.ttf")).fontSize(12.5)
      .fillColor(C.paper).opacity(1);
    lines.forEach((ln, j) => {
      doc.text(ln, ML + 48, y - 18 - j * 17, { lineBreak: false });
    });
    doc.restore();

    y -= hNeeded + 8;
  });

  pageFooter(doc);
}


function pageVariants(doc, variants) {
  fullBleed(doc, C.ink);
  cornerMarks(doc);

  doc.rect(0, H - 78, W, 78).fill("#0a0f0a");
  goldRule(doc, H - 78, { alpha: 0.3 });

  labelCaps(doc, "08   Variant Reference", ML, H - 26);
  doc.save().font(path.join(FONT_DIR, "Gloock-Regular.ttf")).fontSize(26)
    .fillColor(C.paper).opacity(1)
    .text("Your Key Variants at a Glance", ML, H - 58, { lineBreak: false }).restore();
  goldRule(doc, H - 86, { alpha: 0.1 });

  const hy = H - 100;
  doc.rect(ML - 6, hy - 8, CW + 12, 26).fill(C.accent);

  const cols = [ML, ML + 76, ML + 164, ML + 218, ML + 304];
  const hdrs = ["Gene", "Variant", "Genotype", "Status", "What It Means"];
  hdrs.forEach((h, i) => labelCaps(doc, h, cols[i] + 4, hy + 4));

  let rowY = hy - 18;
  const rowH = 32;

  variants.forEach((v, i) => {
    const bg = i % 2 === 0 ? "#0d0d16" : C.ink;
    doc.rect(ML - 6, rowY - rowH + 4, CW + 12, rowH).fill(bg);

    const sc = STATUS_COLORS[v.status] || STATUS_COLORS["Typical"];
    doc.save().rect(ML - 6, rowY - rowH + 4, 2.5, rowH).fill(sc.fg).opacity(0.6).restore();

    doc.save().font(path.join(FONT_DIR, "IBMPlexMono-Bold.ttf")).fontSize(10)
      .fillColor(C.paper).opacity(1)
      .text(v.gene, cols[0] + 4, rowY - 14, { lineBreak: false }).restore();
    doc.save().font(path.join(FONT_DIR, "IBMPlexMono-Regular.ttf")).fontSize(8)
      .fillColor(C.muted).opacity(1)
      .text(v.rsid, cols[1] + 2, rowY - 14, { lineBreak: false }).restore();
    doc.save().font(path.join(FONT_DIR, "IBMPlexMono-Bold.ttf")).fontSize(11)
      .fillColor(C.paper).opacity(1)
      .text(v.geno, cols[2] + 2, rowY - 14, { lineBreak: false }).restore();

    pill(doc, cols[3] + 2, rowY - 20, v.status, sc.bg, sc.fg,
      { font: "InstrumentSans-Bold", size: 7 });

    const sumLines = wrapText(doc, v.summary, "InstrumentSans-Regular", 9, W - MR - cols[4] - 4);
    doc.save().font(path.join(FONT_DIR, "InstrumentSans-Regular.ttf")).fontSize(9)
      .fillColor(C.paper).opacity(0.58)
      .text(sumLines[0] || "", cols[4] + 2, rowY - 14, { lineBreak: false }).restore();

    goldRule(doc, rowY - rowH + 4, { alpha: 0.06 });
    rowY -= rowH;
  });

  pageFooter(doc);
}


function pageBack(doc) {
  fullBleed(doc, C.ink);
  cornerMarks(doc, { alpha: 0.22, sz: 40, mg: 24 });
  doc.rect(0, H - 1.5, W, 1.5).fill(C.gold);
  doc.rect(0, 0, W, 2).fill(C.gold).opacity(0.3);

  const logoY = H * 0.56;
  const hw = doc.widthOfString("Helix",
    { font: path.join(FONT_DIR, "Gloock-Regular.ttf"), fontSize: 42 });
  const iqw = doc.widthOfString("IQ",
    { font: path.join(FONT_DIR, "CrimsonPro-Regular.ttf"), fontSize: 42 });

  doc.save().font(path.join(FONT_DIR, "Gloock-Regular.ttf")).fontSize(42)
    .fillColor(C.gold).opacity(0.85)
    .text("Helix", W / 2 - (hw + iqw) / 2, logoY - 42, { lineBreak: false }).restore();
  doc.save().font(path.join(FONT_DIR, "CrimsonPro-Regular.ttf")).fontSize(42)
    .fillColor(C.paper).opacity(0.28)
    .text("IQ", W / 2 - (hw + iqw) / 2 + hw, logoY - 42, { lineBreak: false }).restore();

  goldRule(doc, logoY - 12, { alpha: 0.15 });

  const url = "myhelixiq.com";
  const uw = doc.widthOfString(url,
    { font: path.join(FONT_DIR, "InstrumentSans-Regular.ttf"), fontSize: 9.5 });
  doc.save().font(path.join(FONT_DIR, "InstrumentSans-Regular.ttf")).fontSize(9.5)
    .fillColor(C.paper).opacity(0.28)
    .text(url, W / 2 - uw / 2, logoY - 30, { lineBreak: false }).restore();

  goldRule(doc, 76, { alpha: 0.14 });
  const disclaimers = [
    "This report is for educational purposes only and does not constitute medical advice, diagnosis, or treatment.",
    "Consult a qualified healthcare professional before making health decisions. Raw DNA file permanently deleted after analysis.",
  ];
  disclaimers.forEach((d, i) => {
    const dw = doc.widthOfString(d,
      { font: path.join(FONT_DIR, "InstrumentSans-Regular.ttf"), fontSize: 7.5 });
    doc.save().font(path.join(FONT_DIR, "InstrumentSans-Regular.ttf")).fontSize(7.5)
      .fillColor(C.paper).opacity(0.18)
      .text(d, W / 2 - dw / 2, 62 - i * 14, { lineBreak: false }).restore();
  });
}


// ── SEEDED RANDOM (for consistent dot placement) ─────────────
function seededRand(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}


// ─────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────

export async function generatePDF(reportText, packageName, email, packageKey) {
  return new Promise((resolve, reject) => {

    // Parse JSON from Claude's response
    let data = {};
    try {
      const jsonMatch = reportText.match(/\{[\s\S]*\}/);
      data = JSON.parse(jsonMatch ? jsonMatch[0] : reportText);
    } catch {
      // If parsing fails, wrap in minimal structure
      data = { headline: packageName, intro: reportText };
    }

    // Register fonts
    const doc = new PDFDocument({
      size: "LETTER",
      autoFirstPage: false,
      info: {
        Title:   `HelixIQ ${packageName}`,
        Author:  "HelixIQ",
        Subject: "Genetic Analysis Report",
      },
    });

    // Register all fonts
    const fonts = {
      "Gloock-Regular":        "Gloock-Regular.ttf",
      "CrimsonPro-Regular":    "CrimsonPro-Regular.ttf",
      "CrimsonPro-Bold":       "CrimsonPro-Bold.ttf",
      "CrimsonPro-Italic":     "CrimsonPro-Italic.ttf",
      "InstrumentSans-Regular":"InstrumentSans-Regular.ttf",
      "InstrumentSans-Bold":   "InstrumentSans-Bold.ttf",
      "IBMPlexMono-Regular":   "IBMPlexMono-Regular.ttf",
      "IBMPlexMono-Bold":      "IBMPlexMono-Bold.ttf",
      "Lora-Regular":          "Lora-Regular.ttf",
      "Lora-Bold":             "Lora-Bold.ttf",
      "Lora-Italic":           "Lora-Italic.ttf",
    };
    for (const [name, file] of Object.entries(fonts)) {
      doc.registerFont(name, path.join(FONT_DIR, file));
    }

    const chunks = [];
    doc.on("data",  chunk => chunks.push(chunk));
    doc.on("end",   () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── Map Claude JSON to page data ──────────────────────────
    // The system prompts return structured JSON — extract the right fields
    const wins = (data.topWins || data.topStrengths || data.topAdvantages || []).map((w, i) => ({
      ...w, _index: i,
      rarity:     w.rarity     || "Common",
      rarity_pct: w.rarity_pct || w.rarity_pct || "",
    }));

    const risks = (data.topRisks || data.watchAreas || []).map((r, i) => ({
      ...r, _index: i,
      severity:   r.severity   || r.urgency || "Moderate",
      rarity:     r.rarity     || "Common",
      rarity_pct: r.rarity_pct || "",
    }));

    const supplements = (data.supplementStack || []).map(s => ({
      name:     s.name     || "",
      dose:     s.dose     || s.form || "",
      form:     s.form     || "",
      why:      s.why      || "",
      warning:  s.warning  || "Check form and certification before purchasing.",
      priority: s.priority === "Essential"    ? 3
              : s.priority === "Recommended"  ? 2 : 1,
    }));

    const shoppingTips = data.shoppingTips || [
      { flag: "Third-Party Tested",          body: "Look for NSF Certified, USP Verified, or Informed Sport on the label. These seals mean an independent lab confirmed what is in the bottle matches what the label says." },
      { flag: "Form Matters More Than Brand", body: "Methylcobalamin vs cyanocobalamin. L-methylfolate vs folic acid. Ubiquinol vs ubiquinone. The form often matters more than the brand name." },
      { flag: "Proprietary Blends Are a Red Flag", body: "If a supplement lists a proprietary blend with a total weight but no individual amounts, you have no idea how much of anything you are getting." },
      { flag: "Bioavailability Varies Enormously", body: "Magnesium oxide: 4% absorbed. Magnesium glycinate: up to 80%. Always research the specific form before purchasing." },
    ];

    const dietPattern = data.dietPattern || {};
    const eatMore = (dietPattern.doMore || []).map((item, i) => ({
      title: typeof item === "string" ? item.split("(")[0].trim() : item.title || item,
      sub:   typeof item === "string" ? "Daily" : item.sub || "Daily",
      body:  typeof item === "string" ? item : item.body || item,
    }));
    // Ensure at least 5 eat-more items
    while (eatMore.length < 5) eatMore.push({ title: "Whole Foods", sub: "Daily", body: "Focus on minimally processed, nutrient-dense whole foods." });

    const doLess = (dietPattern.doLess || []).map(item => {
      if (typeof item === "string") {
        const parts = item.split(" — ");
        return [parts[0], parts[1] || item];
      }
      return [item.title || item, item.body || item];
    });
    while (doLess.length < 3) doLess.push(["Processed Foods", "Limit refined and highly processed options."]);

    const family = {
      partner:  data.familyNotes?.partner  || "Share this report with your partner to discuss any heritable findings together.",
      children: data.familyNotes?.children || "Some variants in this report may be heritable. Discuss with a healthcare provider before family planning.",
    };

    const actions = data.actionPlan || data.preventionPlan || data.performancePlan || [
      "Review your current supplements against the recommendations in this report.",
      "Book a baseline blood test to establish your key nutritional markers.",
      "Start with the highest-priority supplement changes first.",
      "Adjust your diet toward the recommended pattern over the next 30 days.",
      "Return to this report in 90 days to track your progress.",
    ];

    const variants = data.keyVariants || [];

    // ── Build pages ───────────────────────────────────────────
    doc.addPage();
    pageCover(doc, data, packageName, email);

    doc.addPage();
    pageWins(doc, wins.slice(0, 5));

    doc.addPage();
    pageRisks(doc, risks.slice(0, 5));

    doc.addPage();
    pageSupplements(doc, supplements.slice(0, 6));

    doc.addPage();
    pageShopping(doc, shoppingTips.slice(0, 4));

    doc.addPage();
    pageDiet(doc, { pattern: dietPattern.recommendation || "Mediterranean", eat_more: eatMore }, doLess.slice(0, 3));

    doc.addPage();
    pageFamily(doc, family);

    doc.addPage();
    pageActions(doc, actions.slice(0, 5));

    if (variants.length > 0) {
      doc.addPage();
      pageVariants(doc, variants.slice(0, 10));
    }

    doc.addPage();
    pageBack(doc);

    doc.end();
  });
}
