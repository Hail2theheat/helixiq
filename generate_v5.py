#!/usr/bin/env python3
"""
HelixIQ Premium Report v3
- 3 cover concepts to choose from
- Top 5 wins/risks with rarity + severity tags
- No em-dashes anywhere
- Supplement page fully filled with warnings + shopping guide
- Diet page with icons, no text cutoffs
- Proper text wrapping throughout
"""

import sys
import json
import io
import os
import math
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.pagesizes import LETTER

FONT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'canvas-fonts')
pdfmetrics.registerFont(TTFont("Gloock",        f"{FONT_DIR}/Gloock-Regular.ttf"))
pdfmetrics.registerFont(TTFont("Crimson",       f"{FONT_DIR}/CrimsonPro-Regular.ttf"))
pdfmetrics.registerFont(TTFont("CrimsonBold",   f"{FONT_DIR}/CrimsonPro-Bold.ttf"))
pdfmetrics.registerFont(TTFont("CrimsonItalic", f"{FONT_DIR}/CrimsonPro-Italic.ttf"))
pdfmetrics.registerFont(TTFont("Instrument",    f"{FONT_DIR}/InstrumentSans-Regular.ttf"))
pdfmetrics.registerFont(TTFont("InstrumentB",   f"{FONT_DIR}/InstrumentSans-Bold.ttf"))
pdfmetrics.registerFont(TTFont("Mono",          f"{FONT_DIR}/IBMPlexMono-Regular.ttf"))
pdfmetrics.registerFont(TTFont("MonoBold",      f"{FONT_DIR}/IBMPlexMono-Bold.ttf"))
pdfmetrics.registerFont(TTFont("Lora",          f"{FONT_DIR}/Lora-Regular.ttf"))
pdfmetrics.registerFont(TTFont("LoraItalic",    f"{FONT_DIR}/Lora-Italic.ttf"))
pdfmetrics.registerFont(TTFont("LoraBold",      f"{FONT_DIR}/Lora-Bold.ttf"))

from reportlab.lib.colors import HexColor

# ── CLI args + stdin interface ────────────────────────
package_name = sys.argv[1] if len(sys.argv) > 1 else 'Nutrition & Supplements'
customer_email = sys.argv[2] if len(sys.argv) > 2 else 'customer@example.com'
package_key = sys.argv[3] if len(sys.argv) > 3 else 'nutrition'

raw_json = sys.stdin.read()
REPORT_DATA = {}
if raw_json.strip():
    REPORT_DATA = json.loads(raw_json)
    REPORT_DATA['customer_name'] = REPORT_DATA.get('customer_name', customer_email.split('@')[0].capitalize())
    REPORT_DATA['email'] = customer_email

INK      = HexColor("#0a0a0f")
NAVY     = HexColor("#0e1520")
ACCENT   = HexColor("#1a2744")
GOLD     = HexColor("#c9a84c")
GOLD2    = HexColor("#e8c97a")
PAPER    = HexColor("#f5f2eb")
MUTED    = HexColor("#8a8070")
GREEN    = HexColor("#2a9d72")
GREEN_BG = HexColor("#081a0f")
GREEN_T  = HexColor("#4ecca3")
AMBER    = HexColor("#c9823a")
AMBER_BG = HexColor("#1a0e06")
AMBER_T  = HexColor("#e8a84c")
RED      = HexColor("#c94a4a")
RED_BG   = HexColor("#1a0808")
RED_T    = HexColor("#e87a7a")
PURPLE   = HexColor("#7755cc")
PURPLE_BG= HexColor("#130d1f")
PURPLE_T = HexColor("#aa88ee")
BLUE     = HexColor("#3a6aaa")
BLUE_BG  = HexColor("#081428")
BLUE_T   = HexColor("#6699dd")

W, H = LETTER
ML = 54
MR = 54
CW = W - ML - MR

# ─────────────────────────────────────────────────────────
# CORE HELPERS
# ─────────────────────────────────────────────────────────

def full_bleed(c, color):
    c.setFillColor(color)
    c.rect(0, 0, W, H, fill=1, stroke=0)

def gold_rule(c, y, alpha=0.2, x1=None, x2=None):
    c.setStrokeColor(GOLD)
    c.setLineWidth(0.4)
    c.setStrokeAlpha(alpha)
    c.line(x1 or ML, y, x2 or (W - MR), y)
    c.setStrokeAlpha(1)

def corner_marks(c, alpha=0.22, sz=32, mg=22):
    c.setStrokeColor(GOLD)
    c.setLineWidth(0.7)
    c.setStrokeAlpha(alpha)
    for (ox, oy, dx, dy) in [(mg, H-mg, 1, -1), (W-mg, H-mg, -1, -1),
                              (mg, mg,   1,  1), (W-mg, mg,   -1,  1)]:
        c.line(ox, oy, ox + dx*sz, oy)
        c.line(ox, oy, ox, oy + dy*sz)
    c.setStrokeAlpha(1)

def wrap(c, text, font, size, max_w):
    words = text.replace(" — ", ", ").replace("—", ",").split()
    lines, cur = [], []
    for w in words:
        test = " ".join(cur + [w])
        if c.stringWidth(test, font, size) <= max_w:
            cur.append(w)
        else:
            if cur:
                lines.append(" ".join(cur))
            cur = [w]
    if cur:
        lines.append(" ".join(cur))
    return lines

def put_text(c, text, x, y, font, size, color, alpha=1.0, max_w=None, lh=None):
    """Draw text with optional wrapping. Returns bottom-most y used."""
    text = text.replace(" — ", ", ").replace("—", ",")
    if lh is None:
        lh = size * 1.45
    c.setFont(font, size)
    c.setFillColor(color)
    c.setFillAlpha(alpha)
    if max_w:
        lines = wrap(c, text, font, size, max_w)
        for i, ln in enumerate(lines):
            c.drawString(x, y - i * lh, ln)
        c.setFillAlpha(1)
        return y - (len(lines) - 1) * lh
    else:
        c.drawString(x, y, text)
        c.setFillAlpha(1)
        return y

def label_caps(c, text, x, y, color=GOLD, alpha=0.75):
    text = text.replace("—", "").replace("  ", " ")
    c.setFont("InstrumentB", 7)
    c.setFillColor(color)
    c.setFillAlpha(alpha)
    cx = x
    for ch in text.upper():
        c.drawString(cx, y, ch)
        cx += c.stringWidth(ch, "InstrumentB", 7) + 1.6
    c.setFillAlpha(1)

def pill(c, x, y, text, bg, fg, font="InstrumentB", sz=7):
    tw = c.stringWidth(text, font, sz) + 14
    c.setFillColor(bg)
    c.roundRect(x, y - 1, tw, 16, 3, fill=1, stroke=0)
    c.setFont(font, sz)
    c.setFillColor(fg)
    c.drawString(x + 7, y + 3, text)
    return tw + 6

def page_footer(c, name="Stephen", date="March 24, 2026"):
    gold_rule(c, 52, alpha=0.1)
    label_caps(c, f"Prepared for {name}   {date}   myhelixiq.com",
               ML, 38, PAPER, 0.18)


# ─────────────────────────────────────────────────────────
# REPORT DATA — mapped from REPORT_DATA (Claude JSON)
# ─────────────────────────────────────────────────────────

_d = REPORT_DATA

# ── Wins (topWins / topStrengths / topAdvantages) ────────
_raw_wins = _d.get('topWins') or _d.get('topStrengths') or _d.get('topAdvantages') or []
WINS = [{
    'gene':       w.get('gene', ''),
    'title':      w.get('title', ''),
    'insight':    w.get('insight', ''),
    'action':     w.get('action', ''),
    'rarity':     w.get('rarity', 'Common'),
    'rarity_pct': w.get('rarity_pct', ''),
    'impact':     w.get('impact', 'Moderate'),
} for w in _raw_wins[:5]]

# ── Risks (topRisks / watchAreas) ────────────────────────
_raw_risks = _d.get('topRisks') or _d.get('watchAreas') or []
RISKS = [{
    'gene':       r.get('gene', ''),
    'title':      r.get('title', ''),
    'insight':    r.get('insight', ''),
    'action':     r.get('action', ''),
    'severity':   r.get('severity') or r.get('urgency', 'Moderate'),
    'rarity':     r.get('rarity', 'Common'),
    'rarity_pct': r.get('rarity_pct', ''),
} for r in _raw_risks[:5]]

# ── Supplements (supplementStack) ────────────────────────
_raw_supps = _d.get('supplementStack') or []
SUPPLEMENTS = [{
    'name':     s.get('name', ''),
    'dose':     s.get('dose') or s.get('form', ''),
    'form':     s.get('form', ''),
    'why':      s.get('why', ''),
    'warning':  s.get('warning', 'Check form and certification before purchasing.'),
    'priority': 3 if s.get('priority') == 'Essential' else 2 if s.get('priority') == 'Recommended' else 1,
} for s in _raw_supps[:6]]

SHOPPING_TIPS = [
    {
        "flag": "Third-Party Tested",
        "icon_color": GREEN_T,
        "icon_bg": GREEN_BG,
        "body": "Look for NSF Certified, USP Verified, or Informed Sport on the label. These seals mean an independent lab confirmed what is in the bottle matches what the label says.",
    },
    {
        "flag": "Form Matters More Than Brand",
        "icon_color": GOLD,
        "icon_bg": ACCENT,
        "body": "Methylcobalamin vs cyanocobalamin. L-methylfolate vs folic acid. Ubiquinol vs ubiquinone. The form of a nutrient often matters more than the brand. Generic supplements with the right form beat premium brands with the wrong one.",
    },
    {
        "flag": "Proprietary Blends Are a Red Flag",
        "icon_color": RED_T,
        "icon_bg": RED_BG,
        "body": "If a supplement lists a proprietary blend with a total weight but no individual amounts, you have no idea how much of anything you are getting. Avoid these entirely for the supplements in your stack.",
    },
    {
        "flag": "Bioavailability Varies Enormously",
        "icon_color": BLUE_T,
        "icon_bg": BLUE_BG,
        "body": "Magnesium oxide: 4% absorbed. Magnesium glycinate: up to 80%. You can take double the milligrams and still get less. Always research the specific form before purchasing.",
    },
]

_icon_palette = [
    {"icon": "LEAF",   "color": GREEN_T, "bg": GREEN_BG},
    {"icon": "FISH",   "color": BLUE_T,  "bg": BLUE_BG},
    {"icon": "DROP",   "color": AMBER_T, "bg": AMBER_BG},
    {"icon": "CIRCLE", "color": GOLD,    "bg": HexColor("#1a1508")},
    {"icon": "BEAN",   "color": GREEN_T, "bg": GREEN_BG},
]

_raw_do_more = (_d.get('dietPattern') or {}).get('doMore') or []
DIET_SECTIONS = []
for idx, item in enumerate(_raw_do_more[:5]):
    pal = _icon_palette[idx % len(_icon_palette)]
    DIET_SECTIONS.append({
        "icon":  pal["icon"],
        "color": pal["color"],
        "bg":    pal["bg"],
        "title": item.get('food', ''),
        "sub":   item.get('frequency', ''),
        "body":  item.get('reason', ''),
    })

_raw_do_less = (_d.get('dietPattern') or {}).get('doLess') or []
DO_LESS = [(item.get('food', ''), item.get('reason', '')) for item in _raw_do_less[:3]]

_raw_variants = _d.get('keyVariants') or []
VARIANTS = [{
    'gene':    v.get('gene', ''),
    'rsid':    v.get('variant') or v.get('rsid', ''),
    'geno':    v.get('genotype') or v.get('geno', ''),
    'status':  v.get('status', 'Typical'),
    'summary': v.get('summary', ''),
} for v in _raw_variants[:10]]

_raw_actions = _d.get('actionPlan') or _d.get('preventionPlan') or _d.get('performancePlan') or _d.get('masterActionPlan') or []
if _raw_actions and isinstance(_raw_actions[0], dict):
    ACTIONS = [a.get('action') or a.get('step', '') for a in _raw_actions[:5]]
else:
    ACTIONS = [str(a) for a in _raw_actions[:5]]

_raw_family = _d.get('familyNotes') or {}
FAMILY = {
    "partner":  _raw_family.get('partner', ''),
    "children": _raw_family.get('children', ''),
}


# ─────────────────────────────────────────────────────────
# ICON DRAWERS
# ─────────────────────────────────────────────────────────

def draw_icon(c, icon_type, cx, cy, size, color):
    c.setFillColor(color)
    if icon_type == "LEAF":
        p = c.beginPath()
        p.moveTo(cx, cy + size)
        p.curveTo(cx + size*0.8, cy + size*0.6, cx + size*0.9, cy - size*0.2, cx, cy - size)
        p.curveTo(cx - size*0.9, cy - size*0.2, cx - size*0.8, cy + size*0.6, cx, cy + size)
        p.close()
        c.drawPath(p, fill=1, stroke=0)
        c.setStrokeColor(color)
        c.setStrokeAlpha(0.4)
        c.setLineWidth(0.6)
        c.line(cx, cy + size * 0.9, cx, cy - size * 0.9)
        c.setStrokeAlpha(1)
    elif icon_type == "FISH":
        p = c.beginPath()
        p.moveTo(cx - size, cy)
        p.curveTo(cx - size*0.3, cy + size*0.6, cx + size*0.3, cy + size*0.6, cx + size, cy)
        p.curveTo(cx + size*0.3, cy - size*0.6, cx - size*0.3, cy - size*0.6, cx - size, cy)
        p.close()
        c.drawPath(p, fill=1, stroke=0)
        # Tail fin
        p2 = c.beginPath()
        p2.moveTo(cx + size, cy)
        p2.lineTo(cx + size*1.5, cy + size*0.5)
        p2.lineTo(cx + size*1.5, cy - size*0.5)
        p2.close()
        c.drawPath(p2, fill=1, stroke=0)
    elif icon_type == "DROP":
        p = c.beginPath()
        p.moveTo(cx, cy + size)
        p.curveTo(cx + size*0.8, cy + size*0.2, cx + size*0.8, cy - size*0.5, cx, cy - size)
        p.curveTo(cx - size*0.8, cy - size*0.5, cx - size*0.8, cy + size*0.2, cx, cy + size)
        p.close()
        c.drawPath(p, fill=1, stroke=0)
    elif icon_type == "CIRCLE":
        c.setFillColor(color)
        c.circle(cx, cy, size, fill=1, stroke=0)
        c.setFillColor(HexColor("#0a0a0f"))
        c.circle(cx, cy, size * 0.55, fill=1, stroke=0)
    elif icon_type == "BEAN":
        p = c.beginPath()
        p.moveTo(cx, cy + size)
        p.curveTo(cx + size*0.9, cy + size*0.5, cx + size*0.6, cy - size*0.3, cx + size*0.1, cy - size*0.8)
        p.curveTo(cx - size*0.5, cy - size*1.0, cx - size*0.9, cy - size*0.3, cx - size*0.5, cy + size*0.4)
        p.curveTo(cx - size*0.2, cy + size*0.9, cx, cy + size, cx, cy + size)
        p.close()
        c.drawPath(p, fill=1, stroke=0)


# ─────────────────────────────────────────────────────────
# COVER CONCEPTS  (3 options)
# ─────────────────────────────────────────────────────────

def cover_A(c):
    """Concept A: The Private Letter — intimate, personal, almost text-free"""
    full_bleed(c, HexColor("#08080c"))
    corner_marks(c, alpha=0.2, sz=44, mg=24)

    # Top thin gold
    c.setFillColor(GOLD)
    c.setFillAlpha(0.4)
    c.rect(0, H - 1.5, W, 1.5, fill=1, stroke=0)
    c.setFillAlpha(1)

    # Very faint helix motif behind text — two sine waves
    c.setStrokeColor(GOLD)
    c.setStrokeAlpha(0.035)
    c.setLineWidth(1.2)
    steps = 120
    p1 = c.beginPath()
    p2 = c.beginPath()
    for i in range(steps + 1):
        t  = i / steps
        x  = ML + CW * t
        y1 = H * 0.38 + 44 * math.sin(t * math.pi * 4)
        y2 = H * 0.38 + 44 * math.sin(t * math.pi * 4 + math.pi)
        if i == 0:
            p1.moveTo(x, y1)
            p2.moveTo(x, y2)
        else:
            p1.lineTo(x, y1)
            p2.lineTo(x, y2)
    c.drawPath(p1, fill=0, stroke=1)
    c.drawPath(p2, fill=0, stroke=1)
    c.setStrokeAlpha(1)

    # Top: small logo
    c.setFont("Gloock", 11)
    c.setFillColor(GOLD)
    c.setFillAlpha(0.7)
    c.drawString(ML, H - 44, "HelixIQ")
    c.setFillAlpha(1)
    c.setFont("Instrument", 8)
    c.setFillColor(PAPER)
    c.setFillAlpha(0.3)
    c.drawString(ML + c.stringWidth("HelixIQ", "Gloock", 11) + 10, H - 44, "Nutrition and Supplements Report")
    c.setFillAlpha(1)

    # Center: addressed to
    c.setFont("CrimsonItalic", 16)
    c.setFillColor(GOLD)
    c.setFillAlpha(0.6)
    c.drawString(ML, H * 0.72, "For Stephen.")
    c.setFillAlpha(1)

    # Main headline — Gloock, elegant, large but not screaming
    gold_rule(c, H * 0.70, alpha=0.18)

    lines_h = ["A portrait in four", "hundred thousand", "data points."]
    c.setFont("Gloock", 46)
    c.setFillColor(PAPER)
    for i, ln in enumerate(lines_h):
        c.drawString(ML, H * 0.64 - i * 54, ln)

    # Italic subtext
    gold_rule(c, H * 0.64 - len(lines_h) * 54 - 12, alpha=0.14)
    c.setFont("CrimsonItalic", 13)
    c.setFillColor(PAPER)
    c.setFillAlpha(0.45)
    c.drawString(ML, H * 0.64 - len(lines_h) * 54 - 28,
                 "What your genome has been trying to tell you.")
    c.setFillAlpha(1)

    # Bottom
    page_footer(c)


def cover_B(c):
    """Concept B: The Observatory — full bleed, no empty space"""
    full_bleed(c, INK)

    # Rings — center-right, vertically centered
    cx_r, cy_r = W * 0.72, H * 0.44
    c.setStrokeColor(GOLD)
    c.setLineWidth(0.4)
    for r, a in [(210, 0.036), (162, 0.050), (114, 0.066), (68, 0.086), (28, 0.12)]:
        c.setStrokeAlpha(a)
        c.circle(cx_r, cy_r, r, fill=0, stroke=1)
    c.setStrokeAlpha(1)

    # Cross hairs — right side only
    c.setStrokeColor(GOLD)
    c.setStrokeAlpha(0.055)
    c.setLineWidth(0.4)
    c.line(W * 0.40, cy_r, W - 18, cy_r)
    c.line(cx_r, 36, cx_r, H - 36)
    c.setStrokeAlpha(1)

    # SNP dots on rings
    import random
    random.seed(42)
    for ring_r in [68, 114, 162, 210]:
        n = int(ring_r / 17)
        for _ in range(n):
            angle = random.uniform(0, 2 * math.pi)
            dx = cx_r + ring_r * math.cos(angle)
            dy = cy_r + ring_r * math.sin(angle)
            if 10 < dx < W - 10 and 30 < dy < H - 30:
                alpha = random.uniform(0.15, 0.40)
                c.setFillColor(GOLD)
                c.setFillAlpha(alpha)
                c.circle(dx, dy, 2, fill=1, stroke=0)
    c.setFillAlpha(1)

    corner_marks(c, alpha=0.18, sz=36, mg=24)

    # Gold top bar
    c.setFillColor(GOLD)
    c.rect(0, H - 1.5, W, 1.5, fill=1, stroke=0)

    # 1. LOGO + PACKAGE
    c.setFont("Gloock", 12)
    c.setFillColor(GOLD)
    c.setFillAlpha(0.75)
    c.drawString(ML, H - 44, "HelixIQ")
    c.setFillAlpha(1)
    label_caps(c, "Nutrition and Supplements", ML, H - 62, GOLD, 0.45)
    gold_rule(c, H - 70, alpha=0.14, x2=ML + 260)

    # 2. HEADLINE
    hs = H - 108
    lg = 54
    c.setFont("Gloock", 46)
    c.setFillColor(PAPER)
    c.drawString(ML, hs,        "Your genome has")
    c.drawString(ML, hs - lg,   "a few things to")
    c.setFont("LoraItalic", 46)
    c.setFillColor(GOLD)
    c.drawString(ML, hs - lg*2, "say about you.")
    gold_rule(c, hs - lg*2 - 18, alpha=0.16, x2=ML + 310)

    # 3. STATS ROW
    stat_y = hs - lg*2 - 46
    stats = [
        ("10",    "pages of personalized", "genetic intelligence"),
        ("700k+", "SNP variants",          "analyzed"),
        ("6",     "genome-specific",       "supplement recommendations"),
    ]
    col_w = CW / 3
    for i, (num, l1, l2) in enumerate(stats):
        sx = ML + i * col_w
        if i > 0:
            c.setFillColor(GOLD)
            c.setFillAlpha(0.12)
            c.rect(sx - 10, stat_y - 36, 1, 50, fill=1, stroke=0)
            c.setFillAlpha(1)
        c.setFont("Gloock", 30)
        c.setFillColor(GOLD)
        c.setFillAlpha(0.9)
        c.drawString(sx, stat_y, num)
        c.setFillAlpha(1)
        c.setFont("Instrument", 8.5)
        c.setFillColor(PAPER)
        c.setFillAlpha(0.40)
        c.drawString(sx, stat_y - 18, l1)
        c.drawString(sx, stat_y - 31, l2)
        c.setFillAlpha(1)

    gold_rule(c, stat_y - 50, alpha=0.14)

    # 4. INTRO PARAGRAPH
    intro_y = stat_y - 68
    intro = "Your genome contains over 700,000 data points. Most DNA services show you fewer than 50. This report translates the raw variants that actually shape how you absorb nutrients, process supplements, and respond to food."
    intro_lines = wrap(c, intro, "CrimsonItalic", 12, CW * 0.65)
    c.setFont("CrimsonItalic", 12)
    c.setFillColor(PAPER)
    c.setFillAlpha(0.50)
    for i, ln in enumerate(intro_lines):
        c.drawString(ML, intro_y - i * 17, ln)
    c.setFillAlpha(1)

    gold_rule(c, intro_y - len(intro_lines) * 17 - 16, alpha=0.10)

    # 5. WHAT IS INSIDE — compact 4-column row, no boxes, just icons + text
    # Fixed height, snug, sitting naturally above footer
    row_y = intro_y - len(intro_lines) * 17 - 42
    card_w = (CW - 12) / 4
    gap    = 4

    card_items = [
        (GREEN_T,  "5",    "icon_five",  "Genetic Advantages",  "Top 5 strengths with rarity ratings"),
        (AMBER_T,  "5",    "icon_five",  "Areas to Address",    "Top 5 risks with severity tags"),
        (BLUE_T,   "pill", "icon_pill",  "Supplement Stack",    "Genome protocol with shopping guide"),
        (GOLD,     "tgt",  "icon_target","Dietary Blueprint",   "Optimal pattern with food targets"),
    ]

    item_h = 72   # compact fixed height

    for i, (fg, _, icon_type, title, sub) in enumerate(card_items):
        ix = ML + i * (card_w + gap)
        iy = row_y  # top of item

        # No background box — just a subtle left rule
        c.setFillColor(fg)
        c.setFillAlpha(0.55)
        c.rect(ix, iy - item_h + 6, 2, item_h - 6, fill=1, stroke=0)
        c.setFillAlpha(1)

        # Icon drawn inline at top-left of item
        icon_x = ix + 12
        icon_y = iy - 16

        if icon_type == "icon_five":
            # Large ghost "5" — the icon IS the number
            c.setFont("Gloock", 32)
            c.setFillColor(fg)
            c.setFillAlpha(0.22)
            c.drawString(icon_x, icon_y - 10, "5")
            c.setFillAlpha(1)
            # Small solid "5" on top
            c.setFont("Gloock", 18)
            c.setFillColor(fg)
            c.drawString(icon_x + 1, icon_y - 6, "5")

        elif icon_type == "icon_pill":
            # Pill — anchored same top as the "5" glyph
            pw, ph = 26, 13
            px  = icon_x
            py2 = icon_y - 2   # align top with "5" glyph top
            c.setFillColor(fg)
            c.setFillAlpha(0.18)
            c.roundRect(px, py2, pw, ph, ph/2, fill=1, stroke=0)
            c.setFillAlpha(1)
            c.setStrokeColor(fg)
            c.setStrokeAlpha(0.72)
            c.setLineWidth(1.2)
            c.roundRect(px, py2, pw, ph, ph/2, fill=0, stroke=1)
            c.setStrokeAlpha(0.35)
            c.setLineWidth(0.7)
            c.line(px + pw/2, py2 + 2, px + pw/2, py2 + ph - 2)
            c.setStrokeAlpha(1)

        elif icon_type == "icon_target":
            # Target — center aligned with "5" glyph midpoint
            tcx = icon_x + 12
            tcy = icon_y - 2    # same vertical band as "5"
            for r, a in [(12, 0.13), (8, 0.20), (4, 0.52)]:
                c.setFillColor(fg)
                c.setFillAlpha(a)
                c.circle(tcx, tcy, r, fill=1, stroke=0)
            c.setFillAlpha(1)
            c.setStrokeColor(fg)
            c.setStrokeAlpha(0.22)
            c.setLineWidth(0.5)
            c.line(tcx - 14, tcy, tcx + 14, tcy)
            c.line(tcx, tcy - 14, tcx, tcy + 14)
            c.setStrokeAlpha(1)

        # Title — bold, left aligned after icon
        c.setFont("InstrumentB", 9)
        c.setFillColor(PAPER)
        c.setFillAlpha(0.88)
        c.drawString(ix + 10, iy - item_h + 36, title)
        c.setFillAlpha(1)

        # Sub — muted, wrapped
        sub_lines = wrap(c, sub, "Instrument", 7.5, card_w - 14)
        c.setFont("Instrument", 7.5)
        c.setFillColor(fg)
        c.setFillAlpha(0.55)
        for j, sl in enumerate(sub_lines[:2]):
            c.drawString(ix + 10, iy - item_h + 22 - j * 11, sl)
        c.setFillAlpha(1)

    # Footer
    gold_rule(c, row_y - item_h - 10, alpha=0.10)
    c.setFont("Instrument", 8)
    c.setFillColor(PAPER)
    c.setFillAlpha(0.20)
    c.drawString(ML, row_y - item_h - 26, "Prepared for Stephen   .   March 24, 2026   .   myhelixiq.com")
    c.setFillAlpha(1)

def cover_C(c):
    """Concept C: The Archive — editorial magazine, bold split composition"""
    full_bleed(c, INK)

    # Bottom half lighter dark
    c.setFillColor(HexColor("#0d0d16"))
    c.rect(0, 0, W, H * 0.42, fill=1, stroke=0)

    # Gold horizontal divider
    c.setFillColor(GOLD)
    c.rect(0, H * 0.42, W, 1.5, fill=1, stroke=0)

    # Large ghost initial "S" in background
    c.setFont("Gloock", 380)
    c.setFillColor(GOLD)
    c.setFillAlpha(0.028)
    c.drawString(-20, -40, "S")
    c.setFillAlpha(1)

    corner_marks(c, alpha=0.2, sz=36, mg=24)

    # Top section: logo and package
    c.setFont("Gloock", 12)
    c.setFillColor(GOLD)
    c.setFillAlpha(0.8)
    c.drawString(ML, H - 46, "HelixIQ")
    c.setFillAlpha(1)
    label_caps(c, "Nutrition and Supplements Report", W - MR - 200, H - 43, PAPER, 0.35)

    gold_rule(c, H - 56, alpha=0.18)

    # Main headline area
    c.setFont("Gloock", 52)
    c.setFillColor(PAPER)
    c.drawString(ML, H * 0.80, "What lives")
    c.drawString(ML, H * 0.80 - 60, "inside your")
    c.setFillColor(GOLD)
    c.drawString(ML, H * 0.80 - 120, "data.")

    # Right side: elegant vertical text label
    c.saveState()
    c.translate(W - MR - 12, H * 0.68)
    c.rotate(270)
    label_caps(c, "Personalized Genomic Intelligence", 0, 0, PAPER, 0.2)
    c.restoreState()

    # Bottom section: intro text
    intro = "Your genome carries instructions you have never seen. This report surfaces the findings most relevant to how you eat, supplement, and live."
    put_text(c, intro, ML, H * 0.36,
             "CrimsonItalic", 13, PAPER, alpha=0.6, max_w=CW * 0.85, lh=19)

    # Date and name
    c.setFont("Instrument", 9)
    c.setFillColor(GOLD)
    c.setFillAlpha(0.55)
    c.drawString(ML, H * 0.36 - 64, "March 24, 2026")
    c.setFillAlpha(1)

    page_footer(c)


# ─────────────────────────────────────────────────────────
# PAGE: TOP 5 WINS
# ─────────────────────────────────────────────────────────

RARITY_STYLE = {
    "Very Common":  (HexColor("#141414"), MUTED,    "COMMON"),
    "Common":       (HexColor("#141414"), MUTED,    "COMMON"),
    "Uncommon":     (BLUE_BG,            BLUE_T,   "UNCOMMON"),
    "Rare":         (PURPLE_BG,          PURPLE_T, "RARE"),
    "Very Rare":    (PURPLE_BG,          PURPLE_T, "VERY RARE"),
}

SEVERITY_STYLE = {
    "High Priority": (RED_BG,    RED_T,   "HIGH PRIORITY"),
    "Moderate":      (AMBER_BG,  AMBER_T, "MODERATE"),
    "Worth Watching":(ACCENT,    GOLD,    "WORTH WATCHING"),
    "Lifestyle Focus":(GREEN_BG, GREEN_T, "LIFESTYLE"),
}

def page_wins(c):
    full_bleed(c, INK)
    corner_marks(c, alpha=0.12)

    # Header band
    c.setFillColor(GREEN_BG)
    c.rect(0, H - 80, W, 80, fill=1, stroke=0)
    c.setFillColor(GREEN)
    c.rect(0, H - 81, W, 2, fill=1, stroke=0)

    label_caps(c, "01   Your Genetic Advantages", ML, H - 28, GREEN_T)
    c.setFont("Gloock", 28)
    c.setFillColor(PAPER)
    c.drawString(ML, H - 62, "Top 5 Things Working in Your Favor")

    gold_rule(c, H - 90, alpha=0.1)

    card_h = 116
    gap    = 6
    y      = H - 96

    for i, win in enumerate(WINS):
        c.setFillColor(HexColor("#0c0c14"))
        c.roundRect(ML, y - card_h, CW, card_h, 5, fill=1, stroke=0)
        c.setFillColor(GREEN)
        c.roundRect(ML, y - card_h, 3, card_h, 2, fill=1, stroke=0)

        # Ghost index number — far right, won't overlap text
        c.setFont("Gloock", 26)
        c.setFillColor(GREEN_T)
        c.setFillAlpha(0.09)
        c.drawString(W - MR - 26, y - 36, str(i + 1))
        c.setFillAlpha(1)

        # Tag row — gene pill + rarity pill + rarity note
        rar = win["rarity"]
        rb, rf, rl = RARITY_STYLE.get(rar, RARITY_STYLE["Common"])
        tag_x = ML + 14
        tag_y = y - 18          # top of tag row
        pill(c, tag_x, tag_y - 12, win["gene"], HexColor("#0d2a1a"), GREEN_T, "Mono", 8)
        gw = c.stringWidth(win["gene"], "Mono", 8) + 28
        pill(c, tag_x + gw, tag_y - 12, rl, rb, rf)
        rarity_note = win.get("rarity_pct", "")
        if rarity_note:
            rw = c.stringWidth(rl, "InstrumentB", 7) + 22
            c.setFont("Instrument", 7.5)
            c.setFillColor(MUTED)
            c.drawString(tag_x + gw + rw, tag_y - 9, rarity_note)

        # Title — 22pt below tag row top
        c.setFont("LoraBold", 12.5)
        c.setFillColor(PAPER)
        c.drawString(ML + 14, y - 42, win["title"])

        # Insight — 16pt below title baseline, 2 lines max
        insight_lines = wrap(c, win["insight"], "Instrument", 9, CW - 36)
        c.setFont("Instrument", 9)
        c.setFillColor(PAPER)
        c.setFillAlpha(0.56)
        for j, ln in enumerate(insight_lines[:2]):
            c.drawString(ML + 14, y - 60 - j * 13, ln)
        c.setFillAlpha(1)

        # Action — pinned to 14pt above card bottom
        action_lines = wrap(c, win["action"], "InstrumentB", 9, CW - 36)
        c.setFont("InstrumentB", 9)
        c.setFillColor(GREEN_T)
        c.drawString(ML + 14, y - card_h + 14, "> " + (action_lines[0] if action_lines else ""))

        y -= card_h + gap

    page_footer(c)


# ─────────────────────────────────────────────────────────
# PAGE: TOP 5 RISKS
# ─────────────────────────────────────────────────────────

def page_risks(c):
    full_bleed(c, INK)
    corner_marks(c, alpha=0.12)

    c.setFillColor(AMBER_BG)
    c.rect(0, H - 80, W, 80, fill=1, stroke=0)
    c.setFillColor(AMBER)
    c.rect(0, H - 81, W, 2, fill=1, stroke=0)

    label_caps(c, "02   Areas Worth Your Focus", ML, H - 28, AMBER_T)
    c.setFont("Gloock", 28)
    c.setFillColor(PAPER)
    c.drawString(ML, H - 62, "Top 5 Things to Address")

    c.setFont("CrimsonItalic", 11)
    c.setFillColor(AMBER_T)
    c.setFillAlpha(0.6)
    c.drawString(ML, H - 88, "Not predictions. Places where small, deliberate changes produce outsized results.")
    c.setFillAlpha(1)
    gold_rule(c, H - 96, alpha=0.1)

    card_h = 114
    gap    = 6
    y      = H - 108

    for i, risk in enumerate(RISKS):
        c.setFillColor(HexColor("#120c0a"))
        c.roundRect(ML, y - card_h, CW, card_h, 5, fill=1, stroke=0)
        c.setFillColor(AMBER)
        c.roundRect(ML, y - card_h, 3, card_h, 2, fill=1, stroke=0)

        # Ghost number
        c.setFont("Gloock", 26)
        c.setFillColor(AMBER_T)
        c.setFillAlpha(0.09)
        c.drawString(W - MR - 26, y - 36, str(i + 1))
        c.setFillAlpha(1)

        # Tags row — gene + severity + rarity, all on one line
        sev = risk["severity"]
        sb, sf, sl = SEVERITY_STYLE.get(sev, SEVERITY_STYLE["Moderate"])
        rar = risk["rarity"]
        rb, rf, rl = RARITY_STYLE.get(rar, RARITY_STYLE["Common"])

        tag_x = ML + 14
        tag_y = y - 18
        pill(c, tag_x, tag_y - 12, risk["gene"], AMBER_BG, AMBER_T, "Mono", 8)
        gw = c.stringWidth(risk["gene"], "Mono", 8) + 28
        sev_w = pill(c, tag_x + gw, tag_y - 12, sl, sb, sf)
        rar_w = pill(c, tag_x + gw + sev_w, tag_y - 12, rl, rb, rf)
        rarity_note = risk.get("rarity_pct", "")
        if rarity_note:
            used = tag_x + gw + sev_w + rar_w
            if used + c.stringWidth(rarity_note, "Instrument", 7.5) < W - MR - 20:
                c.setFont("Instrument", 7.5)
                c.setFillColor(MUTED)
                c.drawString(used, tag_y - 9, rarity_note)

        # Title — 22pt below tag row top, clear of pills
        c.setFont("LoraBold", 12.5)
        c.setFillColor(PAPER)
        c.drawString(ML + 14, y - 42, risk["title"])

        # Insight — 16pt below title, 2 lines
        insight_lines = wrap(c, risk["insight"], "Instrument", 9, CW - 36)
        c.setFont("Instrument", 9)
        c.setFillColor(PAPER)
        c.setFillAlpha(0.56)
        for j, ln in enumerate(insight_lines[:2]):
            c.drawString(ML + 14, y - 60 - j * 13, ln)
        c.setFillAlpha(1)

        # Action — pinned 14pt above card bottom
        c.setFont("InstrumentB", 9)
        c.setFillColor(AMBER_T)
        al = wrap(c, risk["action"], "InstrumentB", 9, CW - 36)
        c.drawString(ML + 14, y - card_h + 14, "> " + (al[0] if al else ""))

        y -= card_h + gap

    page_footer(c)


# ─────────────────────────────────────────────────────────
# PAGE: SUPPLEMENT STACK
# ─────────────────────────────────────────────────────────

def page_supplements(c):
    full_bleed(c, INK)
    corner_marks(c, alpha=0.12)

    c.setFillColor(ACCENT)
    c.rect(0, H - 78, W, 78, fill=1, stroke=0)
    gold_rule(c, H - 78, alpha=0.3)

    label_caps(c, "03   Your Protocol", ML, H - 26)
    c.setFont("Gloock", 26)
    c.setFillColor(PAPER)
    c.drawString(ML, H - 58, "Genome-Based Supplement Stack")

    # Legend for dots
    legend_x = W - MR - 148
    c.setFont("Instrument", 8)
    c.setFillColor(PAPER)
    c.setFillAlpha(0.35)
    c.drawString(legend_x, H - 30, "Priority:  ●●●  Essential   ●●  Recommended")
    c.setFillAlpha(1)

    gold_rule(c, H - 86, alpha=0.1)

    y = H - 100
    row_h = 98

    for i, s in enumerate(SUPPLEMENTS):
        bg = HexColor("#0d0d16") if i % 2 == 0 else HexColor("#0a0a12")
        c.setFillColor(bg)
        c.roundRect(ML, y - row_h, CW, row_h, 4, fill=1, stroke=0)

        # Priority dots
        dots = s["priority"]
        for d in range(3):
            c.setFillColor(GOLD if d < dots else HexColor("#2a2a2a"))
            c.circle(ML + 14 + d * 11, y - 18, 3.8, fill=1, stroke=0)

        # Row layout (top to bottom inside card):
        # y-14  : name (bold)
        # y-28  : dose (mono gold)
        # y-42  : grey "why" text (1-2 lines, 13pt apart)
        # y-?   : green "form" badge
        # y-?   : red "warning" badge
        # All pinned relative to card top (y), spaced 13pt

        # Name
        c.setFont("LoraBold", 13)
        c.setFillColor(PAPER)
        c.drawString(ML + 54, y - 16, s["name"])

        # Dose
        c.setFont("Mono", 8)
        c.setFillColor(GOLD)
        c.setFillAlpha(0.85)
        c.drawString(ML + 54, y - 30, s["dose"])
        c.setFillAlpha(1)

        # Why text (grey) — right under dose
        why_lines = wrap(c, s["why"], "Instrument", 8, CW - 72)
        c.setFont("Instrument", 8)
        c.setFillColor(PAPER)
        c.setFillAlpha(0.42)
        for j, ln in enumerate(why_lines[:2]):
            c.drawString(ML + 54, y - 44 - j * 12, ln)
        c.setFillAlpha(1)
        why_bottom = y - 44 - (min(len(why_lines), 2) - 1) * 12

        # Green form badge — 8pt below why text
        form_text = s["form"]
        form_w = min(c.stringWidth(form_text, "Instrument", 8.5) + 16, CW - 68)
        green_y = why_bottom - 18
        c.setFillColor(GREEN_BG)
        c.roundRect(ML + 54, green_y, form_w, 15, 3, fill=1, stroke=0)
        c.setStrokeColor(GREEN)
        c.setStrokeAlpha(0.35)
        c.setLineWidth(0.5)
        c.roundRect(ML + 54, green_y, form_w, 15, 3, fill=0, stroke=1)
        c.setStrokeAlpha(1)
        c.setFont("Instrument", 8.5)
        c.setFillColor(GREEN_T)
        c.drawString(ML + 62, green_y + 4, form_text[:60])

        # Red warning badge — 8pt below green badge
        warn_lines = wrap(c, s["warning"], "Instrument", 8, CW - 72)
        warn_text = warn_lines[0] if warn_lines else ""
        warn_w = min(c.stringWidth(warn_text, "Instrument", 8) + 28, CW - 68)
        red_y = green_y - 22
        c.setFillColor(RED_BG)
        c.roundRect(ML + 54, red_y, warn_w, 15, 3, fill=1, stroke=0)
        c.setStrokeColor(RED)
        c.setStrokeAlpha(0.3)
        c.setLineWidth(0.5)
        c.roundRect(ML + 54, red_y, warn_w, 15, 3, fill=0, stroke=1)
        c.setStrokeAlpha(1)
        c.setFont("InstrumentB", 8)
        c.setFillColor(RED_T)
        c.drawString(ML + 62, red_y + 4, "!")
        c.setFont("Instrument", 8)
        c.drawString(ML + 74, red_y + 4, warn_text[:70])

        gold_rule(c, y - row_h, alpha=0.06)
        y -= row_h

    page_footer(c)


# ─────────────────────────────────────────────────────────
# PAGE: SUPPLEMENT SHOPPING GUIDE
# ─────────────────────────────────────────────────────────

def page_shopping(c):
    full_bleed(c, INK)
    corner_marks(c, alpha=0.12)

    c.setFillColor(HexColor("#0a1010"))
    c.rect(0, H - 78, W, 78, fill=1, stroke=0)
    c.setFillColor(GREEN)
    c.rect(0, H - 79, W, 1.5, fill=1, stroke=0)

    label_caps(c, "04   Buyer's Guide", ML, H - 26, GREEN_T)
    c.setFont("Gloock", 26)
    c.setFillColor(PAPER)
    c.drawString(ML, H - 58, "How to Shop Without Getting Scammed")

    c.setFont("CrimsonItalic", 11.5)
    c.setFillColor(PAPER)
    c.setFillAlpha(0.45)
    c.drawString(ML, H - 88,
                 "The supplement industry is largely unregulated. What the label says and what is in the bottle are often different things.")
    c.setFillAlpha(1)
    gold_rule(c, H - 96, alpha=0.1)

    y = H - 114
    card_h = 120

    for i, tip in enumerate(SHOPPING_TIPS):
        c.setFillColor(HexColor("#0c0c14"))
        c.roundRect(ML, y - card_h, CW, card_h, 5, fill=1, stroke=0)

        # Icon circle
        ic = tip["icon_color"]
        ib = tip["icon_bg"]
        c.setFillColor(ib)
        c.circle(ML + 34, y - card_h // 2, 26, fill=1, stroke=0)
        c.setStrokeColor(ic)
        c.setStrokeAlpha(0.4)
        c.setLineWidth(1)
        c.circle(ML + 34, y - card_h // 2, 26, fill=0, stroke=1)
        c.setStrokeAlpha(1)
        # Number — centered in circle using string width and font metrics
        num_str = str(i + 1)
        c.setFont("Gloock", 20)
        c.setFillColor(ic)
        nw = c.stringWidth(num_str, "Gloock", 20)
        circle_cx = ML + 34
        circle_cy = y - card_h // 2
        # Gloock 20pt: cap height ~14pt, so vertically center by offsetting -7
        c.drawString(circle_cx - nw/2, circle_cy - 7, num_str)

        # Accent stripe
        c.setFillColor(ic)
        c.setFillAlpha(0.6)
        c.roundRect(ML, y - card_h, 3, card_h, 2, fill=1, stroke=0)
        c.setFillAlpha(1)

        # Flag (title)
        c.setFont("LoraBold", 13)
        c.setFillColor(PAPER)
        c.drawString(ML + 72, y - 28, tip["flag"])

        # Body
        body_lines = wrap(c, tip["body"], "Crimson", 11.5, CW - 86)
        c.setFont("Crimson", 11.5)
        c.setFillColor(PAPER)
        c.setFillAlpha(0.68)
        for j, ln in enumerate(body_lines[:4]):
            c.drawString(ML + 72, y - 46 - j * 15, ln)
        c.setFillAlpha(1)

        y -= card_h + 8

    # Certifications note
    gold_rule(c, y - 10, alpha=0.1)
    c.setFont("InstrumentB", 8)
    c.setFillColor(GOLD)
    c.setFillAlpha(0.6)
    c.drawString(ML, y - 24, "Certification seals to look for:")
    c.setFillAlpha(1)
    seals = ["NSF Certified", "USP Verified", "Informed Sport", "ConsumerLab"]
    sx = ML
    for seal in seals:
        sw = c.stringWidth(seal, "InstrumentB", 8) + 20
        c.setFillColor(ACCENT)
        c.roundRect(sx, y - 48, sw, 18, 3, fill=1, stroke=0)
        c.setFont("InstrumentB", 8)
        c.setFillColor(GOLD)
        c.drawString(sx + 10, y - 40, seal)
        sx += sw + 8

    page_footer(c)


# ─────────────────────────────────────────────────────────
# PAGE: DIET BLUEPRINT
# ─────────────────────────────────────────────────────────

def page_diet(c):
    full_bleed(c, INK)
    corner_marks(c, alpha=0.12)

    c.setFillColor(HexColor("#0c160c"))
    c.rect(0, H - 78, W, 78, fill=1, stroke=0)
    c.setFillColor(GREEN)
    c.rect(0, H - 79, W, 1.5, fill=1, stroke=0)

    # Header band is H-78 to H. Green line at H-79.
    # Everything below must start at H-78 or lower.
    label_caps(c, "05   Dietary Blueprint", ML, H - 26, GREEN_T)
    c.setFont("Gloock", 26)
    c.setFillColor(PAPER)
    c.drawString(ML, H - 58, "Your Optimal Eating Pattern")

    # Rule and badge sit BELOW the green header band (which ends at H-78)
    gold_rule(c, H - 88, alpha=0.15)

    # Badge: top at H-108, height 24 => occupies H-132 to H-108, well clear of H-79
    badge_top = H - 108
    badge_h   = 24
    c.setFillColor(ACCENT)
    c.roundRect(ML, badge_top, 220, badge_h, 4, fill=1, stroke=0)
    c.setFillColor(GOLD)
    c.roundRect(ML, badge_top, 3, badge_h, 2, fill=1, stroke=0)
    # "Recommended pattern" label inside badge
    c.setFont("Instrument", 8.5)
    c.setFillColor(PAPER)
    c.setFillAlpha(0.48)
    c.drawString(ML + 12, badge_top + 8, "Recommended pattern")
    c.setFillAlpha(1)
    # "Mediterranean" inside same badge
    c.setFont("Gloock", 14)
    c.setFillColor(GOLD)
    rp_w = c.stringWidth("Recommended pattern", "Instrument", 8.5)
    c.drawString(ML + 12 + rp_w + 8, badge_top + 7, "Mediterranean")

    # ── 5 food cards in a 3+2 layout ──
    cw3 = (CW - 16) / 3
    row1_y = H - 140

    for i in range(3):
        sec = DIET_SECTIONS[i]
        card_top = row1_y
        card_h   = 150
        cx_card  = ML + i * (cw3 + 8)

        c.setFillColor(sec["bg"])
        c.roundRect(cx_card, card_top - card_h, cw3, card_h, 5, fill=1, stroke=0)
        c.setStrokeColor(sec["color"])
        c.setStrokeAlpha(0.25)
        c.setLineWidth(0.6)
        c.roundRect(cx_card, card_top - card_h, cw3, card_h, 5, fill=0, stroke=1)
        c.setStrokeAlpha(1)

        # Icon
        icon_cx = cx_card + cw3 / 2
        icon_cy = card_top - 30
        c.setFillColor(sec["bg"])
        c.circle(icon_cx, icon_cy, 20, fill=1, stroke=0)
        draw_icon(c, sec["icon"], icon_cx, icon_cy, 11, sec["color"])

        # Title
        c.setFont("LoraBold", 11)
        c.setFillColor(PAPER)
        tw = c.stringWidth(sec["title"], "LoraBold", 11)
        c.drawString(cx_card + (cw3 - tw) / 2, card_top - 58, sec["title"])

        # Sub
        c.setFont("InstrumentB", 8)
        c.setFillColor(sec["color"])
        sw = c.stringWidth(sec["sub"], "InstrumentB", 8)
        c.drawString(cx_card + (cw3 - sw) / 2, card_top - 72, sec["sub"])

        # Body — wrapped tight
        body_lines = wrap(c, sec["body"], "Instrument", 8, cw3 - 18)
        c.setFont("Instrument", 8)
        c.setFillColor(PAPER)
        c.setFillAlpha(0.6)
        for j, ln in enumerate(body_lines[:5]):
            c.drawString(cx_card + 9, card_top - 88 - j * 12, ln)
        c.setFillAlpha(1)

    # Row 2: 2 wider cards
    cw2   = (CW - 8) / 2
    row2_y = row1_y - 158

    for i in range(2):
        sec      = DIET_SECTIONS[3 + i]
        card_h   = 148
        cx_card  = ML + i * (cw2 + 8)

        c.setFillColor(sec["bg"])
        c.roundRect(cx_card, row2_y - card_h, cw2, card_h, 5, fill=1, stroke=0)
        c.setStrokeColor(sec["color"])
        c.setStrokeAlpha(0.22)
        c.setLineWidth(0.6)
        c.roundRect(cx_card, row2_y - card_h, cw2, card_h, 5, fill=0, stroke=1)
        c.setStrokeAlpha(1)

        # Icon left-aligned
        icon_cx = cx_card + 28
        icon_cy = row2_y - 32
        c.setFillColor(sec["bg"])
        c.circle(icon_cx, icon_cy, 20, fill=1, stroke=0)
        draw_icon(c, sec["icon"], icon_cx, icon_cy, 11, sec["color"])

        # Title + sub
        c.setFont("LoraBold", 12)
        c.setFillColor(PAPER)
        c.drawString(cx_card + 58, row2_y - 24, sec["title"])
        c.setFont("InstrumentB", 8)
        c.setFillColor(sec["color"])
        c.drawString(cx_card + 58, row2_y - 38, sec["sub"])

        # Body — wider card, more room
        body_lines = wrap(c, sec["body"], "Instrument", 8.5, cw2 - 24)
        c.setFont("Instrument", 8.5)
        c.setFillColor(PAPER)
        c.setFillAlpha(0.6)
        for j, ln in enumerate(body_lines[:5]):
            c.drawString(cx_card + 14, row2_y - 56 - j * 13, ln)
        c.setFillAlpha(1)

    # Do Less strip at bottom
    strip_y = row2_y - card_h - 12
    strip_h = 72
    c.setFillColor(AMBER_BG)
    c.roundRect(ML, strip_y - strip_h, CW, strip_h, 4, fill=1, stroke=0)
    c.setFillColor(AMBER)
    c.roundRect(ML, strip_y - strip_h, 3, strip_h, 2, fill=1, stroke=0)
    label_caps(c, "Reduce These", ML + 14, strip_y - 16, AMBER_T)
    col_w = (CW - 28) / 3
    for i, (title, body) in enumerate(DO_LESS):
        cx2 = ML + 14 + i * (col_w + 4)
        c.setFont("InstrumentB", 9)
        c.setFillColor(AMBER_T)
        c.drawString(cx2, strip_y - 30, title)
        body_l = wrap(c, body, "Instrument", 7.5, col_w - 4)
        c.setFont("Instrument", 7.5)
        c.setFillColor(PAPER)
        c.setFillAlpha(0.5)
        for j, ln in enumerate(body_l[:2]):
            c.drawString(cx2, strip_y - 42 - j * 11, ln)
        c.setFillAlpha(1)

    page_footer(c)


# ─────────────────────────────────────────────────────────
# PAGE: FOR YOUR LOVED ONES
# ─────────────────────────────────────────────────────────

def page_family(c):
    full_bleed(c, INK)
    corner_marks(c, alpha=0.12)

    c.setFillColor(ACCENT)
    c.rect(0, H - 78, W, 78, fill=1, stroke=0)
    gold_rule(c, H - 78, alpha=0.3)

    label_caps(c, "06   The People in Your Life", ML, H - 26)
    c.setFont("Gloock", 26)
    c.setFillColor(PAPER)
    c.drawString(ML, H - 58, "What Your Loved Ones Should Know")
    gold_rule(c, H - 86, alpha=0.1)

    # Partner card — auto-sized to text
    partner_lines = wrap(c, FAMILY["partner"], "Crimson", 12, CW - 32)
    partner_h = len(partner_lines) * 18 + 80
    py = H - 106

    c.setFillColor(ACCENT)
    c.roundRect(ML, py - partner_h, CW, partner_h, 6, fill=1, stroke=0)
    c.setFillColor(GOLD)
    c.roundRect(ML, py - partner_h, 3, partner_h, 2, fill=1, stroke=0)

    # Title — large Gloock, no p decoration
    c.setFont("Gloock", 22)
    c.setFillColor(GOLD)
    c.drawString(ML + 14, py - 26, "For Your Partner")
    gold_rule(c, py - 34, alpha=0.2, x1=ML + 14, x2=ML + 222)

    c.setFont("Crimson", 12)
    c.setFillColor(PAPER)
    c.setFillAlpha(0.82)
    for j, ln in enumerate(partner_lines):
        c.drawString(ML + 14, py - 52 - j * 18, ln)
    c.setFillAlpha(1)

    # Children card — auto-sized to text
    child_lines = wrap(c, FAMILY["children"], "Crimson", 12, CW - 32)
    child_h = len(child_lines) * 18 + 80
    cy2 = py - partner_h - 16

    c.setFillColor(HexColor("#10101c"))
    c.roundRect(ML, cy2 - child_h, CW, child_h, 6, fill=1, stroke=0)
    c.setFillColor(PURPLE)
    c.roundRect(ML, cy2 - child_h, 3, child_h, 2, fill=1, stroke=0)

    # Title — large Gloock, no decoration
    c.setFont("Gloock", 22)
    c.setFillColor(PURPLE_T)
    c.drawString(ML + 14, cy2 - 26, "For Your Children")
    gold_rule(c, cy2 - 34, alpha=0.18, x1=ML + 14, x2=ML + 230)

    c.setFont("Crimson", 12)
    c.setFillColor(PAPER)
    c.setFillAlpha(0.78)
    for j, ln in enumerate(child_lines):
        c.drawString(ML + 14, cy2 - 52 - j * 18, ln)
    c.setFillAlpha(1)

    page_footer(c)


# ─────────────────────────────────────────────────────────
# PAGE: ACTION PLAN
# ─────────────────────────────────────────────────────────

def page_actions(c):
    full_bleed(c, INK)
    corner_marks(c, alpha=0.12)

    c.setFillColor(ACCENT)
    c.rect(0, H - 78, W, 78, fill=1, stroke=0)
    c.setFillColor(GOLD)
    c.rect(0, H - 79, W, 1.5, fill=1, stroke=0)

    label_caps(c, "07   Your Roadmap", ML, H - 26)
    c.setFont("Gloock", 26)
    c.setFillColor(PAPER)
    c.drawString(ML, H - 58, "5 Actions. Start With Number One.")

    c.setFont("CrimsonItalic", 11.5)
    c.setFillColor(GOLD)
    c.setFillAlpha(0.5)
    c.drawString(ML, H - 94, "One step at a time. These are yours to keep.")
    c.setFillAlpha(1)
    gold_rule(c, H - 106, alpha=0.1)

    y = H - 122
    for i, action in enumerate(ACTIONS):
        action_lines = wrap(c, action, "Lora", 12.5, CW - 56)
        h_needed = max(64, 22 + len(action_lines) * 17 + 16)

        c.setFillColor(HexColor("#0c0c14"))
        c.roundRect(ML, y - h_needed, CW, h_needed, 4, fill=1, stroke=0)

        # Big ghost number
        c.setFont("Gloock", 56)
        c.setFillColor(GOLD)
        c.setFillAlpha(0.06)
        c.drawString(W - MR - 42, y - h_needed + 4, str(i + 1))
        c.setFillAlpha(1)

        # Bold number
        c.setFont("Gloock", 22)
        c.setFillColor(GOLD)
        c.drawString(ML + 12, y - 28, str(i + 1))

        # Vertical rule after number
        c.setFillColor(GOLD)
        c.setFillAlpha(0.18)
        c.rect(ML + 36, y - h_needed + 10, 1, h_needed - 20, fill=1, stroke=0)
        c.setFillAlpha(1)

        # Action text
        c.setFont("Lora", 12.5)
        c.setFillColor(PAPER)
        for j, ln in enumerate(action_lines):
            c.drawString(ML + 48, y - 18 - j * 17, ln)

        y -= h_needed + 8

    page_footer(c)


# ─────────────────────────────────────────────────────────
# PAGE: KEY VARIANTS
# ─────────────────────────────────────────────────────────

STATUS_COLORS = {
    "Protective": (HexColor("#081a0f"), GREEN_T),
    "Monitor":    (AMBER_BG,           AMBER_T),
    "Typical":    (HexColor("#0d0d14"), HexColor("#6a6a8a")),
}

def page_variants(c):
    full_bleed(c, INK)
    corner_marks(c, alpha=0.12)

    c.setFillColor(HexColor("#0a0f0a"))
    c.rect(0, H - 78, W, 78, fill=1, stroke=0)
    gold_rule(c, H - 78, alpha=0.3)

    label_caps(c, "08   Variant Reference", ML, H - 26)
    c.setFont("Gloock", 26)
    c.setFillColor(PAPER)
    c.drawString(ML, H - 58, "Your Key Variants at a Glance")
    gold_rule(c, H - 86, alpha=0.1)

    # Header row
    hy = H - 100
    c.setFillColor(ACCENT)
    c.rect(ML - 6, hy - 8, CW + 12, 26, fill=1, stroke=0)

    cols = [ML, ML + 76, ML + 164, ML + 218, ML + 304]
    hdrs = ["Gene", "Variant", "Genotype", "Status", "What It Means"]
    for hx, ht in zip(cols, hdrs):
        label_caps(c, ht, hx + 4, hy + 4)

    row_y = hy - 18
    row_h = 32

    for i, v in enumerate(VARIANTS):
        bg = HexColor("#0d0d16") if i % 2 == 0 else INK
        c.setFillColor(bg)
        c.rect(ML - 6, row_y - row_h + 4, CW + 12, row_h, fill=1, stroke=0)

        # Status color for left stripe
        sb, sf = STATUS_COLORS.get(v["status"], STATUS_COLORS["Typical"])
        c.setFillColor(sf)
        c.setFillAlpha(0.6)
        c.rect(ML - 6, row_y - row_h + 4, 2.5, row_h, fill=1, stroke=0)
        c.setFillAlpha(1)

        c.setFont("MonoBold", 10)
        c.setFillColor(PAPER)
        c.drawString(cols[0] + 4, row_y - 14, v["gene"])

        c.setFont("Mono", 8)
        c.setFillColor(MUTED)
        c.drawString(cols[1] + 2, row_y - 14, v["rsid"])

        c.setFont("MonoBold", 11)
        c.setFillColor(PAPER)
        c.drawString(cols[2] + 2, row_y - 14, v["geno"])

        pill(c, cols[3] + 2, row_y - 20, v["status"], sb, sf, "InstrumentB", 7)

        sum_lines = wrap(c, v["summary"], "Instrument", 9, W - MR - cols[4] - 4)
        c.setFont("Instrument", 9)
        c.setFillColor(PAPER)
        c.setFillAlpha(0.58)
        c.drawString(cols[4] + 2, row_y - 14, sum_lines[0] if sum_lines else "")
        c.setFillAlpha(1)

        row_y -= row_h

    page_footer(c)


# ─────────────────────────────────────────────────────────
# PAGE: BACK COVER
# ─────────────────────────────────────────────────────────

def page_back(c):
    full_bleed(c, INK)

    # Decorative arcs
    c.setStrokeColor(GOLD)
    c.setStrokeAlpha(0.03)
    c.setLineWidth(50)
    c.arc(W * 0.4, H * 0.1, W * 1.3, H * 0.9, 20, 130)
    c.setLineWidth(70)
    c.setStrokeAlpha(0.02)
    c.arc(-W * 0.3, H * 0.15, W * 0.65, H * 1.05, -15, 110)
    c.setStrokeAlpha(1)
    c.setLineWidth(1)

    corner_marks(c, alpha=0.22, sz=40, mg=24)
    c.setFillColor(GOLD)
    c.rect(0, H - 1.5, W, 1.5, fill=1, stroke=0)

    # Centered logo
    logo_y = H * 0.56
    c.setFont("Gloock", 42)
    c.setFillColor(GOLD)
    c.setFillAlpha(0.85)
    hw = c.stringWidth("Helix", "Gloock", 42)
    iqw = c.stringWidth("IQ", "Crimson", 42)
    total = hw + iqw
    c.drawString(W/2 - total/2, logo_y, "Helix")
    c.setFont("Crimson", 42)
    c.setFillColor(PAPER)
    c.setFillAlpha(0.28)
    c.drawString(W/2 - total/2 + hw, logo_y, "IQ")
    c.setFillAlpha(1)

    gold_rule(c, logo_y - 12, alpha=0.15)

    c.setFont("Instrument", 9.5)
    c.setFillColor(PAPER)
    c.setFillAlpha(0.28)
    url = "myhelixiq.com"
    uw = c.stringWidth(url, "Instrument", 9.5)
    c.drawString(W/2 - uw/2, logo_y - 30, url)
    c.setFillAlpha(1)

    gold_rule(c, 76, alpha=0.14)

    disclaimer = "This report is for educational purposes only and does not constitute medical advice, diagnosis, or treatment."
    d2         = "Consult a qualified healthcare professional before making health decisions. Raw DNA file permanently deleted after analysis."
    for di, dt in enumerate([disclaimer, d2]):
        c.setFont("Instrument", 7.5)
        c.setFillColor(PAPER)
        c.setFillAlpha(0.18)
        tw = c.stringWidth(dt, "Instrument", 7.5)
        c.drawString(W/2 - tw/2, 62 - di * 14, dt)
        c.setFillAlpha(1)

    c.setFillColor(GOLD)
    c.setFillAlpha(0.3)
    c.rect(0, 0, W, 2, fill=1, stroke=0)
    c.setFillAlpha(1)


# ─────────────────────────────────────────────────────────
# ASSEMBLE FULL PDF
# ─────────────────────────────────────────────────────────

OUT = io.BytesIO()
c = canvas.Canvas(OUT, pagesize=LETTER)
c.setTitle(f"HelixIQ {package_name}")
c.setAuthor("HelixIQ")

# ── COVER B + REPORT ──
cover_B(c)
c.showPage()

PAGE_ROUTES = {
    "nutrition": [page_wins, page_risks, page_supplements, page_shopping, page_diet, page_family, page_actions, page_variants, page_back],
    "disease_risk": [page_wins, page_risks, page_family, page_actions, page_variants, page_back],
    "athletic": [page_wins, page_risks, page_supplements, page_diet, page_actions, page_variants, page_back],
    "full_report": [page_wins, page_risks, page_supplements, page_shopping, page_diet, page_family, page_actions, page_variants, page_back],
}

report_pages = PAGE_ROUTES.get(package_key, PAGE_ROUTES["nutrition"])

for i, fn in enumerate(report_pages):
    fn(c)
    if i < len(report_pages) - 1:
        c.showPage()

c.save()
sys.stdout.buffer.write(OUT.getvalue())
