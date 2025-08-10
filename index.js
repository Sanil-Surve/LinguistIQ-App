const express = require("express");
const cors = require("cors");
const axios = require("axios");
require("dotenv").config();

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

// Ollama API configuration
const OLLAMA_BASE_URL =
  // process.env.OLLAMA_BASE_URL || "http://31.97.202.251:11434";
  process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "llama3.2:latest";

// Helper function to interact with Ollama API with streaming
const generateChatCompletion = async (
  userPrompt,
  model,
  messagePrefix,
  res
) => {
  try {
    const response = await axios.post(
      `${OLLAMA_BASE_URL}/api/generate`,
      {
        model: model || DEFAULT_MODEL,
        prompt: `${messagePrefix}: ${userPrompt}`,
        stream: true, // Enable streaming
        options: {
          temperature: 0.7,
          top_p: 0.9,
          max_tokens: 2048,
        },
      },
      {
        responseType: "stream", // Important for streaming
        timeout: 1200000,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    // Set headers for SSE (Server-Sent Events)
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Disable buffering for Nginx

    // Flush the headers to establish the SSE connection
    res.flushHeaders();

    response.data.on("data", (chunk) => {
      const lines = chunk
        .toString()
        .split("\n")
        .filter((line) => line.trim() !== "");
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.response) {
            // Send each chunk as an SSE event
            res.write(
              `data: ${JSON.stringify({ content: parsed.response })}\n\n`
            );
            // Flush the response to send it immediately
            if (res.flush) {
              res.flush();
            }
          }
        } catch (err) {
          console.error("Error parsing chunk:", err);
        }
      }
    });

    response.data.on("end", () => {
      // Send completion event
      res.write('event: end\ndata: {"message": "Stream completed"}\n\n');
      res.end();
    });

    response.data.on("error", (err) => {
      console.error("Stream error:", err);
      res.write('event: error\ndata: {"error": "Stream error occurred"}\n\n');
      res.end();
    });
  } catch (error) {
    console.error("Error with Ollama API:", error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    } else {
      res.write('event: error\ndata: {"error": "API connection failed"}\n\n');
      res.end();
    }
  }
};

// Route to check if Ollama is running and what models are available
app.get("/api/models", async (req, res) => {
  try {
    const response = await axios.get(`${OLLAMA_BASE_URL}/api/tags`);
    res.json({
      status: "Ollama is running",
      models: response.data.models,
    });
  } catch (error) {
    res.status(500).json({
      error: "Ollama is not running or not accessible",
      message: "Make sure Ollama is installed and running on localhost:11434",
    });
  }
});

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
  const { userInput, model } = req.body;

  if (!userInput) {
    return res.status(400).json({ error: "User input is required" });
  }

  try {
    await generateChatCompletion(
      userInput,
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
    // This will start the model download - it's a streaming endpoint
    const response = await axios.post(
      `${OLLAMA_BASE_URL}/api/pull`,
      {
        name: model,
      },
      {
        timeout: 300000, // 5 minute timeout for model downloads
      }
    );

    res.json({
      message: `Model ${model} pull initiated`,
      status: "success",
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
    const response = await axios.get(`${OLLAMA_BASE_URL}/api/tags`);
    res.json({
      status: "Server and Ollama are running",
      ollama_url: OLLAMA_BASE_URL,
      default_model: DEFAULT_MODEL,
      available_models: response.data.models?.length || 0,
    });
  } catch (error) {
    res.status(500).json({
      status: "Server running but Ollama not accessible",
      ollama_url: OLLAMA_BASE_URL,
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
  console.log(`Using Ollama at: ${OLLAMA_BASE_URL}`);
  console.log(`Default model: ${DEFAULT_MODEL}`);
  console.log("\nMake sure Ollama is running with: ollama serve");
  console.log("To verify llama3.2:latest is available: ollama list");
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception thrown:", err);
  process.exit(1);
});
