// const express = require('express');
// const cors = require('cors');
// require('dotenv').config();

// const OpenAI = require("openai");

// // Initialize Express app
// const app = express();
// app.use(cors());
// app.use(express.json());

// // OpenAI API configuration
// const openai = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY,
// });

// // Helper function to interact with OpenAI API (Chat Completion)
// const generateChatCompletion = async (userPrompt, model, messagePrefix) => {
//   try {
//     const chatCompletion = await openai.chat.completions.create({
//       messages: [
//         { role: "user", content: `${messagePrefix}: ${userPrompt}` },
//       ],
//       model: model || "gpt-3.5-turbo",
//     });
//     return chatCompletion.choices[0].message.content;
//   } catch (error) {
//     console.error('Error with OpenAI API:', error);
//     throw new Error('Failed to generate completion');
//   }
// };

// // Route to generate lesson content
// app.post('/api/generateLesson', async (req, res) => {
//   const { userInput } = req.body;
//   if (!userInput) {
//     return res.status(400).json({ error: 'User input is required' });
//   }

//   try {
//     const lesson = await generateChatCompletion(
//       userInput,
//       "gpt-3.5-turbo",
//       "Generate the information based on this input"
//     );
//     res.json({ lesson });
//   } catch (error) {
//     res.status(500).json({ error: 'Error generating lesson' });
//   }
// });

// // Route to generate quiz questions
// app.post('/api/generateQuizzes', async (req, res) => {
//   const { lessonContent } = req.body;
//   if (!lessonContent) {
//     return res.status(400).json({ error: 'Lesson content is required' });
//   }

//   try {
//     const quizzes = await generateChatCompletion(
//       lessonContent,
//       "gpt-3.5-turbo",
//       "Based on the following lesson, generate 5 quiz multiple choice questions with answers(which can be hide and see again)."
//     );
//     res.json({ quizzes });
//   } catch (error) {
//     res.status(500).json({ error: 'Error generating quizzes' });
//   }
// });

// // Start the server
// const PORT = process.env.PORT || 8080;
// app.listen(PORT, () => {
//   console.log(`Server running on port ${PORT}`);
// });

const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

// Ollama API configuration
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://31.97.202.251:11434';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:latest';

// Helper function to interact with Ollama API
const generateChatCompletion = async (userPrompt, model, messagePrefix) => {
  try {
    const response = await axios.post(`${OLLAMA_BASE_URL}/api/generate`, {
      model: model || DEFAULT_MODEL,
      prompt: `${messagePrefix}: ${userPrompt}`,
      stream: false,
      options: {
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 2048,
      }
    }, {
      timeout: 60000, // 60 second timeout
      headers: {
        'Content-Type': 'application/json',
      }
    });

    return response.data.response;
  } catch (error) {
    console.error('Error with Ollama API:', error.message);
    if (error.code === 'ECONNREFUSED') {
      throw new Error('Cannot connect to Ollama. Make sure Ollama is running on localhost:11434');
    }
    throw new Error('Failed to generate completion');
  }
};

// Route to check if Ollama is running and what models are available
app.get('/api/models', async (req, res) => {
  try {
    const response = await axios.get(`${OLLAMA_BASE_URL}/api/tags`);
    res.json({ 
      status: 'Ollama is running',
      models: response.data.models 
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Ollama is not running or not accessible',
      message: 'Make sure Ollama is installed and running on localhost:11434'
    });
  }
});

// Route to generate lesson content
app.post('/api/generateLesson', async (req, res) => {
  const { userInput, model } = req.body;
  
  if (!userInput) {
    return res.status(400).json({ error: 'User input is required' });
  }
  
  try {
    const lesson = await generateChatCompletion(
      userInput,
      model || DEFAULT_MODEL,
      "Generate comprehensive educational information and lesson content based on this input. Provide detailed explanations, examples, and structured learning material"
    );
    res.json({ lesson });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Route to generate quiz questions
app.post('/api/generateQuizzes', async (req, res) => {
  const { lessonContent, model } = req.body;
  
  if (!lessonContent) {
    return res.status(400).json({ error: 'Lesson content is required' });
  }
  
  try {
    const quizzes = await generateChatCompletion(
      lessonContent,
      model || DEFAULT_MODEL,
      "Based on the following lesson content, generate exactly 5 multiple choice quiz questions. For each question, provide 4 options (A, B, C, D) and clearly indicate the correct answer. Format as follows:\n\nQuestion 1: [question text]\nA) [option A]\nB) [option B]\nC) [option C]\nD) [option D]\nCorrect Answer: [letter]\n\nLesson content"
    );
    res.json({ quizzes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Route to pull/download a model (useful for setup)
app.post('/api/pullModel', async (req, res) => {
  const { model } = req.body;
  
  if (!model) {
    return res.status(400).json({ error: 'Model name is required' });
  }
  
  try {
    // This will start the model download - it's a streaming endpoint
    const response = await axios.post(`${OLLAMA_BASE_URL}/api/pull`, {
      name: model
    }, {
      timeout: 300000, // 5 minute timeout for model downloads
    });
    
    res.json({ 
      message: `Model ${model} pull initiated`,
      status: 'success' 
    });
  } catch (error) {
    res.status(500).json({ 
      error: `Failed to pull model ${model}`,
      message: error.message 
    });
  }
});

// Health check route
app.get('/health', async (req, res) => {
  try {
    const response = await axios.get(`${OLLAMA_BASE_URL}/api/tags`);
    res.json({ 
      status: 'Server and Ollama are running',
      ollama_url: OLLAMA_BASE_URL,
      default_model: DEFAULT_MODEL,
      available_models: response.data.models?.length || 0
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'Server running but Ollama not accessible',
      ollama_url: OLLAMA_BASE_URL,
      error: error.message
    });
  }
});

// Start the server
const PORT = process.env.PORT || 8081;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Using Ollama at: ${OLLAMA_BASE_URL}`);
  console.log(`Default model: ${DEFAULT_MODEL}`);
  console.log('\nMake sure Ollama is running with: ollama serve');
  console.log('To verify llama3.2:latest is available: ollama list');
});