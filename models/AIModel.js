import mongoose from "mongoose";

const AIModelSchema = new mongoose.Schema(
  {
    modelId: { type: String, required: true, unique: true, trim: true },
    provider: { type: String, required: true, trim: true, default: "groq" },
    priority: { type: Number, required: true, default: 1, min: 1 },
    isActive: { type: Boolean, default: true },
    status: {
      type: String,
      enum: ["online", "offline"],
      default: "online",
      index: true,
    },
    lastTested: { type: Date, default: null },
  },
  { timestamps: true },
);

AIModelSchema.index({ isActive: 1, status: 1, priority: 1 });

export default mongoose.model("AIModel", AIModelSchema);
