import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { PDFDocument as PdfLibDocument } from "pdf-lib";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output", "pdf");
const outputPath = path.join(outputDir, "full-walkthrough.pdf");

fs.mkdirSync(path.join(repoRoot, "tmp", "pdfs"), { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });

const content = {
  title: "MediaLab App Summary",
  whatItIs:
    "MediaLab is a browser-based creative studio and project marketplace built on Express and EJS. It combines media tools, a visual web builder, publishing flows, notifications, and admin moderation in one app.",
  whoItsFor:
    "Primary persona label: Not found in repo. Inferred from the implemented tools, the main users are creators, indie web builders, and sellers who want one dashboard for making, publishing, and monetizing projects.",
  features: [
    "Web Builder with design mode, code mode, templates, run preview, and publishing.",
    "Marketplace listings with screenshots, comments, ratings, purchases, and admin review.",
    "GitHub and Render workflows for repo setup, publish, hosting verification, and monitoring.",
    "Google AdSense onboarding, verification, and project-level monetization toggles.",
    "Studio tools including video-to-audio, text-to-speech, voice clone, image/PDF/doc conversion, and AI image editing.",
    "Notifications, referrals, premium requests, withdrawals, feedback, analytics, and admin controls.",
  ],
  architecture: [
    "Frontend: EJS views (`views/index.ejs`, `views/admin.ejs`, `views/terminal-isolated.ejs`) plus static assets from `client/`.",
    "Backend: one Express app in `index.js` with `/api/*` endpoints, middleware, static serving, and Socket.IO.",
    "Data: MongoDB via Mongoose models for users, marketplace items, notifications, usage logs, templates, referrals, feedback, upgrades, and withdrawals.",
    "Flow and services: browser actions call `/api/*`, data persists in MongoDB, notifications can emit through Socket.IO, and publish flows integrate with GitHub, ImageKit, Render, and Google APIs.",
  ],
  howToRun: [
    "Install deps: `npm install`.",
    "Create `.env` with `MONGO_URI`, `SESSION_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`.",
    "Add Google/ImageKit keys only if using auth, uploads, or publishing integrations.",
    "Start with `npm start` or `npm run dev`.",
    "Open `http://localhost:3000` unless `PORT` is set differently in the environment.",
  ],
};

const doc = new PDFDocument({
  size: "A4",
  layout: "landscape",
  margins: { top: 24, bottom: 22, left: 24, right: 24 },
  info: {
    Title: "MediaLab App Summary",
    Author: "OpenAI Codex",
    Subject: "One-page app walkthrough",
  },
});

const stream = fs.createWriteStream(outputPath);
doc.pipe(stream);

const pageWidth = doc.page.width;
const pageHeight = doc.page.height;
const marginLeft = doc.page.margins.left;
const marginRight = doc.page.margins.right;
const marginTop = doc.page.margins.top;
const gutter = 16;
const columnWidth = (pageWidth - marginLeft - marginRight - gutter) / 2;
const leftX = marginLeft;
const rightX = marginLeft + columnWidth + gutter;

function drawRule(y, color = "#d7e3ee") {
  doc.save();
  doc.moveTo(marginLeft, y).lineTo(pageWidth - marginRight, y).lineWidth(1).strokeColor(color).stroke();
  doc.restore();
}

function sectionTitle(x, y, title) {
  doc.font("Helvetica-Bold").fontSize(9.9).fillColor("#0f172a").text(title, x, y, {
    width: columnWidth,
  });
  return doc.y + 2;
}

function bodyText(x, y, text, size = 8.0) {
  doc.font("Helvetica").fontSize(size).fillColor("#334155").text(text, x, y, {
    width: columnWidth,
    lineGap: 0.8,
  });
  return doc.y;
}

function bulletList(x, y, items, size = 7.75, gap = 2.2) {
  let cursor = y;
  items.forEach((item) => {
    doc.font("Helvetica").fontSize(size).fillColor("#334155").text(`- ${item}`, x, cursor, {
      width: columnWidth,
      lineGap: 1.1,
    });
    cursor = doc.y + gap;
  });
  return cursor;
}

doc.rect(0, 0, pageWidth, pageHeight).fill("#f8fbff");
doc.save();
doc.rect(0, 0, pageWidth, 76).fill("#eaf7ff");
doc.restore();
doc.save();
doc.circle(pageWidth - 86, 44, 72).fillOpacity(0.18).fill("#67e8f9");
doc.circle(pageWidth - 24, 18, 48).fillOpacity(0.1).fill("#0ea5e9");
doc.restore();

doc.font("Helvetica-Bold").fontSize(19).fillColor("#0f172a").text(content.title, marginLeft, marginTop, {
  width: pageWidth - marginLeft - marginRight - 120,
});
doc.font("Helvetica").fontSize(8.3).fillColor("#475569").text(
  "One-page repo-based overview",
  marginLeft,
  doc.y + 1,
  { width: 220 },
);

const headerBottom = 74;
drawRule(headerBottom, "#cfe7f5");

let leftY = headerBottom + 14;
let rightY = headerBottom + 14;

leftY = sectionTitle(leftX, leftY, "What It Is");
leftY = bodyText(leftX, leftY, content.whatItIs);
leftY += 6;

leftY = sectionTitle(leftX, leftY, "Who It's For");
leftY = bodyText(leftX, leftY, content.whoItsFor);
leftY += 6;

leftY = sectionTitle(leftX, leftY, "What It Does");
leftY = bulletList(leftX, leftY, content.features, 7.7, 2.2);

rightY = sectionTitle(rightX, rightY, "How It Works");
rightY = bulletList(rightX, rightY, content.architecture, 7.65, 2.2);
rightY += 3;

rightY = sectionTitle(rightX, rightY, "How To Run");
rightY = bulletList(rightX, rightY, content.howToRun, 7.7, 2.4);

const footerY = pageHeight - 24;
drawRule(footerY - 8, "#dbe8f2");
doc.font("Helvetica").fontSize(7.1).fillColor("#64748b").text(
  "Built from repo evidence in package.json, index.js, models/, and views/ only.",
  marginLeft,
  footerY,
  { width: pageWidth - marginLeft - marginRight, align: "left" },
);

doc.end();

await new Promise((resolve, reject) => {
  stream.on("finish", resolve);
  stream.on("error", reject);
});

const bytes = fs.readFileSync(outputPath);
const pdf = await PdfLibDocument.load(bytes);
let pageCount = pdf.getPageCount();

if (pageCount > 1) {
  const trimmed = await PdfLibDocument.create();
  const [firstPage] = await trimmed.copyPages(pdf, [0]);
  trimmed.addPage(firstPage);
  fs.writeFileSync(outputPath, await trimmed.save());
  pageCount = 1;
}

if (pageCount !== 1) {
  throw new Error(`Expected 1 PDF page, got ${pageCount}.`);
}

console.log(outputPath);
