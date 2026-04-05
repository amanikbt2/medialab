import mongoose from "mongoose";

const WithdrawalRequestSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  name: { type: String, required: true, trim: true },
  method: {
    type: String,
    enum: ["paypal", "mpesa", "airtel"],
    required: true,
  },
  destination: { type: String, required: true, trim: true },
  amount: { type: Number, required: true, min: 5 },
  fee: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ["pending", "processing", "paid", "failed"],
    default: "pending",
  },
  reviewedAt: { type: Date, default: null },
  deniedReason: { type: String, default: "", trim: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model("WithdrawalRequest", WithdrawalRequestSchema);
