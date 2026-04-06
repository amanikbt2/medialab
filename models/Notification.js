import mongoose from "mongoose";

const NotificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    recipientEmail: { type: String, default: "", trim: true, lowercase: true, index: true },
    senderName: { type: String, default: "MediaLab", trim: true },
    senderEmail: { type: String, default: "", trim: true, lowercase: true },
    deliveryScope: { type: String, enum: ["individual", "all", "system"], default: "system", index: true },
    type: { type: String, default: "general", trim: true, index: true },
    title: { type: String, required: true, trim: true },
    message: { type: String, default: "", trim: true },
    targetType: { type: String, default: "", trim: true },
    targetId: { type: String, default: "", trim: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    isRead: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export default mongoose.model("Notification", NotificationSchema);
