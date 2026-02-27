import { GoogleGenAI, Type } from "@google/genai";

// Initialize Gemini Client Lazily to prevent browser crashes if key is missing
let aiClient: any = null;
function getAI() {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not configured. Please set it in your environment variables.");
    }
    aiClient = new GoogleGenAI({ apiKey });
  }
  return aiClient;
}

export interface ParsedCV {
  professional_summary: string;
  work_experience: Array<{
    title: string;
    company: string;
    dates: string;
    bullet_points: string[];
  }>;
  education: string;
  skills: string[];
  certifications: string[];
  tools_and_technologies: string[];
}

export async function parseCV(cvText: string): Promise<ParsedCV> {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Extract and structure the following CV into JSON with these fields:
- professional_summary
- work_experience (array of roles with title, company, dates, bullet_points)
- education
- skills
- certifications
- tools_and_technologies (if present)

CV TEXT:
${cvText}`,
    config: {
      systemInstruction: "You are an expert CV parser. Your task is to extract and structure CV content. Do NOT evaluate, score, or rewrite anything. Only extract information accurately.",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          professional_summary: { type: Type.STRING },
          work_experience: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                company: { type: Type.STRING },
                dates: { type: Type.STRING },
                bullet_points: { type: Type.ARRAY, items: { type: Type.STRING } }
              }
            }
          },
          education: { type: Type.STRING },
          skills: { type: Type.ARRAY, items: { type: Type.STRING } },
          certifications: { type: Type.ARRAY, items: { type: Type.STRING } },
          tools_and_technologies: { type: Type.ARRAY, items: { type: Type.STRING } }
        }
      }
    }
  });

  return JSON.parse(response.text || "{}");
}

export interface Signals {
  structure: any;
  keywords: any;
  impact: any;
  alignment: any;
  clarity: any;
}

export async function detectSignals(parsedCv: ParsedCV, context: { targetRole: string, industry: string, targetCountry: string, careerLevel: string }): Promise<Signals> {
  const ai = getAI();
  const [structure, keywords, impact, alignment, clarity] = await Promise.all([
    // 2A: Structure & Formatting Signal Prompt
    ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Based on the structured CV below, identify:
- missing_sections (if any)
- section_order_quality (good / average / poor)
- formatting_consistency (good / average / poor)
- estimated_cv_length (pages)
- ats_risk_elements (tables, icons, columns)

CV STRUCTURE:
${JSON.stringify(parsedCv)}`,
      config: {
        systemInstruction: "You are an ATS and recruiter CV analyst. Identify structural and formatting signals only. Do not score. Do not give advice.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            missing_sections: { type: Type.ARRAY, items: { type: Type.STRING } },
            section_order_quality: { type: Type.STRING, description: "good / average / poor" },
            formatting_consistency: { type: Type.STRING, description: "good / average / poor" },
            estimated_cv_length: { type: Type.NUMBER },
            ats_risk_elements: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["missing_sections", "section_order_quality", "formatting_consistency", "estimated_cv_length", "ats_risk_elements"]
        }
      }
    }),
    // 2B: ATS Keyword Match Signal Prompt
    ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Target Role: ${context.targetRole}
Industry: ${context.industry}
Target Country: ${context.targetCountry}

Identify:
- core_role_keywords_present
- missing_critical_keywords
- keyword_density_level (low / moderate / high)
- signs_of_keyword_stuffing (yes/no)

CV CONTENT:
${JSON.stringify(parsedCv)}`,
      config: {
        systemInstruction: "You are an ATS keyword analysis engine. Your job is to detect keyword presence and gaps. Do not score. Do not rewrite.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            core_role_keywords_present: { type: Type.ARRAY, items: { type: Type.STRING } },
            missing_critical_keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
            keyword_density_level: { type: Type.STRING, description: "low / moderate / high" },
            signs_of_keyword_stuffing: { type: Type.STRING, description: "yes / no" }
          },
          required: ["core_role_keywords_present", "missing_critical_keywords", "keyword_density_level", "signs_of_keyword_stuffing"]
        }
      }
    }),
    // 2C: Impact & Metrics Signal Prompt
    ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Analyze work experience bullets and identify:
- percentage_of_bullets_with_metrics
- action_verb_strength (strong / moderate / weak)
- achievement_framing_level (high / medium / low)
- responsibility_only_bullets (count)

WORK EXPERIENCE:
${JSON.stringify(parsedCv.work_experience)}`,
      config: {
        systemInstruction: "You are a CV achievement analysis engine. Detect evidence of impact and metrics. Do not evaluate quality.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            percentage_of_bullets_with_metrics: { type: Type.NUMBER },
            action_verb_strength: { type: Type.STRING, description: "strong / moderate / weak" },
            achievement_framing_level: { type: Type.STRING, description: "high / medium / low" },
            responsibility_only_bullets: { type: Type.NUMBER }
          },
          required: ["percentage_of_bullets_with_metrics", "action_verb_strength", "achievement_framing_level", "responsibility_only_bullets"]
        }
      }
    }),
    // 2D: Role & Industry Alignment Signal Prompt
    ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Target Role: ${context.targetRole}
Career Level: ${context.careerLevel}
Industry: ${context.industry}

Identify:
- title_alignment (high / medium / low)
- experience_relevance (high / medium / low)
- seniority_consistency (yes/no)
- industry_language_presence (yes/no)

CV:
${JSON.stringify(parsedCv)}`,
      config: {
        systemInstruction: "You are a recruiter evaluating role alignment. Detect alignment signals only.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title_alignment: { type: Type.STRING, description: "high / medium / low" },
            experience_relevance: { type: Type.STRING, description: "high / medium / low" },
            seniority_consistency: { type: Type.STRING, description: "yes / no" },
            industry_language_presence: { type: Type.STRING, description: "yes / no" }
          },
          required: ["title_alignment", "experience_relevance", "seniority_consistency", "industry_language_presence"]
        }
      }
    }),
    // 2E: Clarity & Language Signal Prompt
    ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Analyze the CV text and identify:
- grammar_error_frequency (none / low / high)
- sentence_clarity (good / average / poor)
- tone_professionalism (professional / mixed / informal)
- tense_consistency (consistent / inconsistent)

CV TEXT:
${JSON.stringify(parsedCv)}`,
      config: {
        systemInstruction: "You are a professional CV language reviewer. Detect clarity and language issues only.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            grammar_error_frequency: { type: Type.STRING, description: "none / low / high" },
            sentence_clarity: { type: Type.STRING, description: "good / average / poor" },
            tone_professionalism: { type: Type.STRING, description: "professional / mixed / informal" },
            tense_consistency: { type: Type.STRING, description: "consistent / inconsistent" }
          },
          required: ["grammar_error_frequency", "sentence_clarity", "tone_professionalism", "tense_consistency"]
        }
      }
    })
  ]);

  return {
    structure: JSON.parse(structure.text || "{}"),
    keywords: JSON.parse(keywords.text || "{}"),
    impact: JSON.parse(impact.text || "{}"),
    alignment: JSON.parse(alignment.text || "{}"),
    clarity: JSON.parse(clarity.text || "{}")
  };
}

export async function explainScores(scores: any, signals: Signals): Promise<any> {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Explain the following CV scores in simple, recruiter-friendly language.

Scores:
${JSON.stringify(scores)}

Detected Signals:
${JSON.stringify(signals)}

Provide:
- 3 strengths
- 3 weaknesses
- ATS risk explanation`,
    config: {
      systemInstruction: "You explain CV evaluation results clearly and professionally. You do not change scores. You only explain them. Use a direct, professional, and recruiter-aligned tone.",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
          weaknesses: { type: Type.ARRAY, items: { type: Type.STRING } },
          ats_risk_explanation: { type: Type.STRING }
        },
        required: ["strengths", "weaknesses", "ats_risk_explanation"]
      }
    }
  });

  return JSON.parse(response.text || "{}");
}

export async function optimizeSummary(originalSummary: string, context: { targetRole: string, industry: string, targetCountry: string, careerLevel: string }): Promise<string> {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Rewrite the professional summary for:

Target Role: ${context.targetRole}
Industry: ${context.industry}
Target Country: ${context.targetCountry}
Career Level: ${context.careerLevel}

Original Summary:
${originalSummary}

Requirements:
- ATS-friendly
- Achievement-focused
- Professional tone
- Max 4 lines`,
    config: {
      systemInstruction: "You are a senior recruiter and CV writer. Rewrite content for ATS and human readers. Focus on impact and clarity."
    }
  });

  return response.text || "";
}

export async function optimizeBullets(bullets: string[], targetRole: string): Promise<string[]> {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Rewrite the following experience bullets to emphasize:
- measurable impact
- strong action verbs
- role relevance

Target Role: ${targetRole}

Original Bullets:
${JSON.stringify(bullets)}`,
    config: {
      systemInstruction: "You are a senior recruiter and CV writer. Rewrite experience bullets to be high-impact, achievement-oriented, and ATS-friendly. Return the result as a JSON array of strings.",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: { type: Type.STRING }
      }
    }
  });

  return JSON.parse(response.text || "[]");
}
