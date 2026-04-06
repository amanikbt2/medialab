import mongoose from "mongoose";

const UpgradeRequestSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  requestedFeature: { type: String, default: "MediaLab Pro" },
  source: { type: String, default: "studio-upgrade" },
  message: { type: String, default: "", trim: true },
  status: {
    type: String,
    enum: [
      "pending",
      "reviewing",
      "granted",
      "denied",
      "received",
      "contacted",
      "closed",
    ],
    default: "pending",
  },
  reviewedAt: { type: Date, default: null },
  reviewedBy: { type: String, default: "", trim: true },
  deniedReason: { type: String, default: "", trim: true },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("UpgradeRequest", UpgradeRequestSchema);
