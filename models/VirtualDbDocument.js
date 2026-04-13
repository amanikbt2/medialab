import mongoose from "mongoose";

const VirtualDbDocumentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    modelName: { type: String, required: true, trim: true, maxlength: 80, index: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    expiresAt: { type: Date, default: null, index: true },
  },
  { timestamps: true },
);

VirtualDbDocumentSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
VirtualDbDocumentSchema.index({ userId: 1, modelName: 1, createdAt: -1 });

export default VirtualDbDocumentSchema;

