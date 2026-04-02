import mongoose from "mongoose";

const ProjectSchema = new mongoose.Schema({
  toolType: { type: String, required: true }, // e.g., "Video to Audio", "Text to Doc"
  fileName: { type: String, required: true },
  fileUrl: { type: String, required: true }, // URL from Cloudinary or your S3 bucket
  status: { type: String, default: "completed" },
  createdAt: { type: Date, default: Date.now },
});

const BuilderDraftSchema = new mongoose.Schema({
  name: { type: String, required: true },
  canvasHtml: { type: String, default: "" },
  pageBackground: { type: String, default: "#ffffff" },
  isAutoSave: { type: Boolean, default: false },
  savedAt: { type: Date, default: Date.now },
});

const UserSchema = new mongoose.Schema({
  googleId: { type: String, unique: true, sparse: true },
  email: { type: String, required: true, unique: true },
  password: { type: String },
  name: { type: String, required: true },
  profilePicture: { type: String },
  provider: { type: String, default: "local" },
  location: { type: String, default: "" },
  lastLogin: { type: Date, default: null },

  // --- PROJECT HISTORY ---
  // This stores the last 10-20 projects for the sidebar
  projects: [ProjectSchema],
  builderDrafts: [BuilderDraftSchema],

  // --- PRO FEATURES & LIMITS ---
  isPro: { type: Boolean, default: false },
  dailyUsageCount: { type: Number, default: 0 },
  lastUsageDate: { type: Date, default: Date.now },

  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("User", UserSchema);
