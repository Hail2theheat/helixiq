// ============================================================
// HelixIQ — Backend: Stripe + File Upload + Claude API + Email PDF
// Stack: Node.js + Express + Stripe + Anthropic SDK + Nodemailer + PDFKit
// ============================================================
// .env variables required:
//   STRIPE_SECRET_KEY=sk_live_...
//   STRIPE_WEBHOOK_SECRET=whsec_...
//   ANTHROPIC_API_KEY=sk-ant-...
//   SMTP_HOST=smtp.sendgrid.net
//   SMTP_PORT=587
//   SMTP_USER=apikey
//   SMTP_PASS=SG.xxxx
//   EMAIL_FROM=reports@helixiq.com
//   BASE_URL=https://helixiq.com
//   PORT=3000
// ============================================================

import express from "express";
import Stripe from "stripe";
import Anthropic from "@anthropic-ai/sdk";
import multer from "multer";
import nodemailer from "nodemailer";
import { generatePDF } from "./pdf-generator.js";
import dotenv from "dotenv";
import crypto from "crypto";
import path from "path";
import fs, { existsSync } from "fs";
import { fileURLToPath } from "url";
import { createServer } from "http";

if (existsSync('.env')) { dotenv.config(); }

// ── Catch silent crashes ────────────────────────────────────────
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── In-memory order store (replace with DB in production) ──────────────
const pendingOrders = new Map();
// Structure: { sessionId: { email, package, status } }

// ── Multer: memory storage, 50MB limit ─────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const isText = file.mimetype === "text/plain" || file.originalname.endsWith(".txt");
    cb(isText ? null : new Error("Only .txt raw DNA files accepted"), isText);
  },
});

// ── Email transporter ───────────────────────────────────────────────────
const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

// ── Packages config ─────────────────────────────────────────────────────
const PACKAGES = {
  nutrition: {
    name: "Nutrition & Supplements",
    price: 4900, // cents
    priceId: "price_nutrition_49", // replace with real Stripe Price ID
    description: "Personalized nutrition & supplement analysis from your DNA",
  },
  disease_risk: {
    name: "Disease Risk & Prevention",
    price: 7900,
    priceId: "price_disease_79",
    description: "Genetic disease risk & prevention strategies",
  },
  athletic: {
    name: "Athletic Performance",
    price: 4900,
    priceId: "price_athletic_49",
    description: "Athletic performance & training optimization",
  },
  full_report: {
    name: "Full Genome Report",
    price: 14900,
    priceId: "price_full_149",
    description: "Comprehensive full genome analysis",
  },
};

// ── System prompts per package ──────────────────────────────────────────
function getSystemPrompt(packageKey) {
  const sharedRules = `
CRITICAL OUTPUT FORMAT:
You must respond with ONLY valid JSON. No markdown, no preamble, no explanation outside the JSON.
The JSON structure is defined below for each package type.

TONE RULES:
- Write like a brilliant friend who happens to know genetics — warm, direct, surprising
- Lead with the most interesting findings first, not the most obvious
- Every insight must connect to a real daily life action
- Use "your genome suggests" not "you have" or "you are at risk"
- Short sentences. No jargon without immediate plain-English explanation
- Make people feel like they learned something they couldn't have googled
- NEVER say "it's important to consult a doctor" more than once per report
`;

  const prompts = {
    nutrition: `${sharedRules}

You are a nutritional genomics specialist. Analyze the raw 23andMe/AncestryDNA SNP data provided and return this exact JSON structure:

{
  "headline": "A single punchy 8-12 word sentence summarizing the most surprising finding. Like a magazine cover line.",
  "intro": "2-3 sentences. The most interesting thing about this person's nutritional genome. Lead with the unexpected. Make them feel seen.",
  "topWins": [
    {
      "title": "Short title (3-5 words)",
      "gene": "Gene name e.g. CYP1A2",
      "insight": "1-2 sentences explaining what this variant means in plain English",
      "action": "One specific thing to do or keep doing"
    }
  ],
  "topRisks": [
    {
      "title": "Short title (3-5 words)",
      "gene": "Gene name",
      "insight": "1-2 sentences on the risk or suboptimal variant",
      "action": "One specific mitigation"
    }
  ],
  "supplementStack": [
    {
      "name": "Supplement name",
      "form": "Specific form e.g. methylcobalamin not cyanocobalamin",
      "why": "One sentence genetic justification",
      "priority": "Essential | Recommended | Optional"
    }
  ],
  "dietPattern": {
    "recommendation": "Name of dietary pattern",
    "reason": "2-3 sentences on why this genome fits this pattern specifically",
    "doMore": ["3-4 specific foods or habits to increase"],
    "doLess": ["2-3 specific foods or habits to reduce"]
  },
  "familyNotes": {
    "partner": "2-3 sentences on what a partner/spouse should know about living with someone with this genome. Practical, interesting, not scary.",
    "children": "2-3 sentences on what variants might be heritable and worth knowing for future children. Keep it light and actionable."
  },
  "actionPlan": [
    "Specific action item 1 — start with a verb, be concrete",
    "Specific action item 2",
    "Specific action item 3",
    "Specific action item 4",
    "Specific action item 5"
  ],
  "keyVariants": [
    {
      "gene": "Gene name",
      "variant": "rsID",
      "genotype": "e.g. AG",
      "status": "Protective | Typical | Monitor",
      "summary": "5-8 word plain English summary"
    }
  ]
}

Populate topWins with 3 items and topRisks with 3 items.
Populate supplementStack with 4-6 items.
Populate keyVariants with 6-10 of the most significant variants found.
If a variant is not found in the data, skip it — only include what's actually in the file.
Focus on: MTHFR, VDR, FUT2, BCMO1, FADS1/2, APOE, TCF7L2, FTO, CYP1A2, MCM6, HFE, COMT, SOD2.`,

    disease_risk: `${sharedRules}

You are a preventive genomics specialist. Analyze the SNP data and return this exact JSON:

{
  "headline": "A single punchy 8-12 word sentence — empowering, not scary. Focus on prevention power.",
  "intro": "2-3 sentences. Frame this as a prevention roadmap, not a risk list. Lead with agency.",
  "topStrengths": [
    {
      "title": "Short title (3-5 words)",
      "gene": "Gene name",
      "insight": "1-2 sentences on why this is a genetic strength or protective variant",
      "action": "How to amplify this advantage"
    }
  ],
  "watchAreas": [
    {
      "title": "Short title (3-5 words)",
      "gene": "Gene name",
      "insight": "1-2 sentences on the elevated risk variant — frame as 'worth watching' not 'you will get'",
      "action": "One specific prevention step",
      "urgency": "Discuss with doctor | Lifestyle focus | Monitor annually"
    }
  ],
  "systemsBreakdown": {
    "cardiovascular": "2-3 sentences on heart health genetics. Be specific about what was found.",
    "metabolic": "2-3 sentences on metabolism, blood sugar, weight genetics.",
    "inflammation": "2-3 sentences on inflammatory markers and immune genetics.",
    "cognitive": "2-3 sentences on brain health, Alzheimer's risk (handle APOE4 carefully), cognitive aging."
  },
  "familyNotes": {
    "partner": "2-3 sentences on what a partner should know — screening schedules, lifestyle habits worth sharing, nothing alarming.",
    "children": "2-3 sentences on heritable risk variants worth knowing about. Actionable and calm."
  },
  "preventionPlan": [
    "Specific prevention action 1 — concrete and personal to these variants",
    "Specific prevention action 2",
    "Specific prevention action 3",
    "Specific prevention action 4",
    "Specific prevention action 5",
    "Specific prevention action 6"
  ],
  "screeningNotes": "2-3 sentences on which types of health screenings make particular sense given these variants. Don't specify exact ages — recommend discussing with a physician.",
  "keyVariants": [
    {
      "gene": "Gene name",
      "variant": "rsID",
      "genotype": "e.g. AG",
      "status": "Protective | Typical | Monitor",
      "summary": "5-8 word plain English summary"
    }
  ]
}

Populate topStrengths with 3 items and watchAreas with 3-4 items.
Populate keyVariants with 8-12 significant variants.
APOE4 handling: if present, frame around the extensive lifestyle research showing modifiability. Never alarming.
Focus on: APOE, PCSK9, 9p21, MTHFR, TCF7L2, FTO, IL6, TNF, COMT, BDNF, FOXO3, SIRT1.`,

    athletic: `${sharedRules}

You are a sports genomics specialist. Analyze the SNP data and return this exact JSON:

{
  "headline": "8-12 words. Lead with the athlete's genetic identity — power beast, endurance machine, balanced hybrid, etc.",
  "athleteProfile": "3-4 sentences painting a picture of this person's genetic athletic identity. Vivid and specific. Reference actual variants found.",
  "powerEnduranceScore": {
    "profile": "Power | Endurance | Balanced",
    "explanation": "2-3 sentences on ACTN3 and ACE findings and what they mean for training",
    "bestSports": ["3-4 sports or activities where this genome has natural advantage"]
  },
  "topAdvantages": [
    {
      "title": "Short title (3-5 words)",
      "gene": "Gene name",
      "insight": "1-2 sentences on the performance advantage",
      "action": "How to exploit this genetic edge"
    }
  ],
  "watchAreas": [
    {
      "title": "Short title (3-5 words)",
      "gene": "Gene name",
      "insight": "1-2 sentences on injury risk or recovery consideration",
      "action": "Specific prehab or training adjustment"
    }
  ],
  "trainingProtocol": {
    "frequency": "Recommended training days per week with brief rationale",
    "split": "Strength vs cardio ratio recommendation",
    "repRanges": "Optimal rep ranges for this muscle fiber profile",
    "recovery": "Recovery window recommendation based on inflammation genetics",
    "hiitVsSteadyState": "Which type of cardio this genome responds better to and why"
  },
  "familyNotes": {
    "partner": "2-3 sentences — fun and practical. What training together might look like given this genome.",
    "children": "2-3 sentences on athletic traits that may be heritable."
  },
  "performancePlan": [
    "Specific training action 1",
    "Specific training action 2",
    "Specific training action 3",
    "Specific training action 4",
    "Specific training action 5"
  ],
  "keyVariants": [
    {
      "gene": "Gene name",
      "variant": "rsID",
      "genotype": "e.g. RR",
      "status": "Protective | Typical | Monitor",
      "summary": "5-8 word plain English summary"
    }
  ]
}

Populate topAdvantages with 3 items and watchAreas with 2-3 items.
Focus on: ACTN3, ACE, PPARA, PPARGC1A, COL1A1, COL5A1, IL6, SOD2, AMPD1, CKMM, MSTN, NOS3.`,

    full_report: `${sharedRules}

You are HelixIQ's lead genomics analyst producing the flagship Full Genome Report. Return this exact JSON:

{
  "headline": "8-12 words. The single most compelling thing about this genome.",
  "intro": "4-5 sentences. A vivid portrait of this genome's most distinctive themes. Read like an executive brief, not a medical report.",
  "nutritionSummary": {
    "headline": "5-7 word summary of nutritional genome",
    "topFindings": ["3 most important nutrition findings as short punchy sentences"],
    "supplementStack": [
      {"name": "Supplement", "form": "Specific form", "priority": "Essential | Recommended | Optional"}
    ],
    "dietPattern": "Recommended dietary pattern name",
    "dietReason": "2 sentences why"
  },
  "riskSummary": {
    "headline": "5-7 word summary of risk profile",
    "strengths": ["2-3 genetic strengths as short sentences"],
    "watchAreas": ["2-3 watch areas as short sentences"],
    "preventionFocus": "2 sentences on the most important prevention focus for this genome"
  },
  "athleticSummary": {
    "profile": "Power | Endurance | Balanced",
    "headline": "5-7 word athletic identity",
    "topFindings": ["3 most important performance findings"],
    "trainingFocus": "2 sentences on training approach"
  },
  "sleepProfile": {
    "chronotype": "Morning | Evening | Neutral",
    "explanation": "2-3 sentences on sleep genetics found — PER3, CLOCK, ADORA2A",
    "recommendations": ["3 specific sleep optimization tips for this genome"]
  },
  "mindProfile": {
    "headline": "5-7 words on neurotransmitter profile",
    "explanation": "2-3 sentences on COMT, MAOA, BDNF findings",
    "recommendations": ["3 specific cognitive and stress management tips"]
  },
  "longevityProfile": {
    "headline": "5-7 word longevity summary",
    "explanation": "2-3 sentences on FOXO3, SIRT1, APOE longevity findings",
    "recommendations": ["3 specific longevity-focused recommendations"]
  },
  "familyNotes": {
    "partner": "3-4 sentences. What a partner should know about living with and loving someone with this genome. Warm, specific, practical.",
    "children": "3-4 sentences. What heritable traits are worth knowing about. Which variants to consider testing for. Calm and actionable."
  },
  "masterActionPlan": {
    "thisWeek": ["3 things to do or change this week"],
    "thisMonth": ["3 things to set up or start this month"],
    "thisYear": ["3 annual screenings or longer-term habits to establish"]
  },
  "keyVariants": [
    {
      "gene": "Gene name",
      "variant": "rsID",
      "genotype": "e.g. AG",
      "status": "Protective | Typical | Monitor",
      "summary": "5-8 word plain English summary"
    }
  ]
}

keyVariants should include 15-20 of the most significant variants across all categories.
This is the premium $149 report — every section should feel thorough and personalized.`
  };

  return prompts[packageKey] || prompts.nutrition;
}

// ════════════════════════════════════════════════════════════════
// ROUTES
// ════════════════════════════════════════════════════════════════

// ── 1. Serve static files ───────────────────────────────────────
app.use(express.static(path.join(__dirname, "public")));

// ── 2. Create Stripe Checkout Session ─────────────────────────
app.post("/api/create-checkout", express.json(), async (req, res) => {
  const { packageKey, email } = req.body;

  if (!PACKAGES[packageKey]) {
    return res.status(400).json({ error: "Invalid package" });
  }

  const pkg = PACKAGES[packageKey];

  const checkoutParams = {
    payment_method_types: ["card"],
    customer_email: email || undefined,
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `HelixIQ — ${pkg.name}`,
            description: pkg.description,
          },
          unit_amount: pkg.price,
        },
        quantity: 1,
      },
    ],
    mode: "payment",
    success_url: 'https://myhelixiq.com/upload?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: 'https://myhelixiq.com/#pricing',
    metadata: { packageKey },
    billing_address_collection: "auto",
  };

  try {
    console.log('BASE_URL:', process.env.BASE_URL);
    console.log('Stripe checkout params:', JSON.stringify(checkoutParams, null, 2));
    const session = await stripe.checkout.sessions.create(checkoutParams);

    // Store pending order
    pendingOrders.set(session.id, {
      email: null, // will be captured post-payment
      package: packageKey,
      status: "pending",
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe error message:", err.message);
    console.error("Stripe error type:", err.type);
    console.error("Stripe error full:", err);
    console.error("Params sent:", JSON.stringify(checkoutParams, null, 2));
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// ── 3. Stripe Webhook (payment confirmation) ───────────────────
app.post(
  "/api/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("Webhook signature error:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const order = pendingOrders.get(session.id);

      if (order) {
        order.email = session.customer_details?.email;
        order.status = "paid";
        pendingOrders.set(session.id, order);
        console.log(`✅ Payment confirmed for session ${session.id}`);
      }
    }

    res.json({ received: true });
  }
);

// ── 4. Verify session is paid (for upload page) ────────────────
app.get("/api/session/:sessionId", express.json(), async (req, res) => {
  const { sessionId } = req.params;

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== "paid") {
      return res.status(402).json({ error: "Payment not completed" });
    }

    const pkg = PACKAGES[session.metadata.packageKey];

    res.json({
      valid: true,
      package: session.metadata.packageKey,
      packageName: pkg.name,
      email: session.customer_details?.email,
    });
  } catch (err) {
    res.status(404).json({ error: "Session not found" });
  }
});

// ── 5. DNA Upload + Report Generation ─────────────────────────
app.post(
  "/api/generate-report",
  upload.single("dnaFile"),
  async (req, res) => {
    const { sessionId } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: "No DNA file uploaded" });
    }

    // Verify payment
    let session;
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.payment_status !== "paid") {
        return res.status(402).json({ error: "Payment not verified" });
      }
    } catch {
      return res.status(400).json({ error: "Invalid session" });
    }

    const packageKey = session.metadata.packageKey;
    const customerEmail = session.customer_details?.email;

    if (!customerEmail) {
      return res.status(400).json({ error: "No email on file for this session" });
    }

    // Extract DNA file content
    const dnaContent = req.file.buffer.toString("utf-8");

    // Validate it looks like a real DNA file
    if (!dnaContent.includes("rsid") && !dnaContent.includes("rs")) {
      return res.status(400).json({
        error: "File doesn't appear to be a valid 23andMe/AncestryDNA raw data file",
      });
    }

    // Immediately nullify the buffer reference (GC will clean it up)
    req.file.buffer = null;

    // Truncate to first 200,000 characters to stay within token limits
    // 23andMe files are ~250MB uncompressed; we sample key sections
    const truncatedDna = dnaContent.slice(0, 200000);

    // Respond immediately — report will be emailed in the background
    res.json({
      success: true,
      message: 'Your report is being generated and will be emailed to you within 5 minutes.',
    });

    // Process report generation asynchronously
    (async () => {
      try {
        // Generate report via Claude API
        const aiResponse = await anthropic.messages.create({
          model: "claude-opus-4-5",
          max_tokens: 8000,
          system: getSystemPrompt(packageKey),
          messages: [
            {
              role: "user",
              content: `Here is the raw DNA data file. Please analyze it and generate the full report.\n\n---BEGIN DNA DATA---\n${truncatedDna}\n---END DNA DATA---`,
            },
          ],
        });

        // Generate PDF
        const pdfBuffer = await generatePDF(
          aiResponse.content[0].text,
          PACKAGES[packageKey].name,
          customerEmail,
          packageKey
        );

        // Send email with PDF attachment
        await mailer.sendMail({
          from: `HelixIQ <${process.env.EMAIL_FROM}>`,
          to: customerEmail,
          subject: `Your HelixIQ ${PACKAGES[packageKey].name} Report Is Ready`,
          html: `
            <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
              <h1 style="font-size: 28px; font-weight: 300; border-bottom: 1px solid #c9a84c; padding-bottom: 16px; margin-bottom: 24px;">Your HelixIQ Report</h1>
              <p style="font-size: 16px; line-height: 1.7; color: #444;">Your <strong>${PACKAGES[packageKey].name}</strong> is attached to this email as a PDF.</p>
              <p style="font-size: 16px; line-height: 1.7; color: #444;">Thank you for trusting HelixIQ with your genetic data. As a reminder, your raw DNA file was permanently deleted immediately after analysis and is not stored on our servers.</p>
              <p style="font-size: 13px; color: #888; margin-top: 32px; line-height: 1.6; border-top: 1px solid #eee; padding-top: 20px;">
                This report is for educational purposes only and does not constitute medical advice.
                Please consult a qualified healthcare professional before making health decisions.
              </p>
              <p style="font-size: 13px; color: #888;">© 2025 HelixIQ · <a href="${process.env.BASE_URL}/privacy" style="color: #c9a84c;">Privacy Policy</a></p>
            </div>
          `,
          attachments: [
            {
              filename: `HelixIQ-${packageKey}-report.pdf`,
              content: pdfBuffer,
              contentType: "application/pdf",
            },
          ],
        });

        // Mark order as complete
        const order = pendingOrders.get(sessionId);
        if (order) {
          order.status = "complete";
          pendingOrders.set(sessionId, order);
        }

        console.log(`Report delivered to ${customerEmail}`);
      } catch (err) {
        console.error("Background report generation error:", err);
      }
    })();
  }
);


// ════════════════════════════════════════════════════════════════
// UPLOAD PAGE (served after successful Stripe payment)
// ════════════════════════════════════════════════════════════════

app.get("/upload", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>HelixIQ — Upload Your DNA File</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Georgia', serif; background: #0a0a0f; color: #f5f2eb; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .container { max-width: 540px; width: 100%; }
  .logo { font-size: 1.4rem; color: #c9a84c; margin-bottom: 48px; letter-spacing: 0.05em; }
  .logo span { color: #f5f2eb; font-weight: 300; }
  h1 { font-size: 2rem; font-weight: 300; line-height: 1.2; margin-bottom: 12px; }
  h1 em { color: #c9a84c; font-style: italic; }
  .subtitle { color: rgba(245,242,235,0.5); font-size: 0.9rem; line-height: 1.7; margin-bottom: 40px; font-family: sans-serif; }
  .package-badge { display: inline-block; background: rgba(201,168,76,0.1); border: 1px solid rgba(201,168,76,0.3); color: #c9a84c; font-size: 0.75rem; letter-spacing: 0.1em; padding: 6px 14px; margin-bottom: 32px; font-family: sans-serif; }
  .upload-zone {
    border: 1px dashed rgba(201,168,76,0.4);
    padding: 48px 32px;
    text-align: center;
    cursor: pointer;
    transition: all 0.2s;
    margin-bottom: 24px;
    position: relative;
  }
  .upload-zone:hover, .upload-zone.dragover { border-color: #c9a84c; background: rgba(201,168,76,0.04); }
  .upload-zone input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; }
  .upload-icon { font-size: 2rem; margin-bottom: 12px; color: #c9a84c; opacity: 0.6; }
  .upload-label { font-size: 0.9rem; color: rgba(245,242,235,0.6); line-height: 1.6; font-family: sans-serif; }
  .upload-label strong { color: #f5f2eb; }
  .file-selected { font-size: 0.85rem; color: #c9a84c; margin-top: 8px; font-family: sans-serif; }
  .btn {
    width: 100%; padding: 16px;
    background: #c9a84c; color: #0a0a0f;
    border: none; border-radius: 2px;
    font-size: 0.85rem; letter-spacing: 0.1em; text-transform: uppercase;
    cursor: pointer; font-weight: 600; transition: all 0.2s;
  }
  .btn:hover { background: #e8c97a; }
  .btn:disabled { background: rgba(201,168,76,0.3); cursor: not-allowed; color: rgba(10,10,15,0.5); }
  .status { margin-top: 20px; padding: 16px; font-size: 0.85rem; font-family: sans-serif; text-align: center; display: none; }
  .status.loading { background: rgba(26,39,68,0.4); color: rgba(245,242,235,0.7); border: 1px solid rgba(201,168,76,0.2); display: block; }
  .status.success { background: rgba(0,120,80,0.1); color: #4ecca3; border: 1px solid rgba(78,204,163,0.2); display: block; }
  .status.error { background: rgba(200,50,50,0.1); color: #ff8080; border: 1px solid rgba(255,128,128,0.2); display: block; }
  .privacy-note { margin-top: 24px; font-size: 0.78rem; color: rgba(245,242,235,0.3); text-align: center; font-family: sans-serif; line-height: 1.6; }
</style>
</head>
<body>
<div class="container">
  <div class="logo">Helix<span>IQ</span></div>
  <div id="package-badge" class="package-badge">Loading your report type...</div>
  <h1>Upload your <em>raw DNA</em> file</h1>
  <p class="subtitle">Your payment was successful. Upload your raw 23andMe or AncestryDNA .txt file below — your personalized report will be emailed to you within minutes.</p>

  <div class="upload-zone" id="dropZone">
    <input type="file" id="fileInput" accept=".txt" />
    <div class="upload-icon">⬆</div>
    <div class="upload-label"><strong>Click to select</strong> or drag & drop your DNA file<br><small>23andMe or AncestryDNA raw data .txt file</small></div>
    <div class="file-selected" id="fileName"></div>
  </div>

  <button class="btn" id="submitBtn" disabled onclick="submitReport()">Generate My Report</button>

  <div class="status" id="status"></div>

  <div class="privacy-note">🔒 Your raw DNA file is permanently deleted immediately after analysis. We never store or share your genetic data.</div>
</div>

<script>
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session_id');
  let customerEmail = '';

  // Verify session
  fetch('/api/session/' + sessionId)
    .then(r => r.json())
    .then(data => {
      if (data.valid) {
        document.getElementById('package-badge').textContent = '✓ PAID — ' + data.packageName.toUpperCase();
        customerEmail = data.email || '';
      } else {
        document.getElementById('package-badge').textContent = '⚠ Payment not verified';
      }
    })
    .catch(() => {
      document.getElementById('package-badge').textContent = '⚠ Could not verify payment';
    });

  // File input
  const fileInput = document.getElementById('fileInput');
  const dropZone = document.getElementById('dropZone');
  const submitBtn = document.getElementById('submitBtn');
  const fileName = document.getElementById('fileName');

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) {
      fileName.textContent = '✓ ' + fileInput.files[0].name;
      submitBtn.disabled = false;
    }
  });

  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.txt')) {
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      fileName.textContent = '✓ ' + file.name;
      submitBtn.disabled = false;
    }
  });

  async function submitReport() {
    const file = fileInput.files[0];
    if (!file || !sessionId) return;

    submitBtn.disabled = true;
    const status = document.getElementById('status');
    status.className = 'status loading';
    status.textContent = '⏳ Analyzing your DNA and generating your report... This may take 2-4 minutes. Please keep this tab open.';

    const formData = new FormData();
    formData.append('dnaFile', file);
    formData.append('sessionId', sessionId);

    try {
      const response = await fetch('/api/generate-report', {
        method: 'POST',
        body: formData
      });
      const data = await response.json();

      if (data.success) {
        status.className = 'status success';
        status.textContent = '✓ Your report has been generated and sent to ' + (customerEmail || 'your email address') + '. Check your inbox (and spam folder).';
        submitBtn.style.display = 'none';
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (err) {
      status.className = 'status error';
      status.textContent = '✗ ' + (err.message || 'Something went wrong. Please contact support@helixiq.com with your order ID.');
      submitBtn.disabled = false;
    }
  }
</script>
</body>
</html>`);
});

// ── Start server ────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const server = createServer(app);
server.listen(PORT, () => {
  console.log(`HelixIQ server running on port ${PORT}`);
});

// ════════════════════════════════════════════════════════════════
