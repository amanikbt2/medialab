import express from "express";
const router = express.Router();
import upload from "../middleware/upload.js";
import ctrl from "../controllers/conversionController.js";

// Image → PDF
router.post("/image-to-pdf", upload.array("images", 20), async (req, res) => {
  try {
    const pdfBytes = await ctrl.imageToPdf(req.files);
    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", 'attachment; filename="converted.pdf"');
    res.send(pdfBytes);
    req.files.forEach((f) => ctrl.cleanup(f.path));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Text → Document
router.post("/text-to-document", async (req, res) => {
  try {
    const { text, format } = req.body;
    const buffer = await ctrl.textToDocument(text, format);
    const mime =
      format === "pdf"
        ? "application/pdf"
        : format === "docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "application/octet-stream";
    res.set("Content-Type", mime);
    res.set(
      "Content-Disposition",
      `attachment; filename="converted.${format}"`,
    );
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PDF Merge
router.post("/pdf-merge", upload.array("pdfs", 10), async (req, res) => {
  try {
    const pdfBytes = await ctrl.mergePdfs(req.files);
    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", 'attachment; filename="merged.pdf"');
    res.send(pdfBytes);
    req.files.forEach((f) => ctrl.cleanup(f.path));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PDF Split
router.post("/pdf-split", upload.single("pdf"), async (req, res) => {
  try {
    const pdfBytes = await ctrl.splitPdf(req.file, req.body.pageRange);
    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", 'attachment; filename="split.pdf"');
    res.send(pdfBytes);
    ctrl.cleanup(req.file.path);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Video → Audio
router.post("/video-to-audio", upload.single("video"), async (req, res) => {
  try {
    const outPath = await ctrl.videoToAudio(
      req.file.path,
      req.body.format || "mp3",
    );
    res.download(outPath, `converted.${req.body.format || "mp3"}`, () => {
      ctrl.cleanup(req.file.path);
      ctrl.cleanup(outPath);
    });
  } catch (e) {
    res.status(500).json({
      error:
        "Video conversion failed – make sure FFmpeg is installed on your system.",
    });
  }
});

// Image Editor
router.post("/image-edit", upload.single("image"), async (req, res) => {
  try {
    const options = JSON.parse(req.body.options || "{}");
    const buffer = await ctrl.editImage(req.file, options);
    res.set("Content-Type", req.file.mimetype);
    res.set(
      "Content-Disposition",
      `attachment; filename="edited${path.extname(req.file.originalname)}"`,
    );
    res.send(buffer);
    ctrl.cleanup(req.file.path);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Text to Speech (Coqui TTS placeholder)
router.post("/text-to-speech", async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "Text is required" });
  // TODO: Call Coqui TTS Python script here
  res.json({ success: true, message: "TTS generated (demo)" });
});

// Voice Cloning (Coqui TTS)
router.post("/voice-clone", upload.single("reference"), async (req, res) => {
  const { text } = req.body;
  if (!req.file || !text)
    return res.status(400).json({ error: "Reference audio and text required" });
  // TODO: Run Coqui TTS voice cloning
  res.json({ success: true, message: "Voice cloned (demo)" });
});

export default router;
