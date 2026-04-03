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

const LiveProjectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    fileName: { type: String, required: true, trim: true },
    filename: { type: String, default: "", trim: true },
    repo: { type: String, default: "medialab", trim: true },
    url: { type: String, default: "", trim: true },
    liveUrl: { type: String, default: "", trim: true },
    status: { type: String, default: "draft", trim: true },
    renderUrl: { type: String, default: "", trim: true },
    renderHostedConfirmed: { type: Boolean, default: false },
    renderVerifiedAt: { type: Date, default: null },
    adsensePublisherId: { type: String, default: "", trim: true },
    lastSyncedAt: { type: Date, default: null },
    updatedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const UserSchema = new mongoose.Schema({
  googleId: { type: String, unique: true, sparse: true },
  email: { type: String, required: true, unique: true },
  password: { type: String },
  name: { type: String, required: true },
  profilePicture: { type: String },
  provider: { type: String, default: "local" },
  location: { type: String, default: "" },
  lastLogin: { type: Date, default: null },
  builderTutorialSeen: { type: Boolean, default: false },
  githubId: { type: String, default: "", trim: true },
  githubUsername: { type: String, default: "", trim: true },
  githubToken: { type: String, default: "", select: false },
  githubRepoCreated: { type: Boolean, default: false },
  githubLinkedAt: { type: Date, default: null },
  googleRefreshToken: { type: String, default: "", select: false },
  confirmedFirstHosting: { type: Boolean, default: false },
  firstHostingConfirmedAt: { type: Date, default: null },
  adsenseId: { type: String, default: "", trim: true },
  adsenseAccountName: { type: String, default: "", trim: true },
  adsenseSiteUrl: { type: String, default: "", trim: true },
  adsenseSiteStatus: { type: String, default: "", trim: true },
  adsenseAdCode: { type: String, default: "", select: false },
  faviconFileName: { type: String, default: "", trim: true },
  accountBalance: { type: Number, default: 12.5, min: 0 },
  lastWithdrawalRequestedAt: { type: Date, default: null },

  // --- PROJECT HISTORY ---
  // This stores the last 10-20 projects for the sidebar
  projects: [ProjectSchema],
  builderDrafts: [BuilderDraftSchema],
  liveProjects: [LiveProjectSchema],

  // --- PRO FEATURES & LIMITS ---
  isPro: { type: Boolean, default: false },
  dailyUsageCount: { type: Number, default: 0 },
  lastUsageDate: { type: Date, default: Date.now },

  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("User", UserSchema);
