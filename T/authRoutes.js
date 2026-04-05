import express from "express";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { IPinfoWrapper } from "node-ipinfo";
import crypto from "crypto";
import axios from "axios";
import { Octokit } from "@octokit/rest";
import User from "../models/User.js";
import Notification from "../models/Notification.js";
import { Resend } from "resend";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY);
const ipinfoToken = process.env.IPINFO_TOKEN || process.env.IPINFO_API_TOKEN || "";
const ipinfoWrapper = ipinfoToken ? new IPinfoWrapper(ipinfoToken, undefined, 4000) : null;
const githubClientId = process.env.GITHUB_CLIENT_ID || "";
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET || "";
const githubEncryptionSecret =
  process.env.GITHUB_TOKEN_SECRET || process.env.SESSION_SECRET || "medialab-github-secret";
const googleTokenSecret =
  process.env.GOOGLE_TOKEN_SECRET || process.env.SESSION_SECRET || "medialab-google-secret";

const resolveGithubCallbackUrl = (req) => {
  if (process.env.GITHUB_CALLBACK_URL) {
    return process.env.GITHUB_CALLBACK_URL;
  }
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const protocol = forwardedProto || req.protocol || "http";
  const host = req.get("host") || "localhost:3000";
  return `${protocol}://${host}/api/auth/github/callback`;
};

const buildGithubEncryptionKey = () =>
  crypto.createHash("sha256").update(String(githubEncryptionSecret)).digest();
const buildGoogleEncryptionKey = () =>
  crypto.createHash("sha256").update(String(googleTokenSecret)).digest();

const createWelcomeNotification = async (user = null) => {
  if (!user?._id) return null;
  try {
    return await Notification.create({
      userId: user._id,
      type: "welcome",
      title: `Hello ${String(user.name || "Creator").trim()}`,
      message:
        "Welcome to MediaLab. Explore different tools to monetize or sell your projects as a developer.",
      targetType: "console",
      targetId: "",
      metadata: {
        source: "login",
      },
      isRead: false,
    });
  } catch (error) {
    console.error("Welcome notification failed:", error.message);
    return null;
  }
};

const slugifyRepoName = (value = "") =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 39);

const getPreferredGithubRepoName = (user = {}) => {
  const displayName = String(user?.name || "").trim();
  const emailLocal = String(user?.email || "").split("@")[0].trim();
  const firstNameSource =
    displayName.split(/\s+/).find(Boolean) ||
    emailLocal.split(/[._-]+/).find(Boolean) ||
    "medialab";
  return slugifyRepoName(firstNameSource) || "medialab";
};

const encryptGithubToken = (token = "") => {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", buildGithubEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(token), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return JSON.stringify({
    iv: iv.toString("hex"),
    content: encrypted.toString("hex"),
    tag: authTag.toString("hex"),
  });
};

const decryptGithubToken = (payload = "") => {
  if (!payload) return "";
  try {
    const parsed = JSON.parse(String(payload));
    const iv = Buffer.from(parsed.iv || "", "hex");
    const encrypted = Buffer.from(parsed.content || "", "hex");
    const authTag = Buffer.from(parsed.tag || "", "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", buildGithubEncryptionKey(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch (error) {
    console.error("GitHub token decrypt failed:", error.message);
    return "";
  }
};

const encryptGoogleRefreshToken = (token = "") => {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", buildGoogleEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(token), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return JSON.stringify({
    iv: iv.toString("hex"),
    content: encrypted.toString("hex"),
    tag: authTag.toString("hex"),
  });
};

export const decryptGoogleRefreshToken = (payload = "") => {
  if (!payload) return "";
  try {
    const parsed = JSON.parse(String(payload));
    const iv = Buffer.from(parsed.iv || "", "hex");
    const encrypted = Buffer.from(parsed.content || "", "hex");
    const authTag = Buffer.from(parsed.tag || "", "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", buildGoogleEncryptionKey(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch (error) {
    console.error("Google refresh token decrypt failed:", error.message);
    return "";
  }
};

export const buildGithubClient = (user) => {
  const token = decryptGithubToken(user?.githubToken || "");
  if (!token) {
    throw new Error("Your GitHub connection is missing a valid token. Reconnect GitHub and try again.");
  }
  return new Octokit({
    auth: token,
    userAgent: "MediaLab-Studio",
  });
};

const formatGithubInitError = (error) => {
  const status = error?.status || error?.response?.status || 500;
  const apiMessage =
    error?.response?.data?.message || error?.message || "GitHub storage could not be initialized.";
  const lowered = String(apiMessage).toLowerCase();
  if (status === 401 || status === 403) {
    return "GitHub authorization failed. Reconnect your GitHub account and try again.";
  }
  if (status === 422 && lowered.includes("name already exists")) {
    return "A repository with your MediaLab hosting name already exists in a conflicting state. Rename or remove it on GitHub, then try again.";
  }
  if (status === 422 && (lowered.includes("repository creation failed") || lowered.includes("limit"))) {
    return "GitHub could not create the repository. Your account may have hit a repository limit.";
  }
  if (status === 409 && lowered.includes("page")) {
    return "GitHub Pages is still provisioning for this repository. Try again in a moment.";
  }
  if (status === 404 && lowered.includes("page")) {
    return "GitHub Pages could not be enabled because the medialab repository is missing a usable main branch.";
  }
  return apiMessage;
};

const waitForGithubProvisioning = (ms = 2500) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const buildRenderNameSeed = (value = "client") => {
  const raw = String(value || "client").trim();
  const firstToken = raw.split(/\s+/).filter(Boolean)[0] || raw;
  return (
    String(firstToken || "client")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "client"
  );
};

const buildDefaultRenderServiceName = (value = "client") =>
  buildRenderNameSeed(value);

const resetUserRenderHostingState = (user) => {
  if (!user) return;
  user.confirmedFirstHosting = false;
  user.firstHostingConfirmedAt = null;
  user.liveProjects = (Array.isArray(user.liveProjects) ? user.liveProjects : []).map((project) => {
    if (!project || typeof project !== "object") return project;
    project.renderUrl = "";
    project.renderServiceId = "";
    project.renderServiceName = "";
    project.renderBlueprintId = "";
    project.renderRepoUrl = "";
    project.renderDeployStatus = "";
    project.renderHostedConfirmed = false;
    project.renderVerifiedAt = null;
    return project;
  });
};

const upsertSecretPortalUser = async (email) => {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  let user = await User.findOne({ email: normalizedEmail });
  if (!user) {
    user = await User.create({
      name: "ML Community",
      email: normalizedEmail,
      password: "dev-only",
      profilePicture: "/favicon.png",
      provider: "developer",
      lastLogin: new Date(),
    });
  } else {
    user.email = normalizedEmail;
    user.name = "ML Community";
    user.profilePicture = "/favicon.png";
    user.provider = "developer";
    user.password = user.password || "dev-only";
    user.lastLogin = new Date();
    await user.save();
  }
  return user;
};

const buildGithubRepoScaffold = (owner = "user", repoName = "medialab", displayName = owner) => {
  const packageJson = JSON.stringify(
    {
      name: repoName,
      version: "1.0.0",
      private: true,
      description: "Cloud storage for MediaLab AI projects.",
      type: "module",
      scripts: {
        start: "node index.js",
        dev: "node index.js",
      },
      dependencies: {
        compression: "^1.7.4",
        cors: "^2.8.5",
        dotenv: "^16.4.5",
        express: "^4.19.2",
        helmet: "^7.1.0",
        morgan: "^1.10.0",
      },
    },
    null,
    2,
  );
  const serverIndex = `import compression from "compression";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const port = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(compression());
app.use(morgan("dev"));
app.use(express.static(publicDir));

app.get("*", (req, res) => {
  const requestPath = String(req.path || "");
  if (requestPath.endsWith(".html")) {
    return res.sendFile(path.join(publicDir, requestPath.replace(/^\\/+/, "")));
  }
  return res.sendFile(path.join(publicDir, "index.html"));
});

app.listen(port, () => {
  console.log(\`${repoName} static host running on port \${port}\`);
});
`;
  const publicIndexHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MediaLab Cloud Storage</title>
  </head>
  <body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0f172a;color:#e2e8f0;font-family:Inter,system-ui,sans-serif;">
    <main style="width:min(92vw,760px);padding:32px;border-radius:28px;background:rgba(15,23,42,.86);border:1px solid rgba(56,189,248,.22);box-shadow:0 28px 80px rgba(2,6,23,.4);">
      <p style="margin:0 0 12px;color:#67e8f9;font-weight:800;letter-spacing:.16em;text-transform:uppercase;">MediaLab Git Host</p>
      <h1 style="margin:0 0 12px;font-size:clamp(2rem,5vw,3.25rem);">${owner}'s Cloud Workspace</h1>
      <p style="margin:0;color:#cbd5e1;line-height:1.6;">Published sites live inside <strong>/public/</strong>. The included Node host serves them from the root path so each project feels like a standard deployed site.</p>
    </main>
  </body>
</html>`;
  return [
    { path: "package.json", content: packageJson },
    { path: "index.js", content: serverIndex },
    {
      path: "render.yaml",
      content: `services:
  - type: web
    name: ${buildDefaultRenderServiceName(displayName || owner)}
    runtime: node
    plan: free
    autoDeploy: true
    buildCommand: npm install
    startCommand: npm run dev
    envVars:
      - key: NODE_ENV
        value: production
`,
    },
    { path: ".gitignore", content: "node_modules\n.env\n.DS_Store\nnpm-debug.log*\n" },
    { path: "public/index.html", content: publicIndexHtml },
    { path: "public/.gitkeep", content: "" },
  ];
};

const ensureGithubRepoScaffold = async (octokit, owner, repo, displayName = owner) => {
  for (const file of buildGithubRepoScaffold(owner, repo, displayName)) {
    let sha = "";
    try {
      const existing = await octokit.rest.repos.getContent({ owner, repo, path: file.path });
      if (!Array.isArray(existing.data) && existing.data?.sha) {
        sha = existing.data.sha;
      }
    } catch (error) {
      if ((error?.status || error?.response?.status) !== 404) throw error;
    }
    await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: file.path,
      message: `Initialize ${file.path} for MediaLab hosting`,
      content: Buffer.from(file.content, "utf8").toString("base64"),
      ...(sha ? { sha } : {}),
    });
  }
};

export const initializeGithubStorageForUser = async (user) => {
  const octokit = buildGithubClient(user);
  const repoName = getPreferredGithubRepoName(user);
  const owner = user.githubUsername;
  let repoData = null;
  let createdRepo = false;

  try {
    const repoResponse = await octokit.rest.repos.get({ owner, repo: repoName });
    repoData = repoResponse.data;
  } catch (error) {
    if ((error?.status || error?.response?.status) !== 404) throw error;
    const created = await octokit.rest.repos.createForAuthenticatedUser({
      name: repoName,
      description: "Cloud storage for MediaLab AI projects.",
      private: false,
      auto_init: true,
      homepage: `https://${owner}.github.io/${repoName}/`,
    });
    repoData = created.data;
    createdRepo = true;
  }

  if (createdRepo) {
    await waitForGithubProvisioning();
  }

  await ensureGithubRepoScaffold(octokit, owner, repoName, user.name || owner);

  try {
    await octokit.rest.repos.getPages({ owner, repo: repoName });
    await octokit.rest.repos.updateInformationAboutPagesSite({
      owner,
      repo: repoName,
      source: {
        branch: "main",
        path: "/",
      },
    });
  } catch (error) {
    const status = error?.status || error?.response?.status;
    if (status === 404) {
      await octokit.rest.repos.createPagesSite({
        owner,
        repo: repoName,
        source: {
          branch: "main",
          path: "/",
        },
      });
    } else {
      throw error;
    }
  }

  user.githubRepoCreated = true;
  user.githubRepoName = repoName;
  await user.save();

  return {
    repo: repoData?.full_name || `${owner}/${repoName}`,
    repoUrl: repoData?.html_url || `https://github.com/${owner}/${repoName}`,
    pagesUrl: `https://${owner}.github.io/${repoName}/`,
  };
};

export const toSafeUser = (user) => {
  if (!user) return null;
  const source = typeof user.toObject === "function" ? user.toObject() : { ...user };
  const hasAdsenseConnection = Boolean(
    source.googleRefreshToken || source.adsenseId || source.adsenseAccountName,
  );
  delete source.password;
  delete source.githubToken;
  delete source.googleRefreshToken;
  delete source.adsenseAdCode;
  source.githubConnected = Boolean(source.githubUsername);
  source.adsenseConnected = hasAdsenseConnection;
  source.githubRepoName = String(source.githubRepoName || "").trim();
  return source;
};

export const generateReferralCode = (user = {}) => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
};

export const ensureUserReferralCode = async (user) => {
  if (!user) return user;
  if (String(user.referralCode || "").trim()) return user;
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const candidate = generateReferralCode(user);
    const existing = await User.findOne({ referralCode: candidate }).select("_id").lean();
    if (existing) continue;
    user.referralCode = candidate;
    await user.save();
    return user;
  }
  throw new Error("Could not allocate a referral code right now.");
};

const extractClientIp = (req) => {
  const forwarded = req.headers["x-forwarded-for"];
  const rawIp = Array.isArray(forwarded)
    ? forwarded[0]
    : typeof forwarded === "string"
      ? forwarded.split(",")[0]
      : req.ip || req.socket?.remoteAddress || "";
  return String(rawIp || "")
    .replace(/^::ffff:/, "")
    .trim();
};

const isLocalIp = (ip = "") =>
  ["127.0.0.1", "::1", "localhost"].includes(String(ip).toLowerCase());

const buildLocationLabel = (ipinfo = {}, clientIp = "") => {
  const geo = ipinfo.geo || ipinfo;
  const parts = [geo.country, geo.region, geo.city, geo.postalCode || geo.postal]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (!parts.length) return "";
  const ipPrefix = clientIp ? `IP ${clientIp}` : "IP";
  return `${ipPrefix} (${parts.join(" > ")})`;
};

const updateUserLocationOnLogin = async (req, user) => {
  try {
    if (!user) return;
    const clientIp = extractClientIp(req);
    if (!clientIp) return;

    const fallbackLocation = isLocalIp(clientIp)
      ? `Local IP (${clientIp})`
      : `IP ${clientIp}`;

    if (!ipinfoWrapper) {
      if (fallbackLocation !== user.location) {
        user.location = fallbackLocation;
        await user.save();
      }
      return;
    }

    const ipinfo = await ipinfoWrapper.lookupIp(clientIp);
    const nextLocation = buildLocationLabel(ipinfo, clientIp);
    const finalLocation = nextLocation || fallbackLocation;
    if (!finalLocation || finalLocation === user.location) return;
    user.location = finalLocation;
    await user.save();
  } catch (error) {
    console.warn("IPinfo location lookup skipped:", error.message);
    try {
      const clientIp = extractClientIp(req);
      if (!clientIp || !user) return;
      const fallbackLocation = isLocalIp(clientIp)
        ? `Local IP (${clientIp})`
        : `IP ${clientIp}`;
      if (fallbackLocation !== user.location) {
        user.location = fallbackLocation;
        await user.save();
      }
    } catch {}
  }
};

// --- 1. WELCOME EMAIL (Improved Error Handling) ---
const sendWelcomeEmail = async (userEmail, userName) => {
  try {
    await resend.emails.send({
      from: "MediaLab <onboarding@resend.dev>",
      to: userEmail,
      subject: "Welcome to MediaLab Studio! 🚀",
      html: `
        <div style="background-color: #030712; color: #f3f4f6; font-family: sans-serif; padding: 40px; text-align: center; border-radius: 24px;">
          <h1 style="color: #ffffff;">Welcome, ${userName}!</h1>
          <p style="color: #9ca3af;">Your AI creative studio is ready.</p>
          <a href="${process.env.CLIENT_URL || "https://medialab-6b20.onrender.com"}/?loggedIn=true" 
             style="background-color: #22d3ee; color: #000; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">
             Open Studio
          </a>
        </div>
      `,
    });
    console.log(`✅ Welcome email sent to ${userEmail}`);
  } catch (error) {
    console.error("❌ Resend Error:", error.message);
  }
};

// --- 2. PASSPORT SERIALIZATION ---
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

// --- 3. GOOGLE STRATEGY ---
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
      proxy: true, // CRITICAL FOR RENDER/HEROKU (Trusts the HTTPS proxy)
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const profileEmail = profile.emails?.[0]?.value;
        const profilePic = profile.photos?.[0]?.value;

        // 1. Check by Google ID
        let user = await User.findOne({ googleId: profile.id });

        // 2. Check by Email if Google ID not found
        if (!user && profileEmail) {
          user = await User.findOne({ email: profileEmail });
          if (user) {
            user.googleId = profile.id;
            if (!user.profilePicture) user.profilePicture = profilePic;
            user.lastLogin = new Date();
            if (refreshToken) {
              user.googleRefreshToken = encryptGoogleRefreshToken(refreshToken);
            }
            await user.save();
            console.log(`🔗 Account Linked: ${profileEmail}`);
          }
        }

        // 3. Create new user if still not found
        if (!user) {
          user = await User.create({
            googleId: profile.id,
            name: profile.displayName,
            email: profileEmail,
            profilePicture: profilePic,
            provider: "google",
            lastLogin: new Date(),
            googleRefreshToken: refreshToken
              ? encryptGoogleRefreshToken(refreshToken)
              : "",
          });

          if (user.email) sendWelcomeEmail(user.email, user.name);
          console.log(`✨ New User Created: ${user.name}`);
        } else {
          // Update last login for existing users
          user.lastLogin = new Date();
          if (refreshToken) {
            user.googleRefreshToken = encryptGoogleRefreshToken(refreshToken);
          }
          await user.save();
        }

        await ensureUserReferralCode(user);

        return done(null, user);
      } catch (err) {
        return done(err, null);
      }
    },
  ),
);

// --- 4. AUTH ROUTES ---

// Initial Google Redirect
router.get(
  "/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
    prompt: "select_account",
  }),
);

router.get("/google-adsense", (req, res, next) => {
  if (!req.isAuthenticated() || !req.user) {
    return res.redirect("/?adsense=login-required");
  }
  req.session.googleAuthMode = "adsense";
  return req.session.save((error) => {
    if (error) {
      console.error("AdSense auth session save failed:", error);
      return res.redirect("/?adsense=session-error");
    }
    return passport.authenticate("google", {
      scope: [
        "profile",
        "email",
        "https://www.googleapis.com/auth/adsense.readonly",
      ],
      accessType: "offline",
      includeGrantedScopes: true,
      prompt: "consent select_account",
    })(req, res, next);
  });
});

// Callback Route
router.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: "/?login=failed" }),
  async (req, res) => {
    await updateUserLocationOnLogin(req, req.user);
    const authMode = String(req.session?.googleAuthMode || "").trim();
    if (authMode !== "adsense") {
      await createWelcomeNotification(req.user);
    }
    if (req.session) delete req.session.googleAuthMode;
    // Manually force session save before redirecting (Fixes Render "Session Lag")
    req.session.save((err) => {
      if (err) {
        console.error("❌ Session Save Error:", err);
        return res.redirect("/?login=error");
      }
      res.redirect(authMode === "adsense" ? "/?adsense=connected" : "/?loggedIn=true");
    });
  },
);

router.post("/dev-login", express.json(), async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "").trim();
  const allowedEmail = String(process.env.DEV_LOGIN_EMAIL || "dev@gmail.com")
    .trim()
    .toLowerCase();
  const allowedPassword = process.env.DEV_LOGIN_PASSWORD || "spiderman";

  if (email !== allowedEmail || password !== allowedPassword) {
    return res.status(401).json({ success: false, message: "Invalid developer login." });
  }

  const user = await upsertSecretPortalUser(allowedEmail);

  await ensureUserReferralCode(user);

  await updateUserLocationOnLogin(req, user);

  req.login(user, (err) => {
    if (err) {
      console.error("Developer login failed:", err);
      return res.status(500).json({ success: false, message: "Could not start developer session." });
    }

    createWelcomeNotification(user).finally(() => {
      req.session.save((saveErr) => {
        if (saveErr) {
          console.error("Developer session save failed:", saveErr);
          return res.status(500).json({ success: false, message: "Could not persist developer session." });
        }
        return res.json({ success: true, user: toSafeUser(user) });
      });
    });
  });
});

router.get("/github", (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res.redirect("/?github=login-required");
  }
  if (!githubClientId || !githubClientSecret) {
    return res.redirect("/?github=not-configured");
  }
  const state = crypto.randomBytes(24).toString("hex");
  req.session.githubOAuthState = state;
  req.session.githubOAuthUserId = String(req.user._id);
  req.session.save((error) => {
    if (error) {
      console.error("GitHub OAuth session save failed:", error);
      return res.redirect("/?github=session-error");
    }
    const authUrl = new URL("https://github.com/login/oauth/authorize");
    authUrl.searchParams.set("client_id", githubClientId);
    authUrl.searchParams.set("scope", "repo user:email");
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("allow_signup", "true");
    return res.redirect(authUrl.toString());
  });
});

router.get("/github/callback", async (req, res) => {
  const { code = "", state = "" } = req.query;
  if (!req.session?.githubOAuthState || String(state) !== req.session.githubOAuthState) {
    return res.redirect("/?github=state-error");
  }
  if (!code) {
    return res.redirect("/?github=missing-code");
  }
  try {
    const tokenResponse = await axios.post(
      "https://github.com/login/oauth/access_token",
      {
        client_id: githubClientId,
        client_secret: githubClientSecret,
        code: String(code),
      },
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      },
    );
    const tokenData = tokenResponse.data || {};
    if (!tokenData.access_token) {
      console.error("GitHub token exchange failed:", tokenData);
      return res.redirect("/?github=token-error");
    }

    const profileResponse = await axios.get("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${tokenData.access_token}`,
        "User-Agent": "MediaLab-Studio",
      },
    });
    const profileData = profileResponse.data || {};
    if (!profileData?.login) {
      console.error("GitHub profile fetch failed:", profileData);
      return res.redirect("/?github=profile-error");
    }

    const userId = req.session.githubOAuthUserId || req.user?._id;
    const user = userId ? await User.findById(userId) : null;
    if (!user) {
      return res.redirect("/?github=user-missing");
    }

    await User.updateMany(
      {
        _id: { $ne: user._id },
        $or: [
          { githubId: String(profileData.id || "") },
          { githubUsername: String(profileData.login || "") },
        ],
      },
      {
        $set: {
          githubId: "",
          githubUsername: "",
          githubToken: "",
          githubRepoCreated: false,
          githubLinkedAt: null,
        },
      },
    );

    const previousGithubUsername = String(user.githubUsername || "").trim().toLowerCase();
    const nextGithubUsername = String(profileData.login || "").trim();
    const nextGithubUsernameLower = nextGithubUsername.toLowerCase();
    user.githubId = String(profileData.id || "");
    user.githubUsername = nextGithubUsername;
    user.githubToken = encryptGithubToken(tokenData.access_token);
    user.githubRepoCreated = Boolean(user.githubRepoCreated);
    user.githubRepoName = String(user.githubRepoName || getPreferredGithubRepoName(user));
    user.githubLinkedAt = new Date();
    if (previousGithubUsername && previousGithubUsername !== nextGithubUsernameLower) {
      resetUserRenderHostingState(user);
    }
    await user.save();

    if (req.user) {
      req.user.githubId = user.githubId;
      req.user.githubUsername = user.githubUsername;
      req.user.githubRepoCreated = user.githubRepoCreated;
      req.user.githubRepoName = user.githubRepoName;
      req.user.githubLinkedAt = user.githubLinkedAt;
      req.user.githubToken = user.githubToken;
    }

    delete req.session.githubOAuthState;
    delete req.session.githubOAuthUserId;
    req.session.save(() => {
      res.redirect("/?github=connected");
    });
  } catch (error) {
    console.error("GitHub OAuth callback failed:", error);
    return res.redirect("/?github=callback-error");
  }
});

router.post("/github/disconnect", async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ success: false, message: "Not authenticated" });
  }
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    user.githubId = "";
    user.githubUsername = "";
    user.githubToken = "";
    user.githubRepoCreated = false;
    user.githubRepoName = "";
    user.githubLinkedAt = null;
    resetUserRenderHostingState(user);
    await user.save();
    req.user.githubId = "";
    req.user.githubUsername = "";
    req.user.githubToken = "";
    req.user.githubRepoCreated = false;
    req.user.githubRepoName = "";
    req.user.githubLinkedAt = null;
    return res.json({ success: true, user: toSafeUser(user) });
  } catch (error) {
    console.error("GitHub disconnect failed:", error);
    return res.status(500).json({ success: false, message: "Could not disconnect GitHub." });
  }
});

router.post("/github/initialize-storage", express.json(), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ success: false, message: "You need to sign in first." });
  }

  try {
    const user = await User.findById(req.user._id).select("+githubToken");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    if (!user.githubUsername || !user.githubToken) {
      return res.status(400).json({
        success: false,
        message: "Connect your GitHub account first before initializing storage.",
      });
    }

    const storage = await initializeGithubStorageForUser(user);
    req.user.githubRepoCreated = true;
    req.user.githubRepoName = user.githubRepoName;
    req.user.githubUsername = user.githubUsername;
    req.user.githubId = user.githubId;

    return res.json({
      success: true,
      message: "GitHub Storage Active",
      storage,
      user: toSafeUser(user),
    });
  } catch (error) {
    console.error("GitHub storage initialization failed:", error);
    const message = formatGithubInitError(error);
    const status = error?.status || error?.response?.status || 500;
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      message,
    });
  }
});

// Get Current User (The "Me" Route)
router.get("/me", async (req, res) => {
  // Add Cache-Control to prevent old session data being cached by browser
  res.setHeader("Cache-Control", "no-store");

  if (req.isAuthenticated() && req.user) {
    await ensureUserReferralCode(req.user);
    res.json({ success: true, user: toSafeUser(req.user) });
  } else {
    res.json({ success: false, message: "Not authenticated" });
  }
});

// Logout
router.get("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    if (req.session) {
      delete req.session.githubOAuthState;
      delete req.session.githubOAuthUserId;
      delete req.session.googleAuthMode;
    }
    req.session.destroy(() => {
      res.clearCookie("medialab.sid");
      res.clearCookie("connect.sid");
      res.redirect("/");
    });
  });
});

// --- 5. SYSTEM TEST ---
router.get("/test-email", async (req, res) => {
  try {
    await resend.emails.send({
      from: "MediaLab <onboarding@resend.dev>",
      to: "amanikbt1@gmail.com",
      subject: "Cloud Bypass Test ✅",
      text: "Success!",
    });
    res.send("Email Sent!");
  } catch (e) {
    res.status(500).send(e.message);
  }
});

router.post("/builder-tutorial/complete", async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ success: false, message: "Not authenticated" });
  }

  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    if (!user.builderTutorialSeen) {
      user.builderTutorialSeen = true;
      await user.save();
    }

    req.user.builderTutorialSeen = true;
    return res.json({ success: true, builderTutorialSeen: true, user: toSafeUser(user) });
  } catch (error) {
    console.error("Builder tutorial completion failed:", error);
    return res.status(500).json({
      success: false,
      message: "Could not save tutorial progress.",
    });
  }
});

export default router;
