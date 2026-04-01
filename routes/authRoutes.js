import express from "express";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import User from "../models/User.js";
import { Resend } from "resend";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY);

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
          });

          if (user.email) sendWelcomeEmail(user.email, user.name);
          console.log(`✨ New User Created: ${user.name}`);
        } else {
          // Update last login for existing users
          user.lastLogin = new Date();
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
    scope: ["profile", "email"],
    prompt: "select_account",
  }),
);

// Callback Route
router.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: "/?login=failed" }),
  (req, res) => {
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
  const allowedEmail = process.env.DEV_LOGIN_EMAIL || "amani";
  const allowedPassword = process.env.DEV_LOGIN_PASSWORD || "amani";

  if (email !== allowedEmail || password !== allowedPassword) {
    return res.status(401).json({ success: false, message: "Invalid developer login." });
  }

  let user = await User.findOne({ email: `${allowedEmail}@medialab.local` });
  if (!user) {
    user = await User.create({
      name: "Amani Developer",
      email: `${allowedEmail}@medialab.local`,
      password: "dev-only",
      provider: "developer",
      lastLogin: new Date(),
    });
  } else {
    user.lastLogin = new Date();
    await user.save();
  }

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
      return res.json({ success: true, user });
    });
  });
});

// Get Current User (The "Me" Route)
router.get("/me", (req, res) => {
  // Add Cache-Control to prevent old session data being cached by browser
  res.setHeader("Cache-Control", "no-store");

  if (req.isAuthenticated() && req.user) {
    res.json({ success: true, user: req.user });
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

export default router;
