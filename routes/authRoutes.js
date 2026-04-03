import express from "express";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { IPinfoWrapper } from "node-ipinfo";
import crypto from "crypto";
import axios from "axios";
import { Octokit } from "@octokit/rest";
import User from "../models/User.js";
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
    return 'A repository named "medialab" already exists in a conflicting state. Rename or remove it on GitHub, then try again.';
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

export const initializeGithubStorageForUser = async (user) => {
  const octokit = buildGithubClient(user);
  const repoName = "medialab";
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
  return source;
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
    scope: [
      "profile",
      "email",
      "https://www.googleapis.com/auth/adsense.readonly",
    ],
    accessType: "offline",
    includeGrantedScopes: true,
    prompt: "consent select_account",
  }),
);

// Callback Route
router.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: "/?login=failed" }),
  async (req, res) => {
    await updateUserLocationOnLogin(req, req.user);
    // Manually force session save before redirecting (Fixes Render "Session Lag")
    req.session.save((err) => {
      if (err) {
        console.error("❌ Session Save Error:", err);
        return res.redirect("/?login=error");
      }
      res.redirect("/?loggedIn=true");
    });
  },
);

router.post("/dev-login", express.json(), async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ success: false, message: "Not found." });
  }

  const email = String(req.body?.email || "").trim();
  const password = String(req.body?.password || "").trim();
  const allowedEmail = process.env.DEV_LOGIN_EMAIL || "dev@gmail.com";
  const allowedPassword = process.env.DEV_LOGIN_PASSWORD || "spiderman";

  if (email !== allowedEmail || password !== allowedPassword) {
    return res.status(401).json({ success: false, message: "Invalid developer login." });
  }

  let user = await User.findOne({ email: allowedEmail });
  if (!user) {
    user = await User.create({
      name: "Developer Access",
      email: allowedEmail,
      password: "dev-only",
      profilePicture: "/favicon.png",
      provider: "developer",
      lastLogin: new Date(),
    });
  } else {
    user.lastLogin = new Date();
    user.profilePicture = "/favicon.png";
    await user.save();
  }

  await updateUserLocationOnLogin(req, user);

  req.login(user, (err) => {
    if (err) {
      console.error("Developer login failed:", err);
      return res.status(500).json({ success: false, message: "Could not start developer session." });
    }

    req.session.save((saveErr) => {
      if (saveErr) {
        console.error("Developer session save failed:", saveErr);
        return res.status(500).json({ success: false, message: "Could not persist developer session." });
      }
      return res.json({ success: true, user: toSafeUser(user) });
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
    authUrl.searchParams.set("scope", "repo");
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

    user.githubId = String(profileData.id || "");
    user.githubUsername = String(profileData.login || "");
    user.githubToken = encryptGithubToken(tokenData.access_token);
    user.githubRepoCreated = Boolean(user.githubRepoCreated);
    user.githubLinkedAt = new Date();
    await user.save();

    if (req.user) {
      req.user.githubId = user.githubId;
      req.user.githubUsername = user.githubUsername;
      req.user.githubRepoCreated = user.githubRepoCreated;
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
    user.githubLinkedAt = null;
    await user.save();
    req.user.githubId = "";
    req.user.githubUsername = "";
    req.user.githubToken = "";
    req.user.githubRepoCreated = false;
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
router.get("/me", (req, res) => {
  // Add Cache-Control to prevent old session data being cached by browser
  res.setHeader("Cache-Control", "no-store");

  if (req.isAuthenticated() && req.user) {
    res.json({ success: true, user: toSafeUser(req.user) });
  } else {
    res.json({ success: false, message: "Not authenticated" });
  }
});

// Logout
router.get("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => {
      res.clearCookie("connect.sid"); // Clean the cookie
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
