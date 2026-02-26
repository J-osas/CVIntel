import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("cvintel.db");

// Initialize Database & Migrations
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    full_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS cvs (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    parsed_text TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS cv_scores (
    id TEXT PRIMARY KEY,
    cv_id TEXT,
    structure_score INTEGER,
    keyword_score INTEGER,
    impact_score INTEGER,
    alignment_score INTEGER,
    clarity_score INTEGER,
    overall_score INTEGER,
    ats_risk_level TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(cv_id) REFERENCES cvs(id)
  );

  CREATE TABLE IF NOT EXISTS cv_reports (
    id TEXT PRIMARY KEY,
    cv_id TEXT,
    strengths TEXT, -- JSON
    weaknesses TEXT, -- JSON
    ats_risk_explanation TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(cv_id) REFERENCES cvs(id)
  );
`);

// Simple Migration Logic for Users Table
const tableInfo = db.prepare("PRAGMA table_info(users)").all() as any[];
const columns = tableInfo.map(c => c.name);
const requiredColumns = ['target_role', 'industry', 'career_level', 'target_country'];

requiredColumns.forEach(col => {
  if (!columns.includes(col)) {
    console.log(`Migrating: Adding column ${col} to users table`);
    db.prepare(`ALTER TABLE users ADD COLUMN ${col} TEXT`).run();
  }
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Check if user exists for auto-fill
  app.get("/api/auth/check/:email", (req, res) => {
    try {
      const user = db.prepare("SELECT * FROM users WHERE email = ?").get(req.params.email);
      res.json(user || null);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Mock Auth for V1 - Enhanced for Lead Capture
  app.post("/api/auth/mock", (req, res) => {
    try {
      const { email, full_name, target_role, industry, career_level, target_country } = req.body;
      let user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
      
      if (!user) {
        const id = Math.random().toString(36).substring(7);
        db.prepare(`
          INSERT INTO users (id, email, full_name, target_role, industry, career_level, target_country) 
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, email, full_name, target_role, industry, career_level, target_country);
        user = { id, email, full_name, target_role, industry, career_level, target_country };
      } else {
        // Update existing user profile with latest target info
        db.prepare(`
          UPDATE users 
          SET full_name = ?, target_role = ?, industry = ?, career_level = ?, target_country = ?
          WHERE id = ?
        `).run(full_name, target_role, industry, career_level, target_country, user.id);
      }
      res.json(user);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Save Analysis Results
  app.post("/api/analysis/save", (req, res) => {
    try {
      const { userId, parsedCv, scores, report } = req.body;
      const cvId = Math.random().toString(36).substring(7);
      const scoreId = Math.random().toString(36).substring(7);
      const reportId = Math.random().toString(36).substring(7);

      db.transaction(() => {
        db.prepare("INSERT INTO cvs (id, user_id, parsed_text) VALUES (?, ?, ?)").run(
          cvId,
          userId,
          JSON.stringify(parsedCv)
        );

        db.prepare(`
          INSERT INTO cv_scores (
            id, cv_id, structure_score, keyword_score, impact_score, 
            alignment_score, clarity_score, overall_score, ats_risk_level
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          scoreId,
          cvId,
          scores.structure,
          scores.keyword,
          scores.impact,
          scores.alignment,
          scores.clarity,
          scores.overall,
          scores.atsRisk
        );

        db.prepare(`
          INSERT INTO cv_reports (
            id, cv_id, strengths, weaknesses, ats_risk_explanation
          ) VALUES (?, ?, ?, ?, ?)
        `).run(
          reportId,
          cvId,
          JSON.stringify(report.strengths),
          JSON.stringify(report.weaknesses),
          report.ats_risk_explanation
        );
      })();

      res.json({ success: true, cvId });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/history/:userId", (req, res) => {
    try {
      const history = db.prepare(`
        SELECT s.*, r.strengths, r.weaknesses, r.ats_risk_explanation
        FROM cv_scores s
        JOIN cv_reports r ON s.cv_id = r.cv_id
        JOIN cvs c ON s.cv_id = c.id
        WHERE c.user_id = ?
        ORDER BY s.created_at DESC
      `).all(req.params.userId);
      res.json(history);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Global Error Handler to prevent HTML responses for API errors
  app.use((err: any, req: any, res: any, next: any) => {
    console.error(err.stack);
    res.status(500).json({ error: "Internal Server Error", details: err.message });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
