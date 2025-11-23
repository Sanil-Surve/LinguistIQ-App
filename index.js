const express = require("express");
const cors = require("cors");
const Groq = require("groq-sdk");
require("dotenv").config();

// Initialize Express app
const app = express();
app.use(
  cors({
    // origin: ["https://linguist-iq.vercel.app"],
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);
app.options("*", cors());
app.use(express.json());

// Initialize Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Groq model constants
const DEFAULT_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

// Helper function to interact with Groq API with streaming
const generateChatCompletion = async (
  userPrompt,
  model,
  messagePrefix,
  res
) => {
  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: messagePrefix },
        { role: "user", content: userPrompt },
      ],
      model: model || DEFAULT_MODEL,
      temperature: 0.7,
      top_p: 0.9,
      max_tokens: 2048,
      stream: true,
    });

    // Set headers for SSE (Server-Sent Events)
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // Flush the headers to establish the SSE connection
    res.flushHeaders();

    for await (const part of chatCompletion) {
      if (part.choices[0].delta?.content) {
        res.write(
          `data: ${JSON.stringify({
            content: part.choices[0].delta.content,
          })}\n\n`
        );
        if (res.flush) {
          res.flush();
        }
      }
    }

    // Send completion event
    res.write('event: end\ndata: {"message": "Stream completed"}\n\n');
    res.end();
  } catch (error) {
    console.error("Error with Groq API:", error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    } else {
      res.write('event: error\ndata: {"error": "API connection failed"}\n\n');
      res.end();
    }
  }
};

// Route to generate lesson content with streaming
app.post("/api/generateLesson", async (req, res) => {
  const { userInput, model } = req.body;

  if (!userInput) {
    return res.status(400).json({ error: "User input is required" });
  }

  try {
    await generateChatCompletion(
      userInput,
      model || DEFAULT_MODEL,
      "Generate comprehensive educational information and lesson content based on this input. Provide detailed explanations, examples, and structured learning material. Format the response with markdown for bold (**bold**) and italic (*italic*) text.",
      res
    );
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

// Route to generate quiz questions with streaming
app.post("/api/generateQuizzes", async (req, res) => {
  const { lessonContent, model } = req.body;

  if (!lessonContent) {
    return res.status(400).json({ error: "Lesson Content is required" });
  }

  try {
    await generateChatCompletion(
      lessonContent,
      model || DEFAULT_MODEL,
      "Based on the following input, generate exactly 5 multiple choice quiz questions. For each question:\n1. Provide 4 options (A, B, C, D)\n2. Clearly indicate the correct answer\n3. Format as follows:\n\nQuestion 1: [question text]\nA) [option A]\nB) [option B]\nC) [option C]\nD) [option D]\nCorrect Answer: [letter]",
      res
    );
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

// Route to pull/download a model (useful for setup)
app.post("/api/pullModel", async (req, res) => {
  const { model } = req.body;

  if (!model) {
    return res.status(400).json({ error: "Model name is required" });
  }

  try {
    // Groq does not support pulling models, so respond accordingly
    res.status(400).json({
      error: "Model pulling is not supported by Groq API",
    });
  } catch (error) {
    res.status(500).json({
      error: `Failed to pull model ${model}`,
      message: error.message,
    });
  }
});

// Health check route
app.get("/health", async (req, res) => {
  try {
    // Perform a small test query to check Groq connectivity
    const testCompletion = await groq.chat.completions.create({
      messages: [{ role: "system", content: "Say hello" }],
      model: DEFAULT_MODEL,
      max_tokens: 5,
    });

    res.json({
      status: "Server and Groq API are running",
      groq_model: DEFAULT_MODEL,
      test_response: testCompletion.choices[0].message.content,
    });
  } catch (error) {
    res.status(500).json({
      status: "Server running but Groq API not accessible",
      error: error.message,
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Global error handler:", err);
  if (!res.headersSent) {
    res.status(500).json({
      error: "Internal server error",
      message: err.message,
    });
  }
});

// Start the server
const PORT = process.env.PORT || 8081;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Using Groq API with model: ${DEFAULT_MODEL}`);
  console.log("\nMake sure your GROQ_API_KEY is set correctly.");
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception thrown:", err);
  process.exit(1);
});
