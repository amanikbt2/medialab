import fs from "fs";
import path from "path";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import PDFKit from "pdfkit";
import { Document, Packer, Paragraph, TextRun } from "docx";
import XLSX from "xlsx";
import ffmpeg from "fluent-ffmpeg";

const cleanup = (filePath) =>
  fs.existsSync(filePath) && fs.unlinkSync(filePath);

// 1. Image → PDF
async function imageToPdf(images) {
  const pdfDoc = await PDFDocument.create();
  for (const file of images) {
    const bytes = fs.readFileSync(file.path);
    let img;
    if (file.mimetype === "image/jpeg") img = await pdfDoc.embedJpg(bytes);
    else if (file.mimetype === "image/png") img = await pdfDoc.embedPng(bytes);
    else {
      const png = await sharp(bytes).png().toBuffer();
      img = await pdfDoc.embedPng(png);
    }
    const page = pdfDoc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  return await pdfDoc.save();
}

// 2. Text → Document
async function textToDocument(text, format) {
  if (format === "pdf") {
    const doc = new PDFKit();
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.text(text || "MediaLab converted text");
    doc.end();
    return Buffer.concat(chunks);
  }
  if (format === "docx") {
    const doc = new Document({
      sections: [
        { children: [new Paragraph({ children: [new TextRun(text)] })] },
      ],
    });
    return await Packer.toBuffer(doc);
  }
  if (format === "txt") return Buffer.from(text || "");
  if (format === "xls") {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([{ Content: text }]),
      "Sheet1",
    );
    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  }
  throw new Error("Invalid format");
}

// 3. PDF Merge
async function mergePdfs(pdfs) {
  const merged = await PDFDocument.create();
  for (const file of pdfs) {
    const bytes = fs.readFileSync(file.path);
    const pdf = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(pdf, pdf.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
  }
  return await merged.save();
}

// 4. PDF Split
async function splitPdf(pdfFile, pageRange) {
  const bytes = fs.readFileSync(pdfFile.path);
  const pdf = await PDFDocument.load(bytes);
  const ranges = pageRange.split(",").flatMap((r) => {
    if (r.includes("-")) {
      const [start, end] = r.split("-").map(Number);
      return Array.from({ length: end - start + 1 }, (_, i) => start + i - 1);
    }
    return [parseInt(r) - 1];
  });
  const newPdf = await PDFDocument.create();
  const copied = await newPdf.copyPages(
    pdf,
    ranges.filter((i) => i >= 0),
  );
  copied.forEach((p) => newPdf.addPage(p));
  return await newPdf.save();
}

// 5. Video → Audio (requires FFmpeg on system)
function videoToAudio(videoPath, format = "mp3") {
  return new Promise((resolve, reject) => {
    const out = path.join(
      __dirname,
      "../uploads",
      `audio-${Date.now()}.${format}`,
    );
    ffmpeg(videoPath)
      .toFormat(format)
      .on("end", () => resolve(out))
      .on("error", reject)
      .save(out);
  });
}

// 6. Image Editor
async function editImage(imageFile, options) {
  let pipe = sharp(imageFile.path);
  if (options.crop) pipe = pipe.extract(options.crop);
  if (options.resize?.width && options.resize?.height)
    pipe = pipe.resize(options.resize.width, options.resize.height);
  if (options.rotate) pipe = pipe.rotate(options.rotate);
  if (options.brightness !== undefined)
    pipe = pipe.modulate({ brightness: options.brightness });
  if (options.contrast !== undefined)
    pipe = pipe.modulate({ contrast: options.contrast });
  return await pipe.toBuffer();
}

export default {
  imageToPdf,
  textToDocument,
  mergePdfs,
  splitPdf,
  videoToAudio,
  editImage,
  cleanup,
};
