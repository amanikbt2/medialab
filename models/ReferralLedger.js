import mongoose from "mongoose";

const ReferralLedgerSchema = new mongoose.Schema(
  {
    fingerprintHash: { type: String, default: "", trim: true, index: true },
    ipHash: { type: String, default: "", trim: true, index: true },
    claimantUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    claimantEmail: { type: String, default: "", trim: true, lowercase: true, index: true },
    referrerUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    referralCode: { type: String, default: "", trim: true, index: true },
    rewardDownloadId: { type: mongoose.Schema.Types.ObjectId, ref: "Download", default: null },
    rewardAmount: { type: Number, default: 0, min: 0 },
    installRewardedAt: { type: Date, default: null, index: true },
    status: { type: String, default: "seen", trim: true, index: true },
    reason: { type: String, default: "", trim: true },
    device: { type: String, default: "", trim: true },
    platform: { type: String, default: "", trim: true },
    browser: { type: String, default: "", trim: true },
    userAgent: { type: String, default: "", trim: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

export default mongoose.model("ReferralLedger", ReferralLedgerSchema);
