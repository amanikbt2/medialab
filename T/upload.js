import multer from "multer";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";

// Fix __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, join(__dirname, "../uploads")),
  filename: (req, file, cb) => cb(null, uuidv4() + extname(file.originalname)),
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

export default upload;
