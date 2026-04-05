import mongoose from "mongoose";

const MarketplaceReplySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, default: "", trim: true },
    text: { type: String, default: "", trim: true },
    date: { type: Date, default: Date.now },
  },
  { _id: true },
);

const MarketplaceCommentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, default: "", trim: true },
    text: { type: String, default: "", trim: true },
    rating: { type: Number, min: 1, max: 5, default: 5 },
    date: { type: Date, default: Date.now },
    replies: { type: [MarketplaceReplySchema], default: [] },
  },
  { _id: true },
);

const MarketplaceRatingSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    value: { type: Number, min: 1, max: 5, required: true },
    date: { type: Date, default: Date.now },
  },
  { _id: true },
);

const MarketplacePurchaseSchema = new mongoose.Schema(
  {
    buyerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    buyerName: { type: String, default: "", trim: true },
    buyerEmail: { type: String, default: "", trim: true, lowercase: true },
    status: {
      type: String,
      enum: ["pending", "approved", "failed"],
      default: "pending",
    },
    message: { type: String, default: "", trim: true },
    approvedUntil: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
    reviewedAt: { type: Date, default: null },
  },
  { _id: true },
);

const MarketplaceItemSchema = new mongoose.Schema({
  projectId: { type: String, required: true, trim: true },
  authorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, default: "", trim: true },
  price: { type: Number, default: 0, min: 0 },
  category: { type: String, default: "General", trim: true },
  screenshots: { type: [String], default: [] },
  screenshotAssets: { type: [mongoose.Schema.Types.Mixed], default: [] },
  allowTest: { type: Boolean, default: false },
  purpose: { type: String, default: "", trim: true },
  sourceType: {
    type: String,
    enum: ["live", "draft", "upload"],
    default: "draft",
  },
  listingKind: {
    type: String,
    enum: ["sale", "template"],
    default: "sale",
  },
  sourceHtml: { type: String, default: "" },
  sourceEntryPath: { type: String, default: "index.html", trim: true },
  sourceFiles: { type: [mongoose.Schema.Types.Mixed], default: [] },
  marketplaceRepo: { type: String, default: "marketplace", trim: true },
  marketplaceRepoPath: { type: String, default: "", trim: true },
  status: {
    type: String,
    enum: ["pending", "approved", "sold", "disapproved", "removed"],
    default: "pending",
  },
  disapprovalReason: { type: String, default: "", trim: true },
  removalReason: { type: String, default: "", trim: true },
  removedAt: { type: Date, default: null },
  reviewedAt: { type: Date, default: null },
  authorName: { type: String, default: "", trim: true },
  authorAvatar: { type: String, default: "", trim: true },
  sellerRatingCount: { type: Number, default: 0, min: 0 },
  sellerRatingPercent: { type: Number, default: 0, min: 0 },
  liveUrl: { type: String, default: "", trim: true },
  comments: { type: [MarketplaceCommentSchema], default: [] },
  ratings: { type: [MarketplaceRatingSchema], default: [] },
  purchases: { type: [MarketplacePurchaseSchema], default: [] },
  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model("MarketplaceItem", MarketplaceItemSchema);
