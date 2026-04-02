import mongoose from "mongoose";

const UsageLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  email: { type: String, default: "", trim: true },
  name: { type: String, default: "", trim: true },
  isAnonymous: { type: Boolean, default: true },
  isPro: { type: Boolean, default: false },
  action: { type: String, required: true, trim: true },
  summary: { type: String, required: true, trim: true },
  source: { type: String, default: "web", trim: true },
  kind: {
    type: String,
    enum: ["activity", "error"],
    default: "activity",
  },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now, index: true },
});

UsageLogSchema.virtual("displayLine").get(function usageDisplayLine() {
  const identity =
    this.isAnonymous || !this.email
      ? "anonymous"
      : `${this.email}: ${this.name || "Unknown"}`;
  return `[${identity}]-- ${this.summary}: ${new Date(this.createdAt).toISOString()}`;
});

UsageLogSchema.set("toJSON", { virtuals: true });
UsageLogSchema.set("toObject", { virtuals: true });

export default mongoose.model("UsageLog", UsageLogSchema);
