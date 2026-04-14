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

export default router;
