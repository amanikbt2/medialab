import express from "express";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import User from "../models/User.js";
import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

// --- 1. THE "BOSS LEVEL" CLOUD TRANSPORTER ---
// This configuration is designed specifically to bypass Render's IPv6 networking bugs.
// --- THE "ULTIMATE BYPASS" TRANSPORTER ---
const transporter = nodemailer.createTransport({
  // Direct IPv4 for smtp.gmail.com to prevent IPv6 lookup errors
  host: "74.125.142.108",
  port: 465,
  secure: true,
  auth: {
    user: process.env.MY_EMAIL,
    pass: process.env.GOOGLE_APP_PASSWORD,
  },
  tls: {
    // This is required because we are connecting via IP instead of hostname
    servername: "smtp.gmail.com",
    rejectUnauthorized: false,
  },
  // Hard-enforce IPv4 at the OS level for this request
  family: 4,
  connectionTimeout: 20000,
});

// Helper function for sending the welcome email
const sendWelcomeEmail = async (userEmail, userName) => {
  const mailOptions = {
    from: `"MediaLab Studio" <${process.env.MY_EMAIL}>`,
    to: userEmail,
    subject: "Welcome to MediaLab Studio! 🚀",
    html: `
      <div style="background-color: #030712; color: #f3f4f6; font-family: sans-serif; padding: 40px; text-align: center; border-radius: 24px; border: 1px solid #1f2937;">
        <div style="display: inline-block; width: 60px; height: 60px; background-color: #22d3ee; border-radius: 12px; line-height: 60px; font-size: 32px; font-weight: bold; color: #000; margin-bottom: 24px;">
          M
        </div>
        <h1 style="font-size: 28px; margin-bottom: 12px; color: #ffffff;">Welcome, ${userName}!</h1>
        <p style="color: #9ca3af; font-size: 16px; margin-bottom: 32px; line-height: 1.6;">Your ultimate AI creative studio is ready. Start converting and editing today.</p>
        <a href="https://medialab-studio.onrender.com" 
           style="background-color: #22d3ee; color: #000; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-weight: bold; display: inline-block;">
           Open Studio
        </a>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`✅ IPv4 Smooth Email sent to ${userEmail}`);
  } catch (error) {
    console.error("❌ Boss Level Email failed:", error.message);
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

// --- 4. ROUTES ---
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
    res.json({ success: true, user: req.user });
  } else res.json({ success: false });
});

// --- 5. THE TEST ROUTE ---
router.get("/test-email", async (req, res) => {
  try {
    await transporter.sendMail({
      from: `"MediaLab Admin" <${process.env.MY_EMAIL}>`,
      to: "amanikbt2@gmail.com",
      subject: "MediaLab Boss Level Test ✅",
      text: "IPv4 Forced Connection Successful!",
    });
    res.send(
      "<h1>✅ Success! IPv4 Forced.</h1><p>Email sent successfully.</p>",
    );
  } catch (error) {
    console.error("❌ Test Failed:", error.message);
    res.status(500).send(`<h1>❌ Failed</h1><p>Error: ${error.message}</p>`);
  }
});

export default router;
