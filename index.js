require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const Groq = require("groq-sdk");

// Validate essential environment configuration on startup
if (!process.env.GROQ_API_KEY) {
  console.error("FATAL ERROR: GROQ_API_KEY environment variable is not defined.");
  process.exit(1);
}

// Environment Constants
const PORT = process.env.PORT || 8081;
const IS_PROD = process.env.NODE_ENV === "production";
const DEFAULT_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const MAX_INPUT_CHARS = 4000;

// Supported Groq models allowlist
const ALLOWED_MODELS = new Set([
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "llama-3.1-70b-versatile",
  "mixtral-8x7b-32768",
  "gemma2-9b-it",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  DEFAULT_MODEL,
]);

/**
 * Validates and falls back to DEFAULT_MODEL if requested model is unsupported.
 */
function getValidatedModel(requestedModel) {
  if (typeof requestedModel === "string" && ALLOWED_MODELS.has(requestedModel.trim())) {
    return requestedModel.trim();
  }
  return DEFAULT_MODEL;
}

/**
 * Helper to validate user input payload
 */
function validateTextInput(input, fieldName) {
  if (typeof input !== "string" || !input.trim()) {
    return { valid: false, error: `${fieldName} is required and must be a non-empty string.` };
  }
  if (input.trim().length > MAX_INPUT_CHARS) {
    return {
      valid: false,
      error: `${fieldName} exceeds maximum permitted length of ${MAX_INPUT_CHARS} characters.`,
    };
  }
  return { valid: true, sanitized: input.trim() };
}

// Initialize Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Initialize Express app
const app = express();

// Security: Disable Express fingerprinting header
app.disable("x-powered-by");

// Security: Use Helmet for defensive HTTP security headers
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// Security: Configure CORS with explicit origin allowlist
const defaultAllowedOrigins = [
  "https://linguist-iq.vercel.app",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:8080",
];

const configuredOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
  : defaultAllowedOrigins;

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests or allowed browser origins
    if (!origin || configuredOrigins.includes(origin) || (!IS_PROD && origin.startsWith("http://localhost:"))) {
      return callback(null, true);
    }
    return callback(new Error(`Origin ${origin} is not allowed by CORS`));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  maxAge: 86400,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// Security: Limit request body payload size to prevent DoS
app.use(express.json({ limit: "50kb" }));

// Security: Rate limiting to protect LLM endpoints against abuse and financial DoS
const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 60, // Limit each IP to 60 generation requests per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many requests. Please wait a few moments before trying again.",
  },
});

app.use("/api/", apiRateLimiter);

/**
 * Helper function to interact with Groq API with streaming & client abort handling
 */
const generateChatCompletion = async (
  req,
  res,
  userPrompt,
  model,
  messagePrefix
) => {
  const abortController = new AbortController();

  // Abort ongoing Groq stream if client disconnects
  req.on("close", () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  });

  try {
    const validatedModel = getValidatedModel(model);

    const chatCompletion = await groq.chat.completions.create(
      {
        messages: [
          { role: "system", content: messagePrefix },
          { role: "user", content: userPrompt },
        ],
        model: validatedModel,
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 2048,
        stream: true,
      },
      { signal: abortController.signal }
    );

    // Set headers for SSE (Server-Sent Events)
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    res.flushHeaders();

    for await (const part of chatCompletion) {
      if (abortController.signal.aborted) {
        break;
      }

      const deltaContent = part?.choices?.[0]?.delta?.content;
      if (deltaContent) {
        res.write(
          `data: ${JSON.stringify({
            content: deltaContent,
          })}\n\n`
        );
        if (typeof res.flush === "function") {
          res.flush();
        }
      }
    }

    if (!res.writableEnded && !abortController.signal.aborted) {
      res.write('event: end\ndata: {"message": "Stream completed"}\n\n');
      res.end();
    }
  } catch (error) {
    if (abortController.signal.aborted || error.name === "AbortError") {
      console.log("Client terminated connection; LLM generation aborted.");
      return;
    }

    console.error("Error with Groq API:", error.message);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Failed to generate content",
        ...(IS_PROD ? {} : { details: error.message }),
      });
    } else if (!res.writableEnded) {
      res.write('event: error\ndata: {"error": "API connection failed"}\n\n');
      res.end();
    }
  }
};

// Route to generate lesson content with streaming
app.post("/api/generateLesson", async (req, res) => {
  const { userInput, model } = req.body;
  const validation = validateTextInput(userInput, "userInput");

  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  await generateChatCompletion(
    req,
    res,
    validation.sanitized,
    model,
    "Generate comprehensive educational information and lesson content based on this input. Provide detailed explanations, examples, and structured learning material. Format the response with markdown for bold (**bold**) and italic (*italic*) text."
  );
});

// Route to generate quiz questions with streaming
app.post("/api/generateQuizzes", async (req, res) => {
  const { lessonContent, model } = req.body;
  const validation = validateTextInput(lessonContent, "lessonContent");

  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  await generateChatCompletion(
    req,
    res,
    validation.sanitized,
    model,
    "Based on the following input, generate exactly 5 multiple choice quiz questions. For each question:\n1. Provide 4 options (A, B, C, D)\n2. Clearly indicate the correct answer\n3. Format as follows:\n\nQuestion 1: [question text]\nA) [option A]\nB) [option B]\nC) [option C]\nD) [option D]\nCorrect Answer: [letter]"
  );
});

// Lightweight health check route (free liveness probe for load balancers & uptime monitors)
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "LinguistIQ-App",
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  });
});

// Optional deep readiness check (for initial connectivity tests)
app.get("/health/readiness", async (req, res) => {
  try {
    const testCompletion = await groq.chat.completions.create({
      messages: [{ role: "system", content: "ping" }],
      model: DEFAULT_MODEL,
      max_tokens: 3,
    });

    res.json({
      status: "ready",
      groq_model: DEFAULT_MODEL,
      test_response: testCompletion?.choices?.[0]?.message?.content || "ok",
    });
  } catch (error) {
    res.status(503).json({
      status: "degraded",
      error: "Groq API service unavailable",
      ...(IS_PROD ? {} : { details: error.message }),
    });
  }
});

// 404 handler for unrecognized routes
app.use((req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

// Centralized error handling middleware
app.use((err, req, res, next) => {
  console.error("Global error handler:", err);
  if (!res.headersSent) {
    res.status(err.status || 500).json({
      error: "Internal server error",
      ...(IS_PROD ? {} : { details: err.message }),
    });
  }
});

// Start the server
const server = app.listen(PORT, () => {
  console.log(`Server running in ${IS_PROD ? "production" : "development"} mode on port ${PORT}`);
  console.log(`Default Groq model: ${DEFAULT_MODEL}`);
});

// Graceful shutdown handling
const handleShutdown = (signal) => {
  console.log(`Received ${signal}. Shutting down gracefully...`);
  server.close(() => {
    console.log("HTTP server closed.");
    process.exit(0);
  });

  setTimeout(() => {
    console.error("Forceful shutdown after timeout.");
    process.exit(1);
  }, 10000).unref();
};

process.on("SIGTERM", () => handleShutdown("SIGTERM"));
process.on("SIGINT", () => handleShutdown("SIGINT"));

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception thrown:", err);
  process.exit(1);
});
