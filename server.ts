import express from "express";
import { createServer as createViteServer } from "vite";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI, Type } from "@google/genai";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Gemini Client Lazily
let aiClient: any = null;
function getAI() {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not configured in Vercel/Environment.");
    }
    aiClient = new GoogleGenAI({ apiKey });
  }
  return aiClient;
}

// Initialize Supabase Client Lazily
let supabaseClient: any = null;
function getSupabase() {
  if (!supabaseClient) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_KEY environment variables.");
    }
    supabaseClient = createClient(supabaseUrl, supabaseKey);
  }
  return supabaseClient;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", supabaseConfigured: !!(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)) });
  });

  // Keep-Alive Endpoint to prevent Supabase from pausing
  app.get("/api/keep-alive", async (req, res) => {
    try {
      const supabase = getSupabase();
      const { error } = await supabase.from('users').select('*', { count: 'exact', head: true }).limit(1);
      if (error) throw error;
      res.json({ status: "alive", timestamp: new Date().toISOString() });
    } catch (error: any) {
      console.error("Keep-alive failed:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Check if user exists for auto-fill
  app.get("/api/auth/check/:email", async (req, res) => {
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('email', req.params.email)
        .maybeSingle();
      
      if (error) throw error;
      res.json(data || null);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Mock Auth for V1 - Enhanced for Lead Capture
  app.post("/api/auth/mock", async (req, res) => {
    try {
      const supabase = getSupabase();
      const { email, full_name, target_role, industry, career_level, target_country } = req.body;
      
      // Check if user exists
      const { data: existingUser, error: fetchError } = await supabase
        .from('users')
        .select('*')
        .eq('email', email)
        .maybeSingle();

      if (fetchError) throw fetchError;

      if (!existingUser) {
        // Insert new user
        const { data: newUser, error: insertError } = await supabase
          .from('users')
          .insert([{ 
            email, 
            full_name, 
            target_role, 
            industry, 
            career_level, 
            target_country 
          }])
          .select()
          .single();
        
        if (insertError) throw insertError;
        res.json(newUser);
      } else {
        // Update existing user
        const { data: updatedUser, error: updateError } = await supabase
          .from('users')
          .update({ 
            full_name, 
            target_role, 
            industry, 
            career_level, 
            target_country 
          })
          .eq('id', existingUser.id)
          .select()
          .single();
        
        if (updateError) throw updateError;
        res.json(updatedUser);
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Save Analysis Results
  app.post("/api/analysis/save", async (req, res) => {
    try {
      const supabase = getSupabase();
      const { userId, parsedCv, scores, report } = req.body;

      // 1. Save CV
      const { data: cvData, error: cvError } = await supabase
        .from('cvs')
        .insert([{ 
          user_id: userId, 
          parsed_text: JSON.stringify(parsedCv) 
        }])
        .select()
        .single();
      
      if (cvError) throw cvError;
      const cvId = cvData.id;

      // 2. Save Scores
      const { error: scoreError } = await supabase
        .from('cv_scores')
        .insert([{
          cv_id: cvId,
          structure_score: scores.structure,
          keyword_score: scores.keyword,
          impact_score: scores.impact,
          alignment_score: scores.alignment,
          clarity_score: scores.clarity,
          overall_score: scores.overall,
          ats_risk_level: scores.atsRisk
        }]);
      
      if (scoreError) throw scoreError;

      // 3. Save Report
      const { error: reportError } = await supabase
        .from('cv_reports')
        .insert([{
          cv_id: cvId,
          strengths: JSON.stringify(report.strengths),
          weaknesses: JSON.stringify(report.weaknesses),
          ats_risk_explanation: report.ats_risk_explanation
        }]);
      
      if (reportError) throw reportError;

      res.json({ success: true, cvId });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/history/:userId", async (req, res) => {
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('cv_scores')
        .select(`
          *,
          cv_reports (strengths, weaknesses, ats_risk_explanation),
          cvs!inner (user_id)
        `)
        .eq('cvs.user_id', req.params.userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      const history = data.map((item: any) => ({
        ...item,
        strengths: item.cv_reports?.[0]?.strengths ? JSON.parse(item.cv_reports[0].strengths) : [],
        weaknesses: item.cv_reports?.[0]?.weaknesses ? JSON.parse(item.cv_reports[0].weaknesses) : [],
        ats_risk_explanation: item.cv_reports?.[0]?.ats_risk_explanation
      }));

      res.json(history);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- NEW AI ANALYSIS ENDPOINTS (Server-Side) ---

  app.post("/api/ai/analyze", async (req, res) => {
    try {
      const { cvText, context } = req.body;
      const ai = getAI();

      // 1. Parse CV
      const parseResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Extract and structure the following CV into JSON:
        CV TEXT: ${cvText}`,
        config: {
          systemInstruction: "You are an expert CV parser. Extract professional_summary, work_experience (title, company, dates, bullet_points), education, skills, certifications, tools_and_technologies.",
          responseMimeType: "application/json"
        }
      });
      const parsedCv = JSON.parse(parseResponse.text || "{}");

      // 2. Detect Signals
      const signalsResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Analyze this CV for ${context.targetRole} in ${context.industry}.
        CV: ${JSON.stringify(parsedCv)}`,
        config: {
          systemInstruction: "Detect hiring signals: structure, keywords, impact, alignment, clarity. Return JSON.",
          responseMimeType: "application/json"
        }
      });
      const signals = JSON.parse(signalsResponse.text || "{}");

      // 3. Generate Report
      const reportResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Explain scores for these signals: ${JSON.stringify(signals)}`,
        config: {
          systemInstruction: "Provide 3 strengths, 3 weaknesses, and ATS risk explanation in JSON.",
          responseMimeType: "application/json"
        }
      });
      const report = JSON.parse(reportResponse.text || "{}");

      res.json({ parsedCv, signals, report });
    } catch (error: any) {
      console.error("AI Analysis Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/ai/optimize", async (req, res) => {
    try {
      const { type, content, context } = req.body;
      const ai = getAI();

      let prompt = "";
      if (type === 'summary') {
        prompt = `Rewrite this summary for ${context.targetRole}: ${content}`;
      } else {
        prompt = `Rewrite these bullets for ${context.targetRole}: ${JSON.stringify(content)}`;
      }

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          systemInstruction: "You are a senior CV writer. Rewrite for high impact and ATS friendliness.",
          responseMimeType: type === 'bullets' ? "application/json" : "text/plain"
        }
      });

      const result = type === 'bullets' ? JSON.parse(response.text || "[]") : response.text;
      res.json({ result });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Global Error Handler
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
