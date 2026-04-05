import mongoose from "mongoose";

const DownloadSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  email: { type: String, default: "", trim: true },
  name: { type: String, default: "", trim: true },
  isAnonymous: { type: Boolean, default: true },
  type: { type: String, default: "pwa", trim: true },
  platform: { type: String, default: "", trim: true },
  source: { type: String, default: "web", trim: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now, index: true },
});

export default mongoose.model("Download", DownloadSchema);
