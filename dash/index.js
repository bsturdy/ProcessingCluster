import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 10000;

// Serve the public folder
app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
});
