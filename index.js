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
import { google } from "googleapis";

// Models & Routes
import authRoutes, {
  buildGithubClient,
  decryptGoogleRefreshToken,
  initializeGithubStorageForUser,
  toSafeUser,
} from "./routes/authRoutes.js";
import User from "./models/User.js";
import Feedback from "./models/Feedback.js";
import UpgradeRequest from "./models/UpgradeRequest.js";
import UsageLog from "./models/UsageLog.js";
import Download from "./models/Download.js";
import WithdrawalRequest from "./models/WithdrawalRequest.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure FFmpeg path
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const app = express();
const httpServer = createServer(app);

app.engine("ejs", (filePath, _options, callback) => {
  fs.readFile(filePath, "utf8", callback);
});
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

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

function slugifyProjectName(value = "medialab-page") {
  const slug = String(value || "")
    .toLowerCase()
    .trim()
    .replace(/\.html?$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "medialab-page"}.html`;
}

function escapeMetaContent(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildPublishedHtmlDocument({
  projectName = "MediaLab Project",
  htmlContent = "",
  cssContent = "",
  adsenseId = "",
  adsenseAdCode = "",
  description = "",
  keywords = "",
  includeRepoFavicon = true,
} = {}) {
  const safeTitle = String(projectName || "MediaLab Project").trim() || "MediaLab Project";
  const styleBlock = String(cssContent || "").trim();
  const bodyMarkup = String(htmlContent || "").trim();
  const safeDescription = escapeMetaContent(
    description || `${safeTitle} published with MediaLab.`,
  );
  const safeKeywords = escapeMetaContent(keywords || "MediaLab, website, publish");
  const trimmedAdCode = String(adsenseAdCode || "").trim();
  const adsenseTag =
    trimmedAdCode && /pagead2\.googlesyndication\.com/i.test(trimmedAdCode)
      ? `\n    ${trimmedAdCode}`
      : adsenseId && /^ca-pub-/i.test(String(adsenseId).trim())
      ? `\n    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${String(
          adsenseId,
        ).trim()}" crossorigin="anonymous"></script>`
      : "";
  const faviconTag = includeRepoFavicon
    ? `\n    <link rel="icon" href="favicon.ico" type="image/x-icon" />`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${safeTitle.replace(/[<>&"]/g, "")}</title>${faviconTag}
    <meta name="description" content="${safeDescription}" />
    <meta name="keywords" content="${safeKeywords}" />
    <meta property="og:title" content="${escapeMetaContent(safeTitle)}" />
    <meta property="og:description" content="${safeDescription}" />
    <meta property="og:type" content="website" />${adsenseTag}
    <style>
${styleBlock}
    </style>
  </head>
  <body>
${bodyMarkup}
  </body>
</html>`;
}

function normalizeAdsensePublisherId(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^ca-pub-\d+$/i.test(raw)) return raw;
  if (/^pub-\d+$/i.test(raw)) return `ca-${raw}`;
  if (/^\d+$/.test(raw)) return `ca-pub-${raw}`;
  return raw;
}

function sortLiveProjects(projects = []) {
  return [...projects].sort(
    (a, b) =>
      new Date(b.updatedAt || b.lastSyncedAt || b.createdAt || 0) -
      new Date(a.updatedAt || a.lastSyncedAt || a.createdAt || 0),
  );
}

function buildProjectLiveUrl(user, project = {}) {
  const filename = String(project?.fileName || project?.filename || "").trim();
  if (project?.liveUrl || project?.url) return project.liveUrl || project.url;
  if (!user?.githubUsername || !filename) return "";
  return `https://${user.githubUsername}.github.io/medialab/${filename}`;
}

function buildAdsTxtCandidateUrls(user) {
  if (!user?.githubUsername) return [];
  return [
    `https://${user.githubUsername}.github.io/medialab/ads.txt`,
    `https://${user.githubUsername}.github.io/ads.txt`,
  ];
}

function normalizeRenderUrl(url = "") {
  const raw = String(url || "").trim();
  if (!raw) return "";
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const parsed = new URL(withProtocol);
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function getAdsenseOAuthClient(user) {
  const refreshToken = decryptGoogleRefreshToken(user?.googleRefreshToken || "");
  if (!refreshToken) {
    throw new Error("Connect AdSense with Google first to load real-time stats.");
  }
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_URL,
  );
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

function collectHostedDomains(projects = []) {
  const urls = projects.flatMap((project) => [
    project?.renderUrl || "",
    project?.liveUrl || project?.url || "",
  ]);
  return [...new Set(
    urls
      .map((url) => {
        try {
          return new URL(url).hostname;
        } catch {
          return "";
        }
      })
      .filter(Boolean),
  )];
}

function isAllowedAdsenseProjectUrl(user, rawUrl = "") {
  const normalized = normalizeRenderUrl(rawUrl);
  if (!normalized) return false;
  const allowedUrls = new Set();
  const projects = Array.isArray(user?.liveProjects) ? user.liveProjects : [];
  projects.forEach((project) => {
    [project?.renderUrl, project?.liveUrl, project?.url].forEach((value) => {
      const candidate = normalizeRenderUrl(value || "");
      if (candidate) allowedUrls.add(candidate);
    });
  });
  if (allowedUrls.has(normalized)) return true;
  try {
    const parsed = new URL(normalized);
    if (
      user?.githubUsername &&
      parsed.hostname === `${user.githubUsername}.github.io` &&
      parsed.pathname.startsWith("/medialab/")
    ) {
      return true;
    }
  } catch {}
  return false;
}

function extractDomainNameFromUrl(url = "") {
  try {
    return new URL(String(url || "").trim()).hostname;
  } catch {
    return "";
  }
}

function detectAdsenseScript(html = "", adsenseId = "") {
  const source = String(html || "");
  if (!source) return false;
  const hasScript = /pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js/i.test(source);
  if (!hasScript) return false;
  if (!adsenseId) return true;
  return source.includes(String(adsenseId).trim());
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

app.post("/api/downloads", async (req, res) => {
  try {
    const type = String(req.body?.type || "pwa").trim() || "pwa";
    const source = String(req.body?.source || "web").trim() || "web";
    const platform = String(req.body?.platform || "").trim();
    const fallbackEmail = String(req.body?.email || "").trim().toLowerCase();
    const fallbackName = String(req.body?.name || "").trim();
    const fallbackIsPro = Boolean(req.body?.isPro);
    const hasFallbackIdentity = Boolean(fallbackEmail && fallbackName);
    const record = await Download.create({
      userId: req.user?._id || null,
      email: req.user?.email || fallbackEmail,
      name: req.user?.name || fallbackName,
      isAnonymous: req.user ? false : !hasFallbackIdentity,
      type,
      platform,
      source,
      metadata: req.body?.metadata || {},
    });

    io.emit("admin:download", record.toObject());

    await createUsageLog({
      user: req.user || null,
      email: req.user?.email || fallbackEmail,
      name: req.user?.name || fallbackName,
      isAnonymous: req.user ? false : !hasFallbackIdentity,
      isPro: Boolean(req.user?.isPro || fallbackIsPro),
      action: "pwa-download",
      summary: `downloaded ${type} on ${platform || "unknown platform"}`,
      source,
      metadata: { downloadId: record._id, type, platform },
    });

    res.json({ success: true, download: record });
  } catch (error) {
    console.error("Download record endpoint failed:", error);
    res.status(500).json({ success: false, message: "Could not save download." });
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
app.get("/", (_req, res) => {
  res.render("index");
});
app.get("/admin", (_req, res) => {
  res.render("admin");
});
const WEBSITE_TEMPLATE_VIEWS = {
  portfolio: "templates/portfolio",
  arcade: "templates/arcade",
  studio: "templates/studio",
};
app.get("/templates/:slug", (req, res) => {
  const view = WEBSITE_TEMPLATE_VIEWS[req.params.slug];
  if (!view) {
    return res.status(404).send("Template not found.");
  }
  return res.render(view);
});
app.use(express.static(path.join(__dirname, "client")));
app.use("/uploads", express.static(uploadDir));
app.use("/exports", express.static(exportDir));

// --- 4. API ROUTES ---
app.use("/api/auth", authRoutes);

app.post("/api/github/setup-repository", async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res
      .status(401)
      .json({ success: false, message: "You need to sign in first." });
  }

  try {
    const user = await User.findById(req.user._id).select("+githubToken +adsenseAdCode");
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }
    if (!user.githubUsername || !user.githubToken) {
      return res.status(400).json({
        success: false,
        message:
          "Connect your GitHub account first before setting up GitHub hosting.",
      });
    }

    const storage = await initializeGithubStorageForUser(user);
    req.user.githubRepoCreated = true;
    req.user.githubUsername = user.githubUsername;
    req.user.githubId = user.githubId;

    return res.json({
      success: true,
      message: "GitHub hosting is now active.",
      storage,
      user: {
        ...(typeof user.toObject === "function" ? user.toObject() : { ...user }),
        password: undefined,
        githubToken: undefined,
        githubConnected: Boolean(user.githubUsername),
      },
    });
  } catch (error) {
    console.error("GitHub setup repository failed:", error);
    const apiMessage =
      error?.response?.data?.message ||
      error?.message ||
      "GitHub hosting could not be initialized.";
    return res.status(error?.status || error?.response?.status || 500).json({
      success: false,
      message: apiMessage,
    });
  }
});

app.post("/api/github/publish", express.json({ limit: "10mb" }), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res
      .status(401)
      .json({ success: false, message: "You need to sign in first." });
  }

  try {
    const user = await User.findById(req.user._id).select("+githubToken");
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }
    if (!user.githubUsername || !user.githubToken) {
      return res.status(400).json({
        success: false,
        message: "Connect GitHub first before publishing to the web.",
      });
    }
    if (!user.githubRepoCreated) {
      return res.status(400).json({
        success: false,
        message: "Set up GitHub hosting first before publishing.",
      });
    }

    const projectName = String(req.body?.projectName || "").trim();
    const htmlContent = String(req.body?.htmlContent || "").trim();
    const cssContent = String(req.body?.cssContent || "").trim();
    const description = String(req.body?.description || "").trim();
    const keywords = String(req.body?.keywords || "").trim();

    if (!projectName) {
      return res.status(400).json({
        success: false,
        message: "Enter a project name before publishing.",
      });
    }
    if (!htmlContent) {
      return res.status(400).json({
        success: false,
        message: "This builder project is empty. Add some content before publishing.",
      });
    }

    const octokit = buildGithubClient(user);
    const owner = user.githubUsername;
    const repo = "medialab";
    const filename = slugifyProjectName(projectName);
    const fullHtml = buildPublishedHtmlDocument({
      projectName,
      htmlContent,
      cssContent,
      adsenseId: user.adsenseId || "",
      adsenseAdCode: user.adsenseAdCode || "",
      description,
      keywords,
    });
    const htmlSizeBytes = Buffer.byteLength(fullHtml, "utf8");
    const containsBase64Images = /data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(fullHtml);
    const warnings = [];
    if (containsBase64Images && htmlSizeBytes > 2 * 1024 * 1024) {
      warnings.push(
        "Large file warning: this single HTML export is over 2MB because it contains embedded base64 images. Upgrade to Pro image hosting for a lighter /assets-based publish flow.",
      );
    }

    let existingSha = "";
    try {
      const existing = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: filename,
      });
      if (!Array.isArray(existing.data) && existing.data?.sha) {
        existingSha = existing.data.sha;
      }
    } catch (error) {
      if ((error?.status || error?.response?.status) !== 404) {
        throw error;
      }
    }

    await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: filename,
      message: `${existingSha ? "Update" : "Publish"} ${filename} from MediaLab`,
      content: Buffer.from(fullHtml).toString("base64"),
      ...(existingSha ? { sha: existingSha } : {}),
    });

    const liveUrl = `https://${owner}.github.io/${repo}/${filename}`;
    const existingProject = user.liveProjects.find(
      (project) => String(project?.fileName || project?.filename || "") === filename,
    );
    const nextProject = {
      name: projectName,
      fileName: filename,
      filename,
      repo,
      url: liveUrl,
      liveUrl,
      status: "live",
      renderUrl: existingProject?.renderUrl || "",
      renderHostedConfirmed: Boolean(existingProject?.renderHostedConfirmed),
      renderVerifiedAt: existingProject?.renderVerifiedAt || null,
      adsensePublisherId: user.adsenseId || "",
      lastSyncedAt: new Date(),
      updatedAt: new Date(),
      createdAt: existingProject?.createdAt || new Date(),
    };

    user.liveProjects = Array.isArray(user.liveProjects) ? user.liveProjects : [];
    user.liveProjects = user.liveProjects.filter(
      (project) => String(project?.fileName || project?.filename || "") !== filename,
    );
    user.liveProjects.push(nextProject);
    await user.save();

    req.user.liveProjects = user.liveProjects;

    await createUsageLog({
      user,
      email: user.email,
      name: user.name,
      isPro: Boolean(user.isPro),
      action: "github-publish",
      summary: `published ${filename} to GitHub Pages`,
      source: "github",
      metadata: { projectName, filename, liveUrl },
    });

    return res.json({
      success: true,
      message: "Project published successfully.",
      liveProject: nextProject,
      liveUrl,
      needsHostingOnboarding: !nextProject.renderHostedConfirmed,
      warnings,
      sizeBytes: htmlSizeBytes,
      user: toSafeUser(user),
    });
  } catch (error) {
    console.error("GitHub publish failed:", error);
    const apiMessage =
      error?.response?.data?.message ||
      error?.message ||
      "Could not publish this project to GitHub right now.";
    return res.status(error?.status || error?.response?.status || 500).json({
      success: false,
      message: apiMessage,
    });
  }
});

app.get("/api/github/projects", async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res
      .status(401)
      .json({ success: false, message: "You need to sign in first." });
  }

  try {
    const user = await User.findById(req.user._id).select("+githubToken");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    user.liveProjects = Array.isArray(user.liveProjects) ? user.liveProjects : [];
    if (user.githubUsername && user.githubToken && user.githubRepoCreated && user.liveProjects.length) {
      const octokit = buildGithubClient(user);
      const verified = await Promise.all(
        user.liveProjects.map(async (project) => {
          const fileName = String(project?.fileName || project?.filename || "").trim();
          if (!fileName) return null;
          try {
            await octokit.rest.repos.getContent({
              owner: user.githubUsername,
              repo: "medialab",
              path: fileName,
            });
            return project;
          } catch (error) {
            if ((error?.status || error?.response?.status) === 404) {
              return null;
            }
            throw error;
          }
        }),
      );
      const nextProjects = verified.filter(Boolean);
      if (nextProjects.length !== user.liveProjects.length) {
        user.liveProjects = nextProjects;
        await user.save();
      }
    }

    req.user.liveProjects = user.liveProjects;
    return res.json({
      success: true,
      projects: sortLiveProjects(user.liveProjects),
      user: toSafeUser(user),
    });
  } catch (error) {
    console.error("GitHub projects fetch failed:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Could not load live projects right now.",
    });
  }
});

app.get("/api/github/project-content", async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res
      .status(401)
      .json({ success: false, message: "You need to sign in first." });
  }

  try {
    const filename = String(req.query?.filename || "").trim();
    if (!filename) {
      return res.status(400).json({
        success: false,
        message: "Missing filename.",
      });
    }
    const user = await User.findById(req.user._id).select("+githubToken");
    if (!user || !user.githubUsername || !user.githubToken) {
      return res.status(400).json({
        success: false,
        message: "GitHub is not connected for this account.",
      });
    }

    const octokit = buildGithubClient(user);
    const contentResponse = await octokit.rest.repos.getContent({
      owner: user.githubUsername,
      repo: "medialab",
      path: filename,
    });
    if (Array.isArray(contentResponse.data) || !contentResponse.data?.content) {
      return res.status(400).json({
        success: false,
        message: "That GitHub file could not be opened as HTML content.",
      });
    }

    return res.json({
      success: true,
      filename,
      content: Buffer.from(contentResponse.data.content, "base64").toString("utf8"),
    });
  } catch (error) {
    console.error("GitHub project content fetch failed:", error);
    return res.status(error?.status || error?.response?.status || 500).json({
      success: false,
      message: error?.message || "Could not load that project code right now.",
    });
  }
});

app.delete("/api/github/project", async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res
      .status(401)
      .json({ success: false, message: "You need to sign in first." });
  }

  try {
    const filename = String(req.query?.filename || "").trim();
    if (!filename) {
      return res.status(400).json({
        success: false,
        message: "Missing filename.",
      });
    }

    const user = await User.findById(req.user._id).select("+githubToken");
    if (!user || !user.githubUsername || !user.githubToken) {
      return res.status(400).json({
        success: false,
        message: "GitHub is not connected for this account.",
      });
    }

    const octokit = buildGithubClient(user);
    const contentResponse = await octokit.rest.repos.getContent({
      owner: user.githubUsername,
      repo: "medialab",
      path: filename,
    });
    if (Array.isArray(contentResponse.data) || !contentResponse.data?.sha) {
      return res.status(400).json({
        success: false,
        message: "That published file could not be deleted cleanly.",
      });
    }

    await octokit.rest.repos.deleteFile({
      owner: user.githubUsername,
      repo: "medialab",
      path: filename,
      sha: contentResponse.data.sha,
      message: `Delete ${filename} from MediaLab`,
    });

    user.liveProjects = Array.isArray(user.liveProjects) ? user.liveProjects : [];
    user.liveProjects = user.liveProjects.filter(
      (project) => String(project?.fileName || project?.filename || "").trim() !== filename,
    );
    await user.save();
    req.user.liveProjects = user.liveProjects;

    await createUsageLog({
      user,
      email: user.email,
      name: user.name,
      isPro: Boolean(user.isPro),
      action: "github-delete",
      summary: `deleted ${filename} from GitHub Pages`,
      source: "github",
      metadata: { filename },
    });

    return res.json({
      success: true,
      message: "Live project deleted.",
      projects: sortLiveProjects(user.liveProjects),
      user: toSafeUser(user),
    });
  } catch (error) {
    console.error("GitHub project delete failed:", error);
    return res.status(error?.status || error?.response?.status || 500).json({
      success: false,
      message: error?.message || "Could not delete that live project right now.",
    });
  }
});

const githubSettingsUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 512 * 1024 },
});

app.post(
  "/api/github/settings",
  githubSettingsUpload.single("favicon"),
  async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res
        .status(401)
        .json({ success: false, message: "You need to sign in first." });
    }

    try {
      const user = await User.findById(req.user._id).select("+githubToken");
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found." });
      }

      const nextAdsenseId = normalizeAdsensePublisherId(req.body?.adsenseId || "");
      if (nextAdsenseId && !/^ca-pub-\d+$/i.test(nextAdsenseId)) {
        return res.status(400).json({
          success: false,
          message: "Enter a valid Google AdSense publisher ID.",
        });
      }

      user.adsenseId = nextAdsenseId;
      let faviconUpdated = false;

      if (req.file) {
        if (!user.githubUsername || !user.githubToken || !user.githubRepoCreated) {
          return res.status(400).json({
            success: false,
            message:
              "Set up GitHub hosting first before uploading a favicon to your live projects.",
          });
        }
        const octokit = buildGithubClient(user);
        let existingSha = "";
        try {
          const existing = await octokit.rest.repos.getContent({
            owner: user.githubUsername,
            repo: "medialab",
            path: "favicon.ico",
          });
          if (!Array.isArray(existing.data) && existing.data?.sha) {
            existingSha = existing.data.sha;
          }
        } catch (error) {
          if ((error?.status || error?.response?.status) !== 404) throw error;
        }

        await octokit.rest.repos.createOrUpdateFileContents({
          owner: user.githubUsername,
          repo: "medialab",
          path: "favicon.ico",
          message: `${existingSha ? "Update" : "Upload"} favicon.ico from MediaLab`,
          content: req.file.buffer.toString("base64"),
          ...(existingSha ? { sha: existingSha } : {}),
        });
        user.faviconFileName = "favicon.ico";
        faviconUpdated = true;
      }

      await user.save();
      req.user.adsenseId = user.adsenseId;
      req.user.faviconFileName = user.faviconFileName;

      return res.json({
        success: true,
        message: faviconUpdated
          ? "Studio settings saved and favicon uploaded."
          : "Studio settings saved.",
        faviconUpdated,
        user: toSafeUser(user),
      });
    } catch (error) {
      console.error("GitHub settings save failed:", error);
      return res.status(error?.status || error?.response?.status || 500).json({
        success: false,
        message:
          error?.response?.data?.message ||
          error?.message ||
          "Could not save Studio settings right now.",
      });
    }
  },
);

app.post("/api/github/setup-adsense", express.json(), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res
      .status(401)
      .json({ success: false, message: "You need to sign in first." });
  }

  try {
    const user = await User.findById(req.user._id).select("+githubToken");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    if (!user.githubUsername || !user.githubToken || !user.githubRepoCreated) {
      return res.status(400).json({
        success: false,
        message: "Set up GitHub hosting first before generating ads.txt.",
      });
    }
    const adsenseId = normalizeAdsensePublisherId(req.body?.adsenseId || user.adsenseId || "");
    if (!/^ca-pub-\d+$/i.test(adsenseId)) {
      return res.status(400).json({
        success: false,
        message: "Add a valid AdSense publisher ID in Studio Settings first.",
      });
    }

    user.adsenseId = adsenseId;
    const publisherValue = adsenseId.replace(/^ca-/i, "");
    const octokit = buildGithubClient(user);
    let existingSha = "";
    try {
      const existing = await octokit.rest.repos.getContent({
        owner: user.githubUsername,
        repo: "medialab",
        path: "ads.txt",
      });
      if (!Array.isArray(existing.data) && existing.data?.sha) {
        existingSha = existing.data.sha;
      }
    } catch (error) {
      if ((error?.status || error?.response?.status) !== 404) throw error;
    }

    const adsTxtContent = `google.com, ${publisherValue}, DIRECT, f08c47fec0942fa0\n`;
    await octokit.rest.repos.createOrUpdateFileContents({
      owner: user.githubUsername,
      repo: "medialab",
      path: "ads.txt",
      message: `${existingSha ? "Update" : "Create"} ads.txt from MediaLab`,
      content: Buffer.from(adsTxtContent).toString("base64"),
      ...(existingSha ? { sha: existingSha } : {}),
    });

    await user.save();
    req.user.adsenseId = user.adsenseId;

    return res.json({
      success: true,
      message: "ads.txt is live in your medialab repository.",
      user: toSafeUser(user),
    });
  } catch (error) {
    console.error("GitHub AdSense setup failed:", error);
    return res.status(error?.status || error?.response?.status || 500).json({
      success: false,
      message:
        error?.response?.data?.message ||
        error?.message ||
        "Could not set up ads.txt right now.",
    });
  }
});

app.get("/api/github/project-health", async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res
      .status(401)
      .json({ success: false, message: "You need to sign in first." });
  }

  try {
    const url = String(req.query?.url || "").trim();
    if (!url) {
      return res.status(400).json({ success: false, message: "Missing live URL." });
    }
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": "MediaLab-Health-Check" },
    });
    return res.json({
      success: true,
      ok: response.status < 400,
      status: response.status,
      url,
    });
  } catch (error) {
    return res.json({
      success: true,
      ok: false,
      status: 0,
      url: String(req.query?.url || "").trim(),
      message: error?.message || "Health check failed.",
    });
  }
});

app.get("/api/github/project-monitor", async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res
      .status(401)
      .json({ success: false, message: "You need to sign in first." });
  }

  try {
    const filename = String(req.query?.filename || "").trim();
    if (!filename) {
      return res.status(400).json({ success: false, message: "Missing filename." });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const project = (Array.isArray(user.liveProjects) ? user.liveProjects : []).find(
      (item) => String(item?.fileName || item?.filename || "").trim() === filename,
    );
    if (!project) {
      return res.status(404).json({ success: false, message: "Live project not found." });
    }

    const liveUrl = buildProjectLiveUrl(user, project);
    const health = {
      ok: false,
      status: 0,
      state: "offline",
      label: "Offline",
    };
    let html = "";
    try {
      const response = await fetch(liveUrl, {
        method: "GET",
        redirect: "follow",
        headers: { "User-Agent": "MediaLab-Project-Monitor" },
      });
      health.ok = response.status < 400;
      health.status = response.status;
      health.state = response.status < 400 ? "online" : response.status >= 500 ? "offline" : "deploying";
      health.label =
        response.status < 400 ? "System Online" : response.status >= 500 ? "Offline" : "Deploying";
      html = await response.text();
    } catch (error) {
      health.ok = false;
      health.status = 0;
      health.state = "offline";
      health.label = "Offline";
    }

    const adsDetected = detectAdsenseScript(html, user.adsenseId || project.adsensePublisherId || "");

    let adsTxtVerified = false;
    let adsTxtUrl = "";
    for (const candidateUrl of buildAdsTxtCandidateUrls(user)) {
      try {
        const response = await fetch(candidateUrl, {
          method: "GET",
          redirect: "follow",
          headers: { "User-Agent": "MediaLab-AdsTxt-Verify" },
        });
        if (response.status < 400) {
          adsTxtVerified = true;
          adsTxtUrl = candidateUrl;
          break;
        }
      } catch {}
    }
    if (!adsTxtUrl) {
      adsTxtUrl = buildAdsTxtCandidateUrls(user)[0] || "";
    }

    return res.json({
      success: true,
      project: {
        ...(typeof project.toObject === "function" ? project.toObject() : { ...project }),
        liveUrl,
      },
      health,
      adsDetected,
      adsTxtVerified,
      adsTxtUrl,
      monetizationApproved: Boolean(adsDetected && adsTxtVerified && user.adsenseId),
      adsenseId: user.adsenseId || "",
    });
  } catch (error) {
    console.error("GitHub project monitor failed:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Could not load project monitor right now.",
    });
  }
});

app.post("/api/github/verify-render-hosting", express.json(), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res
      .status(401)
      .json({ success: false, message: "You need to sign in first." });
  }

  try {
    const filename = String(req.body?.filename || "").trim();
    const normalizedRenderUrl = normalizeRenderUrl(req.body?.renderUrl || "");
    if (!filename || !normalizedRenderUrl) {
      return res.status(400).json({
        success: false,
        message: "Project file and Render URL are required.",
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    user.liveProjects = Array.isArray(user.liveProjects) ? user.liveProjects : [];
    const projectIndex = user.liveProjects.findIndex(
      (item) => String(item?.fileName || item?.filename || "").trim() === filename,
    );
    if (projectIndex < 0) {
      return res.status(404).json({
        success: false,
        message: "Live project not found for Render verification.",
      });
    }

    let response;
    try {
      response = await fetch(normalizedRenderUrl, {
        method: "GET",
        redirect: "follow",
        headers: { "User-Agent": "MediaLab-Render-Verify" },
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: "Render URL could not be reached yet. Finish hosting and try verify again.",
      });
    }

    if (response.status >= 400) {
      return res.status(400).json({
        success: false,
        message: `Render site responded with ${response.status}. Publish it on Render first, then verify again.`,
      });
    }

    const project = user.liveProjects[projectIndex];
    project.renderUrl = normalizedRenderUrl;
    project.renderHostedConfirmed = true;
    project.renderVerifiedAt = new Date();
    project.updatedAt = new Date();

    if (!user.confirmedFirstHosting) {
      user.confirmedFirstHosting = true;
      user.firstHostingConfirmedAt = new Date();
    }

    await user.save();
    req.user.liveProjects = user.liveProjects;

    await createUsageLog({
      user,
      email: user.email,
      name: user.name,
      isPro: Boolean(user.isPro),
      action: "render-hosting-verified",
      summary: `verified Render hosting for ${filename}`,
      source: "render",
      metadata: { filename, renderUrl: normalizedRenderUrl },
    });

    return res.json({
      success: true,
      message: "Render hosting verified successfully.",
      project: user.liveProjects[projectIndex],
      user: toSafeUser(user),
    });
  } catch (error) {
    console.error("Render hosting verification failed:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Could not verify Render hosting right now.",
    });
  }
});

app.post("/api/adsense/link-site", express.json(), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res
      .status(401)
      .json({ success: false, message: "You need to sign in first." });
  }

  try {
    const liveProjectUrl = normalizeRenderUrl(req.body?.liveProjectUrl || "");
    if (!liveProjectUrl) {
      return res.status(400).json({
        success: false,
        message: "Enter your live project URL first.",
      });
    }

    const user = await User.findById(req.user._id).select("+googleRefreshToken +adsenseAdCode");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    if (!user.googleRefreshToken) {
      return res.status(400).json({
        success: false,
        requiresGoogleReconnect: true,
        message: "Reconnect Google first so MediaLab can read your AdSense data.",
      });
    }
    if (!isAllowedAdsenseProjectUrl(user, liveProjectUrl)) {
      return res.status(403).json({
        success: false,
        message: "That URL is not recognized as one of your MediaLab projects.",
      });
    }

    const domainName = extractDomainNameFromUrl(liveProjectUrl);
    const auth = getAdsenseOAuthClient(user);
    const adsense = google.adsense({ version: "v2", auth });
    const accountsResponse = await adsense.accounts.list();
    const accounts = accountsResponse.data?.accounts || [];

    let matchedAccount = null;
    let matchedSite = null;
    for (const account of accounts) {
      const sitesResponse = await adsense.accounts.sites.list({
        parent: account.name,
        pageSize: 200,
      });
      const sites = sitesResponse.data?.sites || [];
      matchedSite = sites.find((site) => {
        const siteUrl =
          site.siteUrl || site.url || site.domain || site.reportingDimensionId || "";
        const siteDomain = extractDomainNameFromUrl(siteUrl) || String(siteUrl).trim();
        return siteDomain === domainName;
      });
      if (matchedSite) {
        matchedAccount = account;
        break;
      }
    }

    if (!matchedAccount || !matchedSite) {
      return res.status(404).json({
        success: false,
        message:
          "We couldn't find this URL in your AdSense account. Make sure you've added this site in your AdSense dashboard under Sites.",
      });
    }

    const adClientsResponse = await adsense.accounts.adclients.list({
      parent: matchedAccount.name,
      pageSize: 50,
    });
    const adClients = adClientsResponse.data?.adClients || [];
    const matchedAdClient =
      adClients.find((client) =>
        String(client.productCode || "").toUpperCase().includes("AFC"),
      ) || adClients[0] || null;

    let adCode = "";
    if (matchedAdClient?.name) {
      const adCodeResponse = await adsense.accounts.adclients.getAdcode({
        name: matchedAdClient.name,
      });
      adCode = String(adCodeResponse.data?.adCode || "").trim();
    }

    const adsenseIdMatch = adCode.match(/ca-pub-\d+/i);
    if (adsenseIdMatch?.[0]) {
      user.adsenseId = normalizeAdsensePublisherId(adsenseIdMatch[0]);
    }
    user.adsenseAccountName = matchedAccount.name || "";
    user.adsenseSiteUrl =
      matchedSite.siteUrl || matchedSite.url || matchedSite.domain || liveProjectUrl;
    user.adsenseSiteStatus =
      matchedSite.state || matchedSite.status || matchedSite.platformType || "";
    if (adCode) {
      user.adsenseAdCode = adCode;
    }
    await user.save();

    let adsTxtDetected = false;
    for (const candidateUrl of buildAdsTxtCandidateUrls(user)) {
      try {
        const response = await fetch(candidateUrl, {
          method: "GET",
          redirect: "follow",
          headers: { "User-Agent": "MediaLab-AdsTxt-Verify" },
        });
        if (response.status < 400) {
          adsTxtDetected = true;
          break;
        }
      } catch {}
    }

    const siteState = String(user.adsenseSiteStatus || "").toUpperCase();
    const reviewPending =
      siteState === "REQUIRES_REVIEW" || siteState === "GETTING_READY";

    return res.json({
      success: true,
      message: `Success! We found your AdSense account ${user.adsenseId || ""}.`,
      accountName: user.adsenseAccountName,
      adsenseId: user.adsenseId,
      siteUrl: user.adsenseSiteUrl,
      siteStatus: user.adsenseSiteStatus,
      checklist: {
        scriptInjectedAutomatic: Boolean(user.adsenseAdCode || user.adsenseId),
        adsTxtDetected,
        googleReviewPending: reviewPending,
      },
      user: toSafeUser(user),
    });
  } catch (error) {
    console.error("AdSense link-site failed:", error);
    return res.status(500).json({
      success: false,
      message:
        error?.response?.data?.error?.message ||
        error?.message ||
        "Could not link your AdSense site right now.",
    });
  }
});

app.get("/api/adsense/report", async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res
      .status(401)
      .json({ success: false, message: "You need to sign in first." });
  }

  try {
    const user = await User.findById(req.user._id).select("+googleRefreshToken");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const refreshToken = decryptGoogleRefreshToken(user.googleRefreshToken || "");
    if (!refreshToken) {
      return res.json({
        success: true,
        connected: false,
        message: "Connect AdSense for real-time stats.",
      });
    }

    const targetUrl =
      String(req.query?.url || "").trim() ||
      String(
        user.liveProjects?.find((project) => project?.renderHostedConfirmed)?.renderUrl ||
          user.liveProjects?.[0]?.renderUrl ||
          user.liveProjects?.[0]?.liveUrl ||
          user.liveProjects?.[0]?.url ||
          "",
      ).trim();
    const domainName = extractDomainNameFromUrl(targetUrl);
    if (!domainName) {
      return res.json({
        success: true,
        connected: true,
        hasDomain: false,
        message: "Publish and host a project first to fetch domain-based AdSense stats.",
      });
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_CALLBACK_URL,
    );
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    const adsense = google.adsense({
      version: "v2",
      auth: oauth2Client,
    });

    const accountsResponse = await adsense.accounts.list();
    const accountName = accountsResponse.data?.accounts?.[0]?.name;
    if (!accountName) {
      return res.status(400).json({
        success: false,
        message: "No AdSense account was found for this Google profile.",
      });
    }

    const reportResponse = await adsense.accounts.reports.generate({
      account: accountName,
      dateRange: "LAST_7_DAYS",
      metrics: [
        "ESTIMATED_EARNINGS",
        "IMPRESSIONS",
        "PAGE_VIEWS_RPM",
        "CLICKS",
      ],
      dimensions: ["DOMAIN_NAME"],
      filters: [`DOMAIN_NAME==${domainName}`],
      languageCode: "en",
    });

    const headers = reportResponse.data?.headers || [];
    const row = reportResponse.data?.rows?.[0]?.cells || [];
    const readMetric = (name) => {
      const index = headers.findIndex(
        (header) => String(header?.name || "").toUpperCase() === name,
      );
      return index >= 0 ? row[index]?.value || row[index] || "0" : "0";
    };

    return res.json({
      success: true,
      connected: true,
      hasDomain: true,
      domainName,
      report: {
        estimatedEarnings: readMetric("ESTIMATED_EARNINGS"),
        impressions: readMetric("IMPRESSIONS"),
        pageViewsRpm: readMetric("PAGE_VIEWS_RPM"),
        clicks: readMetric("CLICKS"),
      },
    });
  } catch (error) {
    console.error("AdSense report failed:", error);
    return res.status(500).json({
      success: false,
      message:
        error?.response?.data?.error?.message ||
        error?.message ||
        "Could not load AdSense report right now.",
    });
  }
});

app.get("/api/adsense/report", async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res
      .status(401)
      .json({ success: false, message: "You need to sign in first." });
  }

  try {
    const user = await User.findById(req.user._id).select("+googleRefreshToken");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    if (!user.googleRefreshToken) {
      return res.json({
        success: true,
        connected: false,
        stats: null,
        domains: [],
        message: "Connect AdSense for real-time stats.",
      });
    }

    const domains = collectHostedDomains(user.liveProjects || []);
    if (!domains.length) {
      return res.json({
        success: true,
        connected: true,
        stats: {
          estimatedEarnings: 0,
          impressions: 0,
          pageViewsRpm: 0,
          clicks: 0,
        },
        domains: [],
        message: "Publish and host a project first to start matching AdSense domains.",
      });
    }

    const auth = getAdsenseOAuthClient(user);
    const adsense = google.adsense({ version: "v2", auth });
    const accountResponse = await adsense.accounts.list({ pageSize: 1 });
    const accountName = accountResponse.data?.accounts?.[0]?.name;
    if (!accountName) {
      return res.json({
        success: true,
        connected: true,
        stats: {
          estimatedEarnings: 0,
          impressions: 0,
          pageViewsRpm: 0,
          clicks: 0,
        },
        domains,
        message: "No AdSense account was returned for this Google connection yet.",
      });
    }

    const metrics = [
      "ESTIMATED_EARNINGS",
      "IMPRESSIONS",
      "PAGE_VIEWS_RPM",
      "CLICKS",
    ];

    const aggregate = {
      estimatedEarnings: 0,
      impressions: 0,
      pageViewsRpm: 0,
      clicks: 0,
    };
    let rpmSamples = 0;

    for (const domain of domains.slice(0, 10)) {
      const report = await adsense.accounts.reports.generate({
        account: accountName,
        dateRange: "LAST_7_DAYS",
        dimensions: ["DOMAIN_NAME"],
        metrics,
        filters: [`DOMAIN_NAME==${domain}`],
        languageCode: "en",
        limit: 1,
      });

      const totals = report.data?.totals?.cells || report.data?.rows?.[0]?.cells || [];
      const metricCells = totals.slice(-metrics.length);
      if (metricCells.length < metrics.length) continue;

      aggregate.estimatedEarnings += Number(metricCells[0]?.value || 0);
      aggregate.impressions += Number(metricCells[1]?.value || 0);
      aggregate.pageViewsRpm += Number(metricCells[2]?.value || 0);
      aggregate.clicks += Number(metricCells[3]?.value || 0);
      rpmSamples += 1;
    }

    if (rpmSamples > 0) {
      aggregate.pageViewsRpm = aggregate.pageViewsRpm / rpmSamples;
    }

    return res.json({
      success: true,
      connected: true,
      stats: {
        estimatedEarnings: Number(aggregate.estimatedEarnings.toFixed(2)),
        impressions: Math.round(aggregate.impressions),
        pageViewsRpm: Number(aggregate.pageViewsRpm.toFixed(2)),
        clicks: Math.round(aggregate.clicks),
      },
      domains,
      accountName,
      message: "Real-time AdSense stats loaded.",
    });
  } catch (error) {
    console.error("AdSense report fetch failed:", error);
    return res.status(500).json({
      success: false,
      message:
        error?.response?.data?.error?.message ||
        error?.message ||
        "Could not load AdSense stats right now.",
    });
  }
});

app.get("/api/github/verify-ads-txt", async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res
      .status(401)
      .json({ success: false, message: "You need to sign in first." });
  }

  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    let verified = false;
    let resolvedUrl = "";
    for (const candidateUrl of buildAdsTxtCandidateUrls(user)) {
      try {
        const response = await fetch(candidateUrl, {
          method: "GET",
          redirect: "follow",
          headers: { "User-Agent": "MediaLab-AdsTxt-Verify" },
        });
        if (response.status < 400) {
          verified = true;
          resolvedUrl = candidateUrl;
          break;
        }
      } catch {}
    }
    if (!resolvedUrl) {
      resolvedUrl = buildAdsTxtCandidateUrls(user)[0] || "";
    }

    return res.json({
      success: true,
      verified,
      url: resolvedUrl,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Could not verify ads.txt right now.",
    });
  }
});

app.post(
  "/api/github/upload-ads-txt",
  githubSettingsUpload.single("adsFile"),
  async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res
        .status(401)
        .json({ success: false, message: "You need to sign in first." });
    }

    try {
      const user = await User.findById(req.user._id).select("+githubToken");
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found." });
      }
      if (!user.githubUsername || !user.githubToken || !user.githubRepoCreated) {
        return res.status(400).json({
          success: false,
          message: "Set up GitHub hosting first before uploading ads.txt.",
        });
      }

      const nextAdsenseId = normalizeAdsensePublisherId(req.body?.adsenseId || user.adsenseId || "");
      if (nextAdsenseId && !/^ca-pub-\d+$/i.test(nextAdsenseId)) {
        return res.status(400).json({
          success: false,
          message: "Enter a valid Google AdSense publisher ID.",
        });
      }
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "Upload the ads.txt file from Google first.",
        });
      }

      const octokit = buildGithubClient(user);
      let existingSha = "";
      try {
        const existing = await octokit.rest.repos.getContent({
          owner: user.githubUsername,
          repo: "medialab",
          path: "ads.txt",
        });
        if (!Array.isArray(existing.data) && existing.data?.sha) {
          existingSha = existing.data.sha;
        }
      } catch (error) {
        if ((error?.status || error?.response?.status) !== 404) throw error;
      }

      await octokit.rest.repos.createOrUpdateFileContents({
        owner: user.githubUsername,
        repo: "medialab",
        path: "ads.txt",
        message: `${existingSha ? "Update" : "Upload"} ads.txt from MediaLab`,
        content: req.file.buffer.toString("base64"),
        ...(existingSha ? { sha: existingSha } : {}),
      });

      user.adsenseId = nextAdsenseId;
      await user.save();
      req.user.adsenseId = user.adsenseId;

      return res.json({
        success: true,
        message: "ads.txt uploaded to your medialab repository.",
        user: toSafeUser(user),
        adsTxtUrl: buildAdsTxtCandidateUrls(user)[0] || "",
      });
    } catch (error) {
      console.error("GitHub ads.txt upload failed:", error);
      return res.status(error?.status || error?.response?.status || 500).json({
        success: false,
        message:
          error?.response?.data?.message ||
          error?.message ||
          "Could not upload ads.txt right now.",
      });
    }
  },
);

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

app.post("/api/account/cancel-premium", async (req, res) => {
  try {
    if (!req.user?._id) {
      return res.status(401).json({ success: false, message: "Login required." });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    user.isPro = false;
    await user.save();

    await UpgradeRequest.findOneAndUpdate(
      {
        $or: [{ userId: req.user._id }, { email: String(user.email || "").toLowerCase() }],
        status: "granted",
      },
      {
        $set: {
          status: "closed",
          reviewedAt: new Date(),
          reviewedBy: "user-cancelled",
        },
      },
      { sort: { createdAt: -1 } },
    );

    await createUsageLog({
      ...buildUsageIdentity(req),
      action: "premium-cancelled",
      summary: "cancelled premium plan",
      source: "profile",
    });

    res.json({ success: true, isPro: false });
  } catch (error) {
    console.error("Cancel premium failed:", error);
    res.status(500).json({ success: false, message: "Could not cancel premium right now." });
  }
});

app.post("/api/account/withdrawals", async (req, res) => {
  try {
    if (!req.user?._id) {
      return res.status(401).json({ success: false, message: "Login required." });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const method = String(req.body?.method || "").trim().toLowerCase();
    const amount = Number(req.body?.amount || 0);
    const destination = String(req.body?.destination || "").trim();
    const allowedMethods = ["paypal", "mpesa", "airtel"];

    if (!allowedMethods.includes(method)) {
      return res.status(400).json({ success: false, message: "Select a valid withdrawal method." });
    }
    if (!destination) {
      return res.status(400).json({ success: false, message: "Payment destination is required." });
    }
    if (!Number.isFinite(amount) || amount < 5) {
      return res.status(400).json({ success: false, message: "Minimum withdrawal is $5." });
    }
    if (amount > Number(user.accountBalance || 0)) {
      return res.status(400).json({ success: false, message: "Withdrawal amount exceeds available balance." });
    }

    const now = Date.now();
    const recentLock = user.lastWithdrawalRequestedAt
      ? now - new Date(user.lastWithdrawalRequestedAt).getTime()
      : Number.POSITIVE_INFINITY;
    if (recentLock < 15000) {
      return res.status(429).json({
        success: false,
        message: "Please wait a few seconds before submitting another withdrawal.",
      });
    }

    const pendingExisting = await WithdrawalRequest.findOne({
      userId: user._id,
      status: { $in: ["pending", "processing"] },
      createdAt: { $gte: new Date(now - 120000) },
    }).lean();
    if (pendingExisting) {
      return res.status(429).json({
        success: false,
        message: "A withdrawal request is already being processed. Please wait.",
      });
    }

    const fee = 0;
    const request = await WithdrawalRequest.create({
      userId: user._id,
      email: user.email,
      name: user.name,
      method,
      destination,
      amount,
      fee,
      status: "pending",
      metadata: {
        provider: user.provider || "unknown",
      },
    });

    user.accountBalance = Number((Number(user.accountBalance || 0) - amount).toFixed(2));
    user.lastWithdrawalRequestedAt = new Date(now);
    await user.save();
    req.user.accountBalance = user.accountBalance;
    req.user.lastWithdrawalRequestedAt = user.lastWithdrawalRequestedAt;

    await createUsageLog({
      ...buildUsageIdentity(req),
      action: "withdrawal-request",
      summary: `requested ${amount.toFixed(2)} withdrawal via ${method}`,
      source: "account",
      metadata: { withdrawalRequestId: request._id, method, amount },
    });

    res.json({
      success: true,
      message: "Withdrawal request submitted",
      balance: user.accountBalance,
      request,
    });
  } catch (error) {
    console.error("Withdrawal request failed:", error);
    res.status(500).json({ success: false, message: "Could not submit withdrawal request right now." });
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
      .slice(-10);

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

app.get("/api/admin/downloads", async (_req, res) => {
  try {
    const downloads = await Download.find({})
      .sort({ createdAt: -1 })
      .limit(300)
      .lean();
    res.json({ success: true, downloads });
  } catch (error) {
    console.error("Admin downloads fetch failed:", error);
    res.status(500).json({ success: false, message: "Could not load downloads." });
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

app.delete("/api/admin/feedbacks/:id", async (req, res) => {
  try {
    const feedback = await Feedback.findByIdAndDelete(req.params.id).lean();

    if (!feedback) {
      return res
        .status(404)
        .json({ success: false, message: "Feedback not found." });
    }

    res.json({ success: true, feedback });
  } catch (error) {
    console.error("Admin feedback delete failed:", error);
    res
      .status(500)
      .json({ success: false, message: "Could not delete feedback." });
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
      totalDownloads,
      recentErrors,
      newUsers30d,
      newProUsers30d,
      newFeedbacks30d,
      newUsageLogs30d,
      newDownloads30d,
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
      Download.countDocuments(),
      UsageLog.countDocuments({ kind: "error" }),
      User.countDocuments({ createdAt: { $gte: last30Days } }),
      User.countDocuments({ isPro: true, createdAt: { $gte: last30Days } }),
      Feedback.countDocuments({ createdAt: { $gte: last30Days } }),
      UsageLog.countDocuments({ createdAt: { $gte: last30Days } }),
      Download.countDocuments({ createdAt: { $gte: last30Days } }),
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
        totalDownloads,
        recentErrors,
        last30Days: {
          newUsers: newUsers30d,
          newProUsers: newProUsers30d,
          feedbacks: newFeedbacks30d,
          usageLogs: newUsageLogs30d,
          downloads: newDownloads30d,
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
