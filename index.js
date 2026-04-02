import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import session from "express-session";
import MongoStore from "connect-mongo";
import passport from "passport";
import mongoose from "mongoose";
import "dotenv/config";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";

// Models & Routes
import authRoutes from "./routes/authRoutes.js";
import User from "./models/User.js";
import Feedback from "./models/Feedback.js";
import UpgradeRequest from "./models/UpgradeRequest.js";
import UsageLog from "./models/UsageLog.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure FFmpeg path
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const app = express();
const httpServer = createServer(app);

// --- 1. PRO PRODUCTION SETUP ---
// This is critical for Render/Heroku to handle HTTPS cookies correctly
app.set("trust proxy", 1);

const io = new Server(httpServer, {
  cors: {
    origin:
      process.env.NODE_ENV === "production"
        ? "https://medialab-6b20.onrender.com"
        : ["http://localhost:3000", "http://127.0.0.1:3000"],
    credentials: true,
  },
});

async function createUsageLog({
  user = null,
  email = "",
  name = "",
  isAnonymous = true,
  isPro = false,
  action,
  summary,
  source = "web",
  kind = "activity",
  metadata = {},
} = {}) {
  if (!action || !summary) return null;
  try {
    const record = await UsageLog.create({
      userId: user?._id || null,
      email: String(email || user?.email || "").trim(),
      name: String(name || user?.name || "").trim(),
      isAnonymous: Boolean(user ? false : isAnonymous),
      isPro: Boolean(user?.isPro || isPro),
      action: String(action).trim(),
      summary: String(summary).trim(),
      source: String(source || "web").trim(),
      kind,
      metadata,
    });
    const totalLogs = await UsageLog.countDocuments();
    if (totalLogs > 1000) {
      const overflow = totalLogs - 1000;
      const oldLogs = await UsageLog.find({})
        .sort({ createdAt: 1 })
        .limit(overflow)
        .select("_id")
        .lean();
      if (oldLogs.length) {
        await UsageLog.deleteMany({
          _id: { $in: oldLogs.map((item) => item._id) },
        });
      }
    }
    const payload = record.toObject();
    io.emit("admin:usage-log", payload);
    if (payload.kind === "error") {
      io.emit("admin:server-error", payload);
    }
    return payload;
  } catch (error) {
    console.warn("Usage log save failed:", error.message);
    return null;
  }
}

function logServerIssue(summary, metadata = {}) {
  return createUsageLog({
    action: "server-error",
    summary,
    source: "server",
    kind: "error",
    isAnonymous: true,
    metadata,
  });
}

function buildUsageIdentity(req) {
  return {
    user: req.user || null,
    email: req.user?.email || "",
    name: req.user?.name || "",
    isAnonymous: !req.user,
    isPro: Boolean(req.user?.isPro),
  };
}

// --- 2. FOLDER & STATIC SETUP ---
const uploadDir = path.resolve(__dirname, "uploads");
const exportDir = path.resolve(__dirname, "exports");

[uploadDir, exportDir].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use(
  cors({
    origin:
      process.env.NODE_ENV === "production"
        ? "https://medialab-6b20.onrender.com"
        : true,
    credentials: true,
  }),
);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use((req, res, next) => {
  if (
    req.path === "/" ||
    req.path.endsWith(".html") ||
    req.path === "/sw.js" ||
    req.path === "/manifest.json"
  ) {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    res.set("Surrogate-Control", "no-store");
  }
  next();
});
app.post("/api/usage-log", async (req, res) => {
  try {
    const action = String(req.body?.action || "").trim();
    const summary = String(req.body?.summary || "").trim();
    if (!action || !summary) {
      return res
        .status(400)
        .json({ success: false, message: "Action and summary are required." });
    }
    const fallbackEmail = String(req.body?.email || "").trim().toLowerCase();
    const fallbackName = String(req.body?.name || "").trim();
    const fallbackIsPro = Boolean(req.body?.isPro);
    const hasFallbackIdentity = Boolean(fallbackEmail && fallbackName);
    const payload = await createUsageLog({
      user: req.user || null,
      email: req.user?.email || fallbackEmail,
      name: req.user?.name || fallbackName,
      isAnonymous: req.user ? false : !hasFallbackIdentity,
      isPro: Boolean(req.user?.isPro || fallbackIsPro),
      action,
      summary,
      source: String(req.body?.source || "web").trim(),
      kind: req.body?.kind === "error" ? "error" : "activity",
      metadata: req.body?.metadata || {},
    });
    res.json({ success: true, log: payload });
  } catch (error) {
    console.error("Usage log endpoint failed:", error);
    res
      .status(500)
      .json({ success: false, message: "Could not save usage log." });
  }
});

app.post("/api/history-projects", async (req, res) => {
  try {
    const project = req.body?.project || {};
    const toolType = String(project.toolType || "").trim();
    const fileName = String(project.fileName || "").trim();
    const fileUrl = String(project.fileUrl || "").trim();

    if (!toolType || !fileName || !fileUrl) {
      return res.status(400).json({
        success: false,
        message: "toolType, fileName, and fileUrl are required.",
      });
    }

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Login required.",
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    user.projects = user.projects.filter((item) => item.fileUrl !== fileUrl);
    user.projects.push({
      toolType,
      fileName,
      fileUrl,
      status: "completed",
      createdAt: new Date(),
    });
    user.projects = user.projects
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .slice(-10);
    await user.save();

    res.json({ success: true, projects: user.projects });
  } catch (error) {
    console.error("History project save failed:", error);
    res.status(500).json({ success: false, message: "Could not save project history." });
  }
});

// --- 3. DATABASE & SESSION ---
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB error:", err));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "medialab-secret-key",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI,
      ttl: 24 * 60 * 60, // 1 day
    }),
    cookie: {
      maxAge: 1000 * 60 * 60 * 24,
      // CRITICAL: On Render, secure must be true and sameSite must be 'none' for Google Auth
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    },
  }),
);

app.use(passport.initialize());
app.use(passport.session());

// Serving
app.use(express.static(path.join(__dirname, "client")));
app.use("/uploads", express.static(uploadDir));
app.use("/exports", express.static(exportDir));

// --- 4. API ROUTES ---
app.use("/api/auth", authRoutes);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  }),
});

app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file)
    return res.status(400).json({ success: false, message: "No file" });
  res.json({ success: true, filename: req.file.filename });
});

// --- VIDEO TO AUDIO ---
app.post("/api/convert/video-to-audio", async (req, res) => {
  const { videoFile, socketId, requestedFormat } = req.body;
  const format = requestedFormat || "mp3";
  const outputFileName = `audio_${Date.now()}.${format}`;
  const outputPath = path.join(exportDir, outputFileName);
  const inputPath = path.join(uploadDir, videoFile);

  if (!fs.existsSync(inputPath))
    return res.status(404).json({ success: false, message: "File not found" });

  ffmpeg(inputPath)
    .toFormat(format)
    .on("start", () => {
      if (socketId)
        io.to(socketId).emit("process-step", {
          message: "🎸 Extracting Audio...",
          percent: 30,
        });
    })
    .on("progress", (progress) => {
      if (progress.percent && socketId) {
        const overallPercent = 30 + Math.round(progress.percent) * 0.6;
        io.to(socketId).emit("process-step", {
          message: "AI Converting...",
          percent: Math.min(overallPercent, 95),
        });
      }
    })
    .on("end", async () => {
      const finalUrl = `/exports/${outputFileName}`;
      if (socketId)
        io.to(socketId).emit("process-step", {
          message: "✨ Optimization Complete!",
          percent: 100,
        });

      if (req.user) {
        const user = await User.findById(req.user._id);
        if (user) {
          user.projects = user.projects.filter((item) => item.fileUrl !== finalUrl);
          user.projects.push({
            toolType: "Video → Audio",
            fileName: videoFile,
            fileUrl: finalUrl,
            createdAt: new Date(),
          });
          user.projects = user.projects
            .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
            .slice(-10);
          await user.save();
        }
      }
      res.json({ success: true, audioUrl: finalUrl });
    })
    .on("error", (err) =>
      res.status(500).json({ success: false, message: err.message }),
    )
    .save(outputPath);
});


app.post("/api/community-feedback", async (req, res) => {
  try {
    const rating = Number(req.body?.rating || 0);
    const feedbackText = String(req.body?.feedback || "").trim();

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: "Rating must be between 1 and 5." });
    }
    if (!feedbackText) {
      return res.status(400).json({ success: false, message: "Feedback message is required." });
    }

    const isLoggedIn = Boolean(req.user);
    const record = await Feedback.create({
      userId: isLoggedIn ? req.user._id : null,
      username: isLoggedIn ? req.user.name || "MediaLab User" : "Anonymous",
      email: isLoggedIn ? req.user.email || "" : "",
      rating,
      feedback: feedbackText,
      source: String(req.body?.source || "web-builder"),
      isAnonymous: !isLoggedIn,
      status: "open",
      hidden: false,
    });
    await createUsageLog({
      ...buildUsageIdentity(req),
      action: "feedback-submitted",
      summary: "submitted community feedback",
      source: "community-feedback",
      metadata: { rating, feedbackId: record._id },
    });

    res.json({
      success: true,
      message: "Feedback saved successfully.",
      feedbackId: record._id,
    });
  } catch (error) {
    console.error("Feedback save failed:", error);
    res.status(500).json({ success: false, message: "Could not save feedback right now." });
  }
});

app.post("/api/upgrade-request", async (req, res) => {
  try {
    const isLoggedIn = Boolean(req.user);
    const fallbackName = isLoggedIn ? req.user.name || "MediaLab User" : "";
    const fallbackEmail = isLoggedIn ? req.user.email || "" : "";
    const name = String(req.body?.name || fallbackName).trim();
    const email = String(req.body?.email || fallbackEmail)
      .trim()
      .toLowerCase();
    const requestedFeature = String(
      req.body?.requestedFeature || "MediaLab Pro",
    ).trim();
    const message = String(req.body?.message || "").trim();

    if (!name) {
      return res
        .status(400)
        .json({ success: false, message: "Name is required." });
    }
    if (!email || !email.includes("@")) {
      return res
        .status(400)
        .json({ success: false, message: "A valid email is required." });
    }

    const activeStatuses = ["pending", "reviewing", "received"];
    const existingRequest = await UpgradeRequest.findOne({
      email,
      status: { $in: activeStatuses },
    })
      .sort({ createdAt: -1 })
      .lean();

    if (existingRequest) {
      return res.json({
        success: true,
        request: existingRequest,
        alreadyPending: true,
        message:
          "Pending. Your premium request is being processed. You'll get feedback within 48 hours.",
      });
    }

    const record = await UpgradeRequest.create({
      userId: isLoggedIn ? req.user._id : null,
      name,
      email,
      requestedFeature,
      source: String(req.body?.source || "studio-upgrade"),
      message,
      status: "pending",
    });
    await createUsageLog({
      ...buildUsageIdentity(req),
      email,
      name,
      isAnonymous: !req.user,
      action: "upgrade-request",
      summary: `requested ${requestedFeature}`,
      source: "upgrade-modal",
      metadata: { requestId: record._id, requestedFeature },
    });
    io.emit("admin:premium-request-updated", record.toObject());

    res.json({
      success: true,
      request: record,
      message:
        "Pending. Your premium request is being processed. You'll get feedback within 48 hours.",
      requestId: record._id,
    });
  } catch (error) {
    console.error("Upgrade request failed:", error);
    res.status(500).json({
      success: false,
      message: "Could not save your upgrade request right now.",
    });
  }
});

app.get("/api/upgrade-request/status", async (req, res) => {
  try {
    if (!req.user?.email) {
      return res.json({ success: true, request: null });
    }

    const request = await UpgradeRequest.findOne({
      $or: [{ userId: req.user._id }, { email: req.user.email.toLowerCase() }],
    })
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, request: request || null });
  } catch (error) {
    console.error("Upgrade request status fetch failed:", error);
    res
      .status(500)
      .json({ success: false, message: "Could not load upgrade request status." });
  }
});

app.get("/api/builder-drafts", async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Login required." });
    }
    const user = await User.findById(req.user._id).select("builderDrafts");
    res.json({
      success: true,
      drafts: user?.builderDrafts || [],
    });
  } catch (error) {
    console.error("Builder drafts fetch failed:", error);
    res.status(500).json({ success: false, message: "Could not fetch drafts." });
  }
});

app.post("/api/builder-drafts", async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Login required." });
    }

    const canvasHtml = String(req.body?.canvasHtml || "");
    const pageBackground = String(req.body?.pageBackground || "#ffffff");
    const isAutoSave = Boolean(req.body?.isAutoSave);
    const providedName = String(req.body?.name || "").trim();
    const draftName = providedName || (isAutoSave ? "Auto Draft" : `Builder Draft ${new Date().toLocaleString()}`);

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const nextDraft = {
      name: draftName,
      canvasHtml,
      pageBackground,
      isAutoSave,
      savedAt: new Date(),
    };

    if (isAutoSave) {
      const autosaveIndex = user.builderDrafts.findIndex((draft) => draft.isAutoSave);
      if (autosaveIndex >= 0) user.builderDrafts.splice(autosaveIndex, 1, nextDraft);
      else user.builderDrafts.push(nextDraft);
    } else {
      user.builderDrafts.push(nextDraft);
    }

    user.builderDrafts = user.builderDrafts
      .sort((a, b) => new Date(a.savedAt) - new Date(b.savedAt))
      .slice(-12);

    await user.save();
    await createUsageLog({
      ...buildUsageIdentity(req),
      action: isAutoSave ? "builder-autosave" : "builder-save",
      summary: `${isAutoSave ? "autosaved" : "saved"} builder draft ${draftName}`,
      source: "web-builder",
      metadata: { draftName, isAutoSave },
    });

    res.json({
      success: true,
      drafts: user.builderDrafts,
      savedDraft: user.builderDrafts[user.builderDrafts.length - 1] || nextDraft,
    });
  } catch (error) {
    console.error("Builder draft save failed:", error);
    res.status(500).json({ success: false, message: "Could not save draft." });
  }
});

app.get("/api/admin/feedbacks", async (_req, res) => {
  try {
    const feedbacks = await Feedback.find({}).sort({ createdAt: -1 }).lean();
    res.json({ success: true, feedbacks });
  } catch (error) {
    console.error("Admin feedback fetch failed:", error);
    res.status(500).json({ success: false, message: "Could not load feedbacks." });
  }
});

app.get("/api/admin/usage-logs", async (_req, res) => {
  try {
    const logs = await UsageLog.find({})
      .sort({ createdAt: -1 })
      .limit(1000)
      .lean({ virtuals: true });
    res.json({ success: true, logs });
  } catch (error) {
    console.error("Admin usage log fetch failed:", error);
    res
      .status(500)
      .json({ success: false, message: "Could not load usage logs." });
  }
});

app.get("/api/admin/upgrade-requests", async (_req, res) => {
  try {
    const requests = await UpgradeRequest.find({
      status: { $in: ["pending", "reviewing", "received"] },
    })
      .sort({ createdAt: -1 })
      .limit(300)
      .lean();
    res.json({ success: true, requests });
  } catch (error) {
    console.error("Admin upgrade request fetch failed:", error);
    res
      .status(500)
      .json({ success: false, message: "Could not load upgrade requests." });
  }
});

app.delete("/api/admin/usage-logs", async (_req, res) => {
  try {
    await UsageLog.deleteMany({});
    io.emit("admin:usage-log-cleared", {
      action: "logs-cleared",
      summary: "admin cleared usage logs",
      source: "admin",
      kind: "activity",
      createdAt: new Date().toISOString(),
      isAnonymous: true,
      isPro: false,
      email: "",
      name: "admin",
    });
    res.json({ success: true, message: "Usage logs cleared." });
  } catch (error) {
    console.error("Admin usage log clear failed:", error);
    res.status(500).json({ success: false, message: "Could not clear usage logs." });
  }
});

app.patch("/api/admin/feedbacks/:id", async (req, res) => {
  try {
    const updates = {};
    if (typeof req.body?.status === "string") {
      updates.status = req.body.status === "completed" ? "completed" : "open";
    }
    if (typeof req.body?.hidden === "boolean") {
      updates.hidden = req.body.hidden;
    }

    const feedback = await Feedback.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true },
    ).lean();

    if (!feedback) {
      return res.status(404).json({ success: false, message: "Feedback not found." });
    }

    res.json({ success: true, feedback });
  } catch (error) {
    console.error("Admin feedback update failed:", error);
    res.status(500).json({ success: false, message: "Could not update feedback." });
  }
});

app.patch("/api/admin/upgrade-requests/:id", async (req, res) => {
  try {
    const nextStatus = String(req.body?.status || "").trim().toLowerCase();
    if (!["granted", "denied", "reviewing", "pending"].includes(nextStatus)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid request status." });
    }

    const updates = {
      status: nextStatus,
      reviewedAt: new Date(),
      reviewedBy: "admin",
    };

    const request = await UpgradeRequest.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true },
    ).lean();

    if (!request) {
      return res
        .status(404)
        .json({ success: false, message: "Upgrade request not found." });
    }

    if (nextStatus === "granted") {
      await User.updateMany(
        {
          $or: [
            request.userId ? { _id: request.userId } : null,
            { email: request.email },
          ].filter(Boolean),
        },
        { $set: { isPro: true } },
      );
    } else if (nextStatus === "denied") {
      await User.updateMany(
        {
          $or: [
            request.userId ? { _id: request.userId } : null,
            { email: request.email },
          ].filter(Boolean),
        },
        { $set: { isPro: false } },
      );
    }

    await createUsageLog({
      email: request.email,
      name: request.name,
      isAnonymous: false,
      isPro: nextStatus === "granted",
      action: `premium-request-${nextStatus}`,
      summary: `${nextStatus} premium request for ${request.requestedFeature}`,
      source: "admin-premium-requests",
      metadata: { requestId: request._id, status: nextStatus },
    });
    io.emit("admin:premium-request-updated", request);

    res.json({ success: true, request });
  } catch (error) {
    console.error("Admin upgrade request update failed:", error);
    res
      .status(500)
      .json({ success: false, message: "Could not update premium request." });
  }
});

app.get("/api/admin/analytics", async (_req, res) => {
  try {
    const last30Days = new Date();
    last30Days.setDate(last30Days.getDate() - 30);
    const [
      totalUsers,
      proUsers,
      totalFeedbacks,
      openFeedbacks,
      completedFeedbacks,
      hiddenFeedbacks,
      totalUpgradeRequests,
      pendingUpgradeRequests,
      averageRatingRow,
      recentUsers,
      premiumRequests,
      totalUsageLogs,
      recentErrors,
      newUsers30d,
      newProUsers30d,
      newFeedbacks30d,
      newUsageLogs30d,
      newErrors30d,
      newUpgradeRequests30d,
      activeUpgradeRequests30d,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ isPro: true }),
      Feedback.countDocuments(),
      Feedback.countDocuments({ status: "open", hidden: false }),
      Feedback.countDocuments({ status: "completed" }),
      Feedback.countDocuments({ hidden: true }),
      UpgradeRequest.countDocuments({
        status: { $in: ["pending", "reviewing", "received"] },
      }),
      UpgradeRequest.countDocuments({
        status: { $in: ["pending", "reviewing", "received"] },
      }),
      Feedback.aggregate([{ $group: { _id: null, avgRating: { $avg: "$rating" } } }]),
      User.find({})
        .sort({ createdAt: -1 })
        .limit(8)
        .select("name email isPro createdAt profilePicture lastLogin location provider")
        .lean(),
      UpgradeRequest.find({})
        .sort({ createdAt: -1 })
        .limit(30)
        .lean(),
      UsageLog.countDocuments(),
      UsageLog.countDocuments({ kind: "error" }),
      User.countDocuments({ createdAt: { $gte: last30Days } }),
      User.countDocuments({ isPro: true, createdAt: { $gte: last30Days } }),
      Feedback.countDocuments({ createdAt: { $gte: last30Days } }),
      UsageLog.countDocuments({ createdAt: { $gte: last30Days } }),
      UsageLog.countDocuments({ kind: "error", createdAt: { $gte: last30Days } }),
      UpgradeRequest.countDocuments({ createdAt: { $gte: last30Days } }),
      UpgradeRequest.countDocuments({
        createdAt: { $gte: last30Days },
        status: { $in: ["pending", "reviewing", "received"] },
      }),
    ]);

    res.json({
      success: true,
      analytics: {
        totalUsers,
        proUsers,
        totalFeedbacks,
        openFeedbacks,
        completedFeedbacks,
        hiddenFeedbacks,
        totalUpgradeRequests,
        pendingUpgradeRequests,
        totalUsageLogs,
        recentErrors,
        last30Days: {
          newUsers: newUsers30d,
          newProUsers: newProUsers30d,
          feedbacks: newFeedbacks30d,
          usageLogs: newUsageLogs30d,
          errors: newErrors30d,
          upgradeRequests: activeUpgradeRequests30d,
        },
        averageRating: averageRatingRow?.[0]?.avgRating
          ? Number(averageRatingRow[0].avgRating.toFixed(1))
          : 0,
        recentUsers,
        premiumRequests,
      },
    });
  } catch (error) {
    console.error("Admin analytics fetch failed:", error);
    res.status(500).json({ success: false, message: "Could not load analytics." });
  }
});

io.on("connection", (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  logServerIssue("Uncaught exception", {
    message: error?.message || "Unknown error",
    stack: error?.stack || "",
  });
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
  logServerIssue("Unhandled rejection", {
    message: reason?.message || String(reason),
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () =>
  console.log(`🚀 MediaLab Server running on port ${PORT}`),
);
