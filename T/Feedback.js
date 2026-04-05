import mongoose from "mongoose";

const FeedbackSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  username: { type: String, required: true, default: "Anonymous" },
  email: { type: String, default: "" },
  rating: { type: Number, required: true, min: 1, max: 5 },
  feedback: { type: String, required: true, trim: true },
  source: { type: String, default: "web-builder" },
  isAnonymous: { type: Boolean, default: true },
  status: {
    type: String,
    enum: ["open", "completed"],
    default: "open",
  },
  hidden: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("Feedback", FeedbackSchema);
