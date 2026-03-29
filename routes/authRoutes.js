import express from "express";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import User from "../models/User.js";
import { Resend } from "resend";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

// --- 1. THE CLOUD-PROOF API SENDER ---
const resend = new Resend(process.env.RESEND_API_KEY);

const sendWelcomeEmail = async (userEmail, userName) => {
  try {
    const { data, error } = await resend.emails.send({
      from: "MediaLab <onboarding@resend.dev>",
      to: userEmail,
      subject: "Welcome to MediaLab Studio! 🚀",
      html: `
        <div style="background-color: #030712; color: #f3f4f6; font-family: sans-serif; padding: 40px; text-align: center; border-radius: 24px; border: 1px solid #1f2937;">
          <div style="display: inline-block; width: 60px; height: 60px; background-color: #22d3ee; border-radius: 12px; line-height: 60px; font-size: 32px; font-weight: bold; color: #000; margin-bottom: 24px;">
            M
          </div>
          <h1 style="font-size: 28px; margin-bottom: 12px; color: #ffffff;">Welcome, ${userName}!</h1>
          <p style="color: #9ca3af; font-size: 16px; margin-bottom: 32px; line-height: 1.6;">
            Your ultimate AI creative studio is ready. Standard SMTP was blocked by the cloud, so we upgraded you to the Resend API.
          </p>
          <a href="https://medialab-6b20.onrender.com/?loggedIn=true" 
             style="background-color: #22d3ee; color: #000; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-weight: bold; display: inline-block;">
             Open Studio
          </a>
        </div>
      `,
    });

    if (error) return console.error("❌ Resend API Error:", error.message);
    console.log(`✅ API Email sent to ${userEmail}. ID: ${data.id}`);
  } catch (error) {
    console.error("❌ System Error:", error.message);
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

// --- 3. GOOGLE STRATEGY (DUPLICATE CHECK LOGIC) ---
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const profileEmail = profile.emails?.[0]?.value;

        // Step 1: Check if user exists with this Google ID
        let user = await User.findOne({ googleId: profile.id });

        // Step 2: If not, check if a user exists with this Email
        if (!user && profileEmail) {
          user = await User.findOne({ email: profileEmail });

          if (user) {
            // Found existing email user; Link their Google ID
            user.googleId = profile.id;
            if (!user.profilePicture)
              user.profilePicture = profile.photos?.[0]?.value;
            await user.save();
            console.log(
              `🔗 Linked Google ID to existing email account: ${profileEmail}`,
            );
          }
        }

        // Step 3: If still no user, create a new one
        if (!user) {
          user = await User.create({
            googleId: profile.id,
            name: profile.displayName,
            email: profileEmail,
            profilePicture: profile.photos?.[0]?.value,
            provider: "google",
          });

          // Send welcome email only for brand new accounts
          if (user.email) {
            sendWelcomeEmail(user.email, user.name);
          }
        } else {
          // Returning user: Update last login
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
    res.json({ success: true, user: req.user });
  } else {
    res.json({ success: false });
  }
});

// --- 5. TEST ROUTE ---
router.get("/test-email", async (req, res) => {
  try {
    const { data, error } = await resend.emails.send({
      from: "MediaLab <onboarding@resend.dev>",
      to: "amanikbt1@gmail.com",
      subject: "Final Cloud Bypass Test ✅",
      text: "Sent via Resend API (HTTPS). Render firewall bypassed!",
    });
    if (error) throw error;
    res.send("<h1>✅ Success!</h1><p>Check your inbox!</p>");
  } catch (error) {
    res.status(500).send(`<h1>❌ Failed</h1><p>Error: ${error.message}</p>`);
  }
});

export default router;
