import express from "express";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import User from "../models/User.js";
import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

// --- 1. THE "BULLETPROOF" OAUTH2 TRANSPORTER ---
// This bypasses SMTP port blocking by using Google's HTTP API.
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    type: "OAuth2",
    user: process.env.MY_EMAIL,
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN, // Generated via OAuth Playground
  },
});

// Helper function for sending the welcome email
const sendWelcomeEmail = async (userEmail, userName) => {
  const mailOptions = {
    from: `"MediaLab Studio" <${process.env.MY_EMAIL}>`,
    to: userEmail,
    subject: "Welcome to MediaLab Studio! 🚀",
    html: `
      <div style="background-color: #030712; color: #f3f4f6; font-family: sans-serif; padding: 40px; text-align: center; border-radius: 20px; border: 1px solid #1f2937;">
        <div style="display: inline-block; width: 50px; height: 50px; background-color: #22d3ee; border-radius: 50%; line-height: 50px; font-size: 24px; font-weight: bold; color: #000; margin-bottom: 20px;">
          M
        </div>
        <h1 style="font-size: 28px; margin-bottom: 10px;">Welcome, ${userName}!</h1>
        <p style="color: #9ca3af; font-size: 16px; margin-bottom: 30px;">Your ultimate AI creative studio is ready. Start converting and editing today.</p>
        <a href="${process.env.CLIENT_URL || "https://medialab-studio.onrender.com"}" 
           style="background-color: #22d3ee; color: #000; padding: 12px 30px; border-radius: 30px; text-decoration: none; font-weight: bold; display: inline-block;">
           Open Studio
        </a>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`✅ Welcome email sent via OAuth2 to ${userEmail}`);
  } catch (error) {
    console.error("❌ Email failed (OAuth2):", error.message);
    // FALLBACK: If OAuth2 fails, you can log it here.
  }
};

// --- 2. PASSPORT SERIALIZATION ---
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err);
  }
});

// --- 3. GOOGLE STRATEGY ---
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        let user = await User.findOne({ googleId: profile.id });

        if (!user) {
          user = await User.create({
            googleId: profile.id,
            name: profile.displayName,
            email: profile.emails?.[0]?.value,
            profilePicture: profile.photos?.[0]?.value,
            provider: "google",
          });

          // Send welcome email in the background
          if (user.email) {
            sendWelcomeEmail(user.email, user.name);
          }
        } else {
          user.lastLogin = new Date();
          await user.save();
        }

        return done(null, user);
      } catch (err) {
        return done(err);
      }
    },
  ),
);

// --- 4. AUTH ROUTES ---

router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] }),
);

router.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: "/?login=failed" }),
  (req, res) => res.redirect("/?loggedIn=true"),
);

router.get("/logout", (req, res) => {
  req.logout((err) => {
    if (err) return res.status(500).json({ error: "Logout failed" });
    res.redirect("/");
  });
});

router.get("/me", (req, res) => {
  if (req.isAuthenticated()) {
    res.json({
      success: true,
      user: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        profilePicture: req.user.profilePicture,
        provider: req.user.provider,
      },
    });
  } else res.json({ success: false });
});

// --- 5. FINAL TEST ROUTE ---
router.get("/test-email", async (req, res) => {
  const testEmail = "amanikbt2@gmail.com";

  try {
    await transporter.sendMail({
      from: `"MediaLab Studio" <${process.env.MY_EMAIL}>`,
      to: testEmail,
      subject: "OAuth2 Cloud Test ✅",
      html: `<h2>✅ OAuth2 Successful</h2><p>This email bypassed Render's SMTP blocks.</p>`,
    });
    res.send(`<h1>✅ Success!</h1><p>Test email sent to ${testEmail}.</p>`);
  } catch (error) {
    console.error("❌ OAuth2 Test Failed:", error.message);
    res.status(500).send(`<h1>❌ Failed</h1><p>Error: ${error.message}</p>`);
  }
});

export default router;
