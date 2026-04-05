import mongoose from "mongoose";

const BuilderTemplateSchema = new mongoose.Schema({
  slug: { type: String, required: true, trim: true, unique: true, index: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, default: "", trim: true },
  category: { type: String, default: "General", trim: true },
  html: { type: String, default: "" },
  htmlUrl: { type: String, default: "", trim: true },
  htmlFileId: { type: String, default: "", trim: true },
  storageProvider: { type: String, default: "mongo", trim: true },
  authorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  authorName: { type: String, default: "", trim: true },
  sourceMarketplaceItemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "MarketplaceItem",
    default: null,
  },
  isOfficial: { type: Boolean, default: true },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model("BuilderTemplate", BuilderTemplateSchema);
